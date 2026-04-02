const LIBRARY_PDF_CACHE_STATE_READY: &str = "ready";
const LIBRARY_PDF_CACHE_STATE_PENDING: &str = "pending";
const LIBRARY_PDF_CACHE_STATE_ERROR: &str = "error";
const LIBRARY_PDF_CACHE_STATE_MISSING: &str = "missing";
const LIBRARY_PDF_CACHE_TASK_STALE_MS: u64 = 40_000;

fn current_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

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

fn pdf_bytes_valid(bytes: &[u8]) -> bool {
    let first_non_whitespace = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    bytes
        .get(first_non_whitespace..)
        .map(|value| value.starts_with(b"%PDF-"))
        .unwrap_or(false)
}

fn cached_pdf_file_ready(cache_path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(cache_path) else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if metadata.len() == 0 {
        return false;
    }
    let mut header = [0_u8; 16];
    let Ok(read) = std::io::Read::read(&mut file, &mut header) else {
        return false;
    };
    pdf_bytes_valid(&header[..read])
}

fn temp_cache_path(cache_target: &Path) -> PathBuf {
    let file_name = cache_target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("paper.pdf");
    cache_target.with_file_name(format!("{file_name}.download"))
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
    if !pdf_bytes_valid(&bytes) {
        return Err("Remote file is not a valid PDF stream".to_string());
    }
    if let Some(parent) = cache_target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp_path = temp_cache_path(cache_target);
    fs::write(&temp_path, &bytes).map_err(|e| e.to_string())?;
    fs::rename(&temp_path, cache_target).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })
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

fn clear_pdf_cache_entry(
    tasks: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, crate::state::LibraryPdfCacheTask>>>,
    task_key: &str,
    cache_path: &Path,
) {
    let _ = fs::remove_file(cache_path);
    if let Ok(mut tasks_guard) = tasks.lock() {
        tasks_guard.remove(task_key);
    }
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
) -> (Option<String>, Option<String>, Option<u64>) {
    let Ok(tasks_guard) = tasks.lock() else {
        return (None, None, None);
    };
    let Some(task) = tasks_guard.get(task_key) else {
        return (None, None, None);
    };
    let status = task.status.lock().ok().map(|value| value.clone());
    let error = task.error.lock().ok().and_then(|value| value.clone());
    let updated_at = Some(task.updated_at_unix_ms.load(std::sync::atomic::Ordering::Relaxed));
    (status, error, updated_at)
}

fn mark_pdf_cache_task_timed_out(
    tasks: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, crate::state::LibraryPdfCacheTask>>>,
    task_key: &str,
) -> Option<String> {
    let timeout_error = format!(
        "library.pdf_cache_timeout: remote PDF cache task exceeded {} ms",
        LIBRARY_PDF_CACHE_TASK_STALE_MS
    );
    let Ok(tasks_guard) = tasks.lock() else {
        return Some(timeout_error);
    };
    let Some(task) = tasks_guard.get(task_key) else {
        return Some(timeout_error);
    };
    if let Ok(mut task_status) = task.status.lock() {
        *task_status = LIBRARY_PDF_CACHE_STATE_ERROR.to_string();
    }
    if let Ok(mut task_error) = task.error.lock() {
        *task_error = Some(timeout_error.clone());
    }
    task.updated_at_unix_ms.store(current_unix_ms(), std::sync::atomic::Ordering::Relaxed);
    Some(timeout_error)
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
    let task = crate::state::LibraryPdfCacheTask {
        status: std::sync::Arc::new(std::sync::Mutex::new(
            LIBRARY_PDF_CACHE_STATE_PENDING.to_string(),
        )),
        error: std::sync::Arc::new(std::sync::Mutex::new(None)),
        updated_at_unix_ms: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(current_unix_ms())),
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
                    task_ref
                        .updated_at_unix_ms
                        .store(current_unix_ms(), std::sync::atomic::Ordering::Relaxed)
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

    let citation = library_citation_summary_remote(db_path, project_id, &normalized_relative)?;
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

    if !cached_pdf_file_ready(&cache_path) {
        let _ = fs::remove_file(&cache_path);
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
    bust_cache: bool,
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

    let citation = library_citation_summary_remote(&state.db_path, project_id, &normalized_relative)?;
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

    if bust_cache {
        clear_pdf_cache_entry(&state.library_pdf_cache_tasks, &task_key, &cache_path);
    } else if cache_path.exists() && !cached_pdf_file_ready(&cache_path) {
        clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
        clear_pdf_cache_entry(&state.library_pdf_cache_tasks, &task_key, &cache_path);
    }

    if cached_pdf_file_ready(&cache_path) {
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

    let (task_status, task_error, task_updated_at) =
        read_pdf_cache_task(&state.library_pdf_cache_tasks, &task_key);
    if matches!(task_status.as_deref(), Some(LIBRARY_PDF_CACHE_STATE_PENDING)) {
        let updated_at = task_updated_at.unwrap_or(0);
        if current_unix_ms().saturating_sub(updated_at) > LIBRARY_PDF_CACHE_TASK_STALE_MS {
            let timeout_error = mark_pdf_cache_task_timed_out(&state.library_pdf_cache_tasks, &task_key);
            clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
            return Ok(build_preview_response(
                &project_root,
                &papers_root,
                None,
                Some(source_url),
                false,
                LIBRARY_PDF_CACHE_STATE_ERROR,
                timeout_error,
            ));
        }
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
        clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
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
#[cfg(test)]
#[path = "library_pdf_preview_cache_tests.rs"]
mod library_pdf_preview_cache_tests;
