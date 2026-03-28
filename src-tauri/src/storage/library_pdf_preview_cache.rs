const LIBRARY_PDF_CACHE_STATE_READY: &str = "ready";
const LIBRARY_PDF_CACHE_STATE_PENDING: &str = "pending";
const LIBRARY_PDF_CACHE_STATE_ERROR: &str = "error";
const LIBRARY_PDF_CACHE_STATE_MISSING: &str = "missing";

fn hash_remote_url(url: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn to_workspace_relative(project_root: &Path, path: &Path) -> Result<String, String> {
    let relative = path
        .strip_prefix(project_root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(relative)
}

fn find_remote_pdf_url(summary: &LibraryCitationSummaryResponse) -> Option<String> {
    for url in &summary.urls {
        let lower = url.to_lowercase();
        if lower.ends_with(".pdf") || lower.contains(".pdf?") {
            return Some(url.clone());
        }
        if lower.contains("arxiv.org/abs/") {
            if let Some(arxiv_id) = extract_arxiv_id(url) {
                return Some(format!("https://arxiv.org/pdf/{arxiv_id}.pdf"));
            }
        }
    }
    summary
        .arxiv_id
        .as_ref()
        .map(|arxiv_id| format!("https://arxiv.org/pdf/{arxiv_id}.pdf"))
}

fn cache_remote_pdf_file(cache_target: &Path, source_url: &str) -> Result<(), String> {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(24))
        .user_agent("LatoTex/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let response = client.get(source_url).send().map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    let is_pdf = bytes.starts_with(b"%PDF-") || source_url.to_lowercase().contains(".pdf");
    if !is_pdf {
        return Err("Remote file is not a valid PDF stream".to_string());
    }
    fs::write(cache_target, bytes).map_err(|e| e.to_string())
}

fn to_library_relative_path_from_workspace(workspace_relative: &str) -> Option<String> {
    let normalized = workspace_relative
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized.is_empty() {
        return None;
    }
    normalized
        .strip_prefix(".latotex/papers/")
        .map(|value| value.to_string())
}

fn resolve_translated_pdf_workspace_path(
    project_root: &Path,
    papers_root: &Path,
    source_workspace_relative: &str,
) -> Option<String> {
    let source_library_relative = to_library_relative_path_from_workspace(source_workspace_relative)?;
    let translated_relative = translation_pdf_relative_path(&source_library_relative);
    let translated_abs = papers_root.join(Path::new(&translated_relative));
    if !translated_abs.exists() || !translated_abs.is_file() {
        return None;
    }
    to_workspace_relative(project_root, &translated_abs).ok()
}

fn cache_path_ready(cache_path: &Path) -> bool {
    cache_path.exists() && fs::metadata(cache_path).map(|meta| meta.len()).unwrap_or(0) > 0
}

fn resolve_local_pdf_candidate(source: &Path) -> Option<PathBuf> {
    if source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .eq_ignore_ascii_case("pdf")
    {
        return Some(source.to_path_buf());
    }
    let candidate = source.with_extension("pdf");
    if candidate.exists() && candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn build_preview_response(
    project_root: &Path,
    papers_root: &Path,
    source_workspace_relative: Option<String>,
    source_url: Option<String>,
    cached: bool,
    cache_state: &str,
    cache_error: Option<String>,
) -> LibraryPdfPreviewResponse {
    let translated_relative_path = source_workspace_relative
        .as_deref()
        .and_then(|path| resolve_translated_pdf_workspace_path(project_root, papers_root, path));
    LibraryPdfPreviewResponse {
        relative_path: source_workspace_relative,
        preview_url: None,
        source_url,
        cached,
        cache_state: cache_state.to_string(),
        cache_error,
        translated_relative_path,
        translated_preview_url: None,
    }
}

fn pdf_cache_task_key(project_id: &str, relative_path: &str) -> String {
    format!("{project_id}::{}", relative_path.trim().replace('\\', "/"))
}

fn read_pdf_cache_task(
    tasks: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, crate::state::LibraryPdfCacheTask>>>,
    task_key: &str,
) -> (Option<String>, Option<String>) {
    let Ok(tasks_guard) = tasks.lock() else {
        return (None, None);
    };
    let Some(task) = tasks_guard.get(task_key) else {
        return (None, None);
    };
    let status = task.status.lock().ok().map(|value| value.clone());
    let error = task.error.lock().ok().and_then(|value| value.clone());
    (status, error)
}

fn clear_pdf_cache_task_if_terminal(
    tasks: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, crate::state::LibraryPdfCacheTask>>>,
    task_key: &str,
) {
    let Ok(mut tasks_guard) = tasks.lock() else {
        return;
    };
    let should_remove = tasks_guard
        .get(task_key)
        .and_then(|task| {
            task.status
                .lock()
                .ok()
                .map(|value| value.as_str() != LIBRARY_PDF_CACHE_STATE_PENDING)
        })
        .unwrap_or(false);
    if should_remove {
        tasks_guard.remove(task_key);
    }
}

fn start_library_pdf_cache_task(
    state: &crate::state::AppState,
    task_key: &str,
    project_id: &str,
    relative_path: &str,
    source_url: &str,
    cache_path: &Path,
) {
    let task_id = Uuid::new_v4().to_string();
    let task = crate::state::LibraryPdfCacheTask {        status: std::sync::Arc::new(std::sync::Mutex::new(
            LIBRARY_PDF_CACHE_STATE_PENDING.to_string(),
        )),
        error: std::sync::Arc::new(std::sync::Mutex::new(None)),
    };

    let mut should_spawn = false;
    if let Ok(mut tasks_guard) = state.library_pdf_cache_tasks.lock() {
        let existing_pending = tasks_guard
            .get(task_key)
            .and_then(|existing| {
                existing
                    .status
                    .lock()
                    .ok()
                    .map(|status| status.as_str() == LIBRARY_PDF_CACHE_STATE_PENDING)
            })
            .unwrap_or(false);
        if !existing_pending {
            tasks_guard.insert(task_key.to_string(), task);
            should_spawn = true;
        }
    }
    if !should_spawn {
        return;
    }

    let session_log_path = state.session_log_path.clone();
    let tasks = state.library_pdf_cache_tasks.clone();
    let task_key_value = task_key.to_string();
    let project_id_value = project_id.to_string();
    let relative_path_value = relative_path.to_string();
    let source_url_value = source_url.to_string();
    let cache_path_value = cache_path.to_path_buf();

    let _ = crate::logging::append_log_line(
        &session_log_path,
        "INFO",
        &format!(
            "library_pdf_cache.task.start: task_id={}, project={}, path={}, url={}",
            task_id, project_id, relative_path, source_url
        ),
    );

    std::thread::spawn(move || {
        let update_task = |status: &str, error: Option<String>| {
            if let Ok(tasks_guard) = tasks.lock() {
                if let Some(task_ref) = tasks_guard.get(&task_key_value) {
                    if let Ok(mut task_status) = task_ref.status.lock() {
                        *task_status = status.to_string();
                    }
                    if let Ok(mut task_error) = task_ref.error.lock() {
                        *task_error = error;
                    }
                }
            }
        };

        match cache_remote_pdf_file(&cache_path_value, &source_url_value) {
            Ok(_) => {
                update_task(LIBRARY_PDF_CACHE_STATE_READY, None);
                let _ = crate::logging::append_log_line(
                    &session_log_path,
                    "INFO",
                    &format!(
                        "library_pdf_cache.task.completed: task_id={}, project={}, path={}, cache={}",
                        task_id,
                        project_id_value,
                        relative_path_value,
                        cache_path_value.to_string_lossy()
                    ),
                );
            }
            Err(error) => {
                let _ = fs::remove_file(&cache_path_value);
                update_task(LIBRARY_PDF_CACHE_STATE_ERROR, Some(error.clone()));
                let _ = crate::logging::append_log_line(
                    &session_log_path,
                    "ERROR",
                    &format!(
                        "library_pdf_cache.task.failed: task_id={}, project={}, path={}, reason={}",
                        task_id, project_id_value, relative_path_value, error
                    ),
                );
            }
        }
    });
}

pub fn library_resolve_pdf_preview(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<LibraryPdfPreviewResponse, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let normalized_relative = relative_path.trim().replace('\\', "/");
    if normalized_relative.is_empty() {
        return Err("Library path cannot be empty".to_string());
    }

    let source = safe_join(&papers_root, &normalized_relative)?;
    if !source.exists() || !source.is_file() {
        return Err("Library file does not exist".to_string());
    }

    if let Some(local_pdf_path) = resolve_local_pdf_candidate(&source) {
        let source_workspace_relative = to_workspace_relative(&project_root, &local_pdf_path)?;
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            Some(source_workspace_relative),
            None,
            false,
            LIBRARY_PDF_CACHE_STATE_READY,
            None,
        ));
    }

    let citation = library_citation_summary(db_path, project_id, &normalized_relative)?;
    let Some(source_url) = find_remote_pdf_url(&citation) else {
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            None,
            None,
            false,
            LIBRARY_PDF_CACHE_STATE_MISSING,
            None,
        ));
    };

    let cache_dir = papers_root.join(".cache").join("remote-pdf");
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let cache_path = cache_dir.join(format!("{}.pdf", hash_remote_url(&source_url)));

    if !cache_path_ready(&cache_path) {
        cache_remote_pdf_file(&cache_path, &source_url)?;
    }

    let source_workspace_relative = to_workspace_relative(&project_root, &cache_path)?;
    Ok(build_preview_response(
        &project_root,
        &papers_root,
        Some(source_workspace_relative),
        Some(source_url),
        true,
        LIBRARY_PDF_CACHE_STATE_READY,
        None,
    ))
}

