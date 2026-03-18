#[path = "library_translation/types.rs"]
mod library_translation_types;
#[path = "library_translation/ocr.rs"]
mod library_translation_ocr;
#[path = "library_translation/memory.rs"]
mod library_translation_memory;
#[path = "library_translation/extract.rs"]
mod library_translation_extract;
#[path = "library_translation/layout.rs"]
mod library_translation_layout;
#[path = "library_translation/translate.rs"]
mod library_translation_translate;
#[path = "library_translation/render.rs"]
mod library_translation_render;

const LIBRARY_WORKSPACE_PREFIX: &str = ".latotex/papers";

struct TranslationModelCandidate {
    model_id: String,
    protocol_id: String,
    base_url: String,
    model_name: String,
}

fn to_library_workspace_relative(path: &str) -> String {
    let normalized = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
    if normalized.is_empty() {
        return LIBRARY_WORKSPACE_PREFIX.to_string();
    }
    if normalized == LIBRARY_WORKSPACE_PREFIX || normalized.starts_with(&format!("{LIBRARY_WORKSPACE_PREFIX}/")) {
        return normalized;
    }
    format!("{LIBRARY_WORKSPACE_PREFIX}/{normalized}")
}

fn to_library_relative_from_workspace(path: &str) -> Result<String, String> {
    let normalized = path.trim().replace('\\', "/").trim_start_matches('/').to_string();
    if normalized == LIBRARY_WORKSPACE_PREFIX {
        return Ok(String::new());
    }
    if let Some(stripped) = normalized.strip_prefix(&format!("{LIBRARY_WORKSPACE_PREFIX}/")) {
        if stripped.trim().is_empty() {
            return Err("translation.source_pdf_not_found".to_string());
        }
        return Ok(stripped.to_string());
    }
    if normalized.trim().is_empty() {
        return Err("translation.source_pdf_not_found".to_string());
    }
    Ok(normalized)
}

fn resolve_translation_source_pdf_workspace(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<String, String> {
    let preview = library_resolve_pdf_preview(db_path, project_id, relative_path)?;
    preview
        .relative_path
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "translation.source_pdf_not_found".to_string())
}

pub(crate) fn translation_pdf_relative_path(source_pdf_relative: &str) -> String {
    let normalized = source_pdf_relative.trim().replace('\\', "/").trim_start_matches('/').to_string();
    let stem = Path::new(&normalized)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("paper");
    let scoped = normalized.replace('/', "--");
    let slug = slugify_name(&format!("{scoped}-{stem}"), "paper");
    format!(".cache/translated/{slug}.translated.pdf")
}

fn persist_project_translation_glossary(
    project_root: &Path,
    source_relative_path: &str,
    target_lang: &str,
    glossary: &[library_translation_types::TranslationGlossaryEntry],
) -> Result<(), String> {
    if glossary.is_empty() {
        return Ok(());
    }

    let glossary_path = project_root
        .join(".latotex")
        .join("memory")
        .join("translation-glossary.md");
    if let Some(parent) = glossary_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut existing = fs::read_to_string(&glossary_path).unwrap_or_default();
    if existing.trim().is_empty() {
        existing = "# Translation Glossary\n\n".to_string();
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "## {} · {} · {}",
        chrono::Utc::now().to_rfc3339(),
        source_relative_path,
        target_lang
    ));
    for item in glossary.iter().take(80) {
        lines.push(format!("- {} => {}", item.source_term, item.target_term));
    }
    lines.push(String::new());

    existing.push_str(&lines.join("\n"));

    let max_chars = 120_000;
    if existing.chars().count() > max_chars {
        let tail: String = existing
            .chars()
            .rev()
            .take(max_chars)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        existing = format!("# Translation Glossary\n\n...[truncated]...\n\n{}", tail);
    }

    fs::write(glossary_path, existing).map_err(|e| e.to_string())
}

