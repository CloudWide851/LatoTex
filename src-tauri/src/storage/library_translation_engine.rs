#[path = "library_translation/paper_analysis_engine.rs"]
mod library_translation_paper_analysis_engine;
#[path = "library_translation/paper_translation_engine.rs"]
mod library_translation_paper_translation_engine;

const LIBRARY_WORKSPACE_PREFIX: &str = ".latotex/papers";

#[derive(Clone)]
pub(crate) struct ReadyPaperExtractRuntime {
    python_path: PathBuf,
    paper_runtime_root: PathBuf,
    app_runtime_root: PathBuf,
}

pub(super) struct PaperRuntimeRunDir {
    path: PathBuf,
}

impl PaperRuntimeRunDir {
    pub(super) fn create(runtime_root: &Path) -> Result<Self, String> {
        let relative = format!("paper-runtime/{}", Uuid::new_v4());
        let path = prepare_workspace_mutation_path(runtime_root, &relative)?;
        fs::create_dir_all(&path).map_err(|_| "workspace.operation.failed".to_string())?;
        Ok(Self { path })
    }

    pub(super) fn path(&self) -> &Path {
        &self.path
    }
}

impl Drop for PaperRuntimeRunDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

#[derive(Clone, Debug)]
pub struct LibraryTranslateFailure {
    pub code: String,
    pub message: String,
    pub diagnostics: Vec<String>,
}

impl LibraryTranslateFailure {
    pub fn new(
        code: impl Into<String>,
        message: impl Into<String>,
        diagnostics: Vec<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            diagnostics,
        }
    }

    pub fn from_message(raw: impl Into<String>) -> Self {
        let raw = raw.into();
        let trimmed = raw.trim();
        let (code, message) = if let Some((head, tail)) = trimmed.split_once(':') {
            let normalized_code = head.trim();
            let normalized_message = tail.trim();
            if normalized_code.starts_with("translation.")
                || normalized_code.starts_with("python.")
                || normalized_code.starts_with("compile.")
            {
                (normalized_code.to_string(), normalized_message.to_string())
            } else {
                ("translation.failed".to_string(), trimmed.to_string())
            }
        } else if trimmed.starts_with("translation.") || trimmed.starts_with("python.") {
            (trimmed.to_string(), String::new())
        } else {
            ("translation.failed".to_string(), trimmed.to_string())
        };
        Self {
            code,
            message,
            diagnostics: Vec::new(),
        }
    }

    pub fn status_message(&self) -> String {
        if self.message.trim().is_empty() {
            self.code.clone()
        } else {
            format!("{}: {}", self.code, self.message)
        }
    }
}

#[derive(Clone)]
pub(super) struct TranslationModelCandidate {
    model_id: String,
    base_url: String,
    model_name: String,
}

pub(super) fn to_library_workspace_relative(path: &str) -> String {
    let normalized = path
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized.is_empty() {
        return LIBRARY_WORKSPACE_PREFIX.to_string();
    }
    if normalized == LIBRARY_WORKSPACE_PREFIX
        || normalized.starts_with(&format!("{LIBRARY_WORKSPACE_PREFIX}/"))
    {
        return normalized;
    }
    format!("{LIBRARY_WORKSPACE_PREFIX}/{normalized}")
}

pub(super) fn to_library_relative_from_workspace(
    path: &str,
) -> Result<String, LibraryTranslateFailure> {
    let normalized = path
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized == LIBRARY_WORKSPACE_PREFIX {
        return Ok(String::new());
    }
    if let Some(stripped) = normalized.strip_prefix(&format!("{LIBRARY_WORKSPACE_PREFIX}/")) {
        if stripped.trim().is_empty() {
            return Err(LibraryTranslateFailure::from_message(
                "translation.source_pdf_not_found",
            ));
        }
        return Ok(stripped.to_string());
    }
    if normalized.trim().is_empty() {
        return Err(LibraryTranslateFailure::from_message(
            "translation.source_pdf_not_found",
        ));
    }
    Ok(normalized)
}

pub(super) fn resolve_translation_source_pdf_workspace(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<String, LibraryTranslateFailure> {
    let preview = library_resolve_pdf_preview(db_path, project_id, relative_path)
        .map_err(LibraryTranslateFailure::from_message)?;
    preview
        .relative_path
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| LibraryTranslateFailure::from_message("translation.source_pdf_not_found"))
}

pub(crate) fn translation_pdf_relative_path(source_pdf_relative: &str) -> String {
    let normalized = source_pdf_relative
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    let stem = Path::new(&normalized)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("paper");
    let scoped = normalized.replace('/', "--");
    let slug = slugify_name(&format!("{scoped}-{stem}"), "paper");
    format!(".cache/translated/{slug}.translated.pdf")
}