pub fn library_resolve_pdf_preview_runtime(
    state: &crate::state::AppState,
    project_id: &str,
    relative_path: &str,
) -> Result<LibraryPdfPreviewResponse, String> {
    let project_root = load_project_root(&state.db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let normalized_relative = relative_path.trim().replace('\\', "/");
    if normalized_relative.is_empty() {
        return Err("Library path cannot be empty".to_string());
    }

    let source = safe_join(&papers_root, &normalized_relative)?;
    if !source.exists() || !source.is_file() {
        return Err("Library file does not exist".to_string());
    }

    if let Some(local_pdf_path) = resolve_local_pdf_candidate(&source) {
        let source_workspace_relative = to_workspace_relative(&project_root, &local_pdf_path)?;
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            Some(source_workspace_relative),
            None,
            false,
            LIBRARY_PDF_CACHE_STATE_READY,
            None,
        ));
    }

    let citation = library_citation_summary(&state.db_path, project_id, &normalized_relative)?;
    let Some(source_url) = find_remote_pdf_url(&citation) else {
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            None,
            None,
            false,
            LIBRARY_PDF_CACHE_STATE_MISSING,
            None,
        ));
    };

    let cache_dir = papers_root.join(".cache").join("remote-pdf");
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    let cache_path = cache_dir.join(format!("{}.pdf", hash_remote_url(&source_url)));
    let task_key = pdf_cache_task_key(project_id, &normalized_relative);

    if cache_path_ready(&cache_path) {
        clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
        let source_workspace_relative = to_workspace_relative(&project_root, &cache_path)?;
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            Some(source_workspace_relative),
            Some(source_url),
            true,
            LIBRARY_PDF_CACHE_STATE_READY,
            None,
        ));
    }

    let (task_status, task_error) = read_pdf_cache_task(&state.library_pdf_cache_tasks, &task_key);
    if matches!(task_status.as_deref(), Some(LIBRARY_PDF_CACHE_STATE_PENDING)) {
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            None,
            Some(source_url),
            false,
            LIBRARY_PDF_CACHE_STATE_PENDING,
            None,
        ));
    }
    if matches!(task_status.as_deref(), Some(LIBRARY_PDF_CACHE_STATE_ERROR)) {
        return Ok(build_preview_response(
            &project_root,
            &papers_root,
            None,
            Some(source_url),
            false,
            LIBRARY_PDF_CACHE_STATE_ERROR,
            task_error,
        ));
    }

    start_library_pdf_cache_task(
        state,
        &task_key,
        project_id,
        &normalized_relative,
        &source_url,
        &cache_path,
    );

    Ok(build_preview_response(
        &project_root,
        &papers_root,
        None,
        Some(source_url),
        false,
        LIBRARY_PDF_CACHE_STATE_PENDING,
        None,
    ))
}