fn push_translation_model_candidate(
    conn: &Connection,
    model_id: &str,
    seen: &mut std::collections::HashSet<String>,
    output: &mut Vec<TranslationModelCandidate>,
) -> Result<(), String> {
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
        .map_err(|_| format!("Configured model is missing from model catalog: {normalized}"))?;

    let base_url = conn
        .query_row(
            "SELECT base_url FROM model_protocols WHERE id = ?1",
            params![&protocol_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| format!("Protocol configuration not found for model: {normalized}"))?;

    output.push(TranslationModelCandidate {
        model_id: normalized.to_string(),
        protocol_id,
        base_url,
        model_name,
    });

    Ok(())
}

fn resolve_translation_model_candidates(
    db_path: &Path,
    model_override: Option<&str>,
) -> Result<Vec<TranslationModelCandidate>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut output = Vec::<TranslationModelCandidate>::new();
    let mut seen = std::collections::HashSet::<String>::new();

    if let Some(override_id) = model_override.map(str::trim).filter(|value| !value.is_empty()) {
        push_translation_model_candidate(&conn, override_id, &mut seen, &mut output)?;
    }

    let bound_model_id = conn
        .query_row(
            "SELECT model_id FROM agent_bindings WHERE role = ?1",
            params!["task"],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;
    if let Some(model_id) = bound_model_id {
        push_translation_model_candidate(&conn, &model_id, &mut seen, &mut output)?;
    }

    let mut stmt = conn
        .prepare("SELECT id FROM model_catalog ORDER BY protocol_id, display_name")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for row in rows {
        let model_id = row.map_err(|e| e.to_string())?;
        let _ = push_translation_model_candidate(&conn, &model_id, &mut seen, &mut output);
    }

    if output.is_empty() {
        return Err("No model binding configured for role: task".to_string());
    }

    Ok(output)
}

pub fn translate_library_document(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
) -> Result<crate::models::LibraryTranslateResponse, String> {
    translate_library_document_with_progress(
        db_path,
        runtime_root,
        project_id,
        relative_path,
        target_language,
        model_override,
        |_current, _total, _stage| {},
    )
}

pub fn translate_library_document_with_progress<F>(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
    mut on_progress: F,
) -> Result<crate::models::LibraryTranslateResponse, String>
where
    F: FnMut(u32, u32, &str),
{
    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let source_pdf_workspace_relative =
        resolve_translation_source_pdf_workspace(db_path, project_id, relative_path)?;
    let source_pdf_relative = to_library_relative_from_workspace(&source_pdf_workspace_relative)?;

    on_progress(0, 0, "extracting");
    let extraction = library_translation_extract::extract_translation_source(
        &project_root,
        &papers_root,
        &source_pdf_relative,
    )?;
    let layout_plan = library_translation_layout::build_layout_plan(&extraction);

    let target_lang = library_translation_extract::normalize_target_language(target_language);
    let model_candidates = resolve_translation_model_candidates(db_path, model_override)?;
    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    };

    let mut translated_result = None;
    let mut resolved_model: Option<TranslationModelCandidate> = None;
    let mut errors = Vec::<String>::new();

    for (index, candidate) in model_candidates.iter().enumerate() {
        on_progress(
            0,
            0,
            &format!(
                "model:{} ({}/{})",
                candidate.model_id,
                index + 1,
                model_candidates.len()
            ),
        );

        let api_key = match secure::get_model_api_key(&secure_context, &candidate.model_id) {
            Ok(value) => value
                .api_key
                .filter(|key| !key.trim().is_empty()),
            Err(error) => {
                errors.push(format!("{}: {}", candidate.model_id, error));
                None
            }
        };

        let Some(api_key) = api_key else {
            errors.push(format!("{}: translation.model_api_key_missing", candidate.model_id));
            continue;
        };

        match library_translation_translate::translate_layout_plan(
            db_path,
            project_id,
            &candidate.protocol_id,
            &candidate.base_url,
            &api_key,
            &candidate.model_name,
            &target_lang,
            &extraction,
            &layout_plan,
            |current, total, stage| on_progress(current, total, stage),
        ) {
            Ok(translated) => {
                translated_result = Some(translated);
                resolved_model = Some(TranslationModelCandidate {
                    model_id: candidate.model_id.clone(),
                    protocol_id: candidate.protocol_id.clone(),
                    base_url: candidate.base_url.clone(),
                    model_name: candidate.model_name.clone(),
                });
                break;
            }
            Err(error) => {
                errors.push(format!("{}: {}", candidate.model_id, error));
            }
        }
    }

    let translated = translated_result.ok_or_else(|| {
        format!(
            "translation.failed_after_fallback: {}",
            if errors.is_empty() {
                "unknown".to_string()
            } else {
                errors.join(" | ")
            }
        )
    })?;

    on_progress(0, 0, "rendering");
    let persist = library_translation_render::persist_translation_result(
        &papers_root,
        &extraction,
        &layout_plan,
        &translated,
        &source_pdf_relative,
    )?;

    let _ = persist_project_translation_glossary(
        &project_root,
        &extraction.normalized_relative_path,
        &target_lang,
        &translated.glossary,
    );

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;
    touch_project_updated_at(db_path, project_id)?;

    let translated_pdf_workspace_relative =
        to_library_workspace_relative(&persist.primary_relative_path);
    let model_tag = resolved_model
        .as_ref()
        .map(|item| item.model_id.clone())
        .unwrap_or_else(|| "unknown".to_string());

    on_progress(0, 0, "completed");
    Ok(crate::models::LibraryTranslateResponse {
        relative_path: translated_pdf_workspace_relative.clone(),
        source_kind: extraction.source_kind,
        engine: format!("latotex.local.translation.pipeline.v4.pdf+{model_tag}"),
        artifact_paths: Vec::new(),
        detected_language: extraction.detected_language,
        extraction_engine: extraction.extraction_engine,
        refined_by_search: translated.refined_by_search,
        glossary_count: translated.glossary.len() as u32,
        translated_pdf_relative_path: translated_pdf_workspace_relative,
        source_pdf_relative_path: source_pdf_workspace_relative,
    })
}