fn push_translation_model_candidate(
    conn: &Connection,
    model_id: &str,
    seen: &mut std::collections::HashSet<String>,
    output: &mut Vec<TranslationModelCandidate>,
) -> Result<(), LibraryTranslateFailure> {
    let normalized = model_id.trim();
    if normalized.is_empty() {
        return Ok(());
    }
    if !seen.insert(normalized.to_string()) {
        return Ok(());
    }

    let (protocol_id, model_name): (String, String) = conn
        .query_row(
            "SELECT protocol_id, request_name FROM model_catalog WHERE id = ?1",
            params![normalized],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| {
            LibraryTranslateFailure::new(
                "translation.provider.model_missing",
                format!("Configured model is missing from model catalog: {normalized}"),
                Vec::new(),
            )
        })?;

    let base_url = conn
        .query_row(
            "SELECT base_url FROM model_protocols WHERE id = ?1",
            params![&protocol_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| {
            LibraryTranslateFailure::new(
                "translation.provider.protocol_missing",
                format!("Protocol configuration not found for model: {normalized}"),
                Vec::new(),
            )
        })?;

    output.push(TranslationModelCandidate {
        model_id: normalized.to_string(),
        base_url,
        model_name,
    });

    Ok(())
}

pub(super) fn resolve_translation_model_candidates(
    db_path: &Path,
    model_override: Option<&str>,
) -> Result<Vec<TranslationModelCandidate>, LibraryTranslateFailure> {
    let conn = Connection::open(db_path).map_err(|error| {
        LibraryTranslateFailure::new("translation.db.open_failed", error.to_string(), Vec::new())
    })?;
    let mut output = Vec::<TranslationModelCandidate>::new();
    let mut seen = std::collections::HashSet::<String>::new();

    if let Some(override_id) = model_override
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        push_translation_model_candidate(&conn, override_id, &mut seen, &mut output)?;
    }

    let bound_model_id = conn
        .query_row(
            "SELECT model_id FROM agent_bindings WHERE role = ?1",
            params!["task"],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|error| {
            LibraryTranslateFailure::new(
                "translation.db.query_failed",
                error.to_string(),
                Vec::new(),
            )
        })?;
    if let Some(model_id) = bound_model_id {
        push_translation_model_candidate(&conn, &model_id, &mut seen, &mut output)?;
    }

    let mut stmt = conn
        .prepare("SELECT id FROM model_catalog ORDER BY protocol_id, display_name")
        .map_err(|error| {
            LibraryTranslateFailure::new(
                "translation.db.query_failed",
                error.to_string(),
                Vec::new(),
            )
        })?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|error| {
            LibraryTranslateFailure::new(
                "translation.db.query_failed",
                error.to_string(),
                Vec::new(),
            )
        })?;
    for row in rows {
        let model_id = row.map_err(|error| {
            LibraryTranslateFailure::new(
                "translation.db.query_failed",
                error.to_string(),
                Vec::new(),
            )
        })?;
        let _ = push_translation_model_candidate(&conn, &model_id, &mut seen, &mut output);
    }

    if output.is_empty() {
        return Err(LibraryTranslateFailure::new(
            "translation.provider.unconfigured",
            "No translation model candidates are configured.",
            Vec::new(),
        ));
    }

    Ok(output)
}

pub fn translate_library_document(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
) -> Result<crate::models::LibraryTranslateResponse, LibraryTranslateFailure> {
    library_translation_paper_translation_engine::translate_library_document(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        relative_path,
        target_language,
        model_override,
    )
}

pub fn translate_library_document_with_progress<F>(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
    on_progress: F,
) -> Result<crate::models::LibraryTranslateResponse, LibraryTranslateFailure>
where
    F: FnMut(u32, u32, &str),
{
    library_translation_paper_translation_engine::translate_library_document_with_progress(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        relative_path,
        target_language,
        model_override,
        on_progress,
    )
}

pub fn extract_library_paper_context(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<crate::models::LibraryPaperExtractResponse, String> {
    library_translation_paper_analysis_engine::extract_library_paper_context(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        relative_path,
    )
}

pub fn extract_workspace_pdf_pages_for_knowledge(
    db_path: &Path,
    app_runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<Vec<(u32, String)>, String> {
    library_translation_paper_analysis_engine::extract_workspace_pdf_pages(
        db_path,
        app_runtime_root,
        app_data_dir,
        project_id,
        relative_path,
    )
}

pub(crate) fn resolve_ready_paper_extract_runtime(
    db_path: &Path,
    app_runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
) -> Option<ReadyPaperExtractRuntime> {
    library_translation_paper_analysis_engine::resolve_ready_paper_extract_runtime(
        db_path,
        app_runtime_root,
        app_data_dir,
        project_id,
        project_root,
    )
}

pub(crate) fn extract_downloaded_pdf_text(
    runtime: &ReadyPaperExtractRuntime,
    bytes: &[u8],
) -> Result<Option<String>, String> {
    library_translation_paper_analysis_engine::extract_downloaded_pdf_text(runtime, bytes)
}

#[cfg(test)]
mod paper_runtime_run_dir_tests {
    use super::PaperRuntimeRunDir;

    #[test]
    fn paper_runtime_run_directory_is_removed_on_drop() {
        let runtime_root =
            std::env::temp_dir().join(format!("latotex-paper-runtime-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&runtime_root).unwrap();
        let path = {
            let run_dir = PaperRuntimeRunDir::create(&runtime_root).unwrap();
            let path = run_dir.path().to_path_buf();
            assert!(path.exists());
            path
        };
        assert!(!path.exists());
        let _ = std::fs::remove_dir_all(runtime_root);
    }
}
