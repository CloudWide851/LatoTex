const LIBRARY_PDF_CACHE_STATE_READY: &str = "ready";
const LIBRARY_PDF_CACHE_STATE_PENDING: &str = "pending";
const LIBRARY_PDF_CACHE_STATE_ERROR: &str = "error";
const LIBRARY_PDF_CACHE_STATE_MISSING: &str = "missing";
const LIBRARY_PDF_CACHE_TASK_STALE_MS: u64 = 180_000;

fn log_library_pdf_preview(state: &crate::state::AppState, message: &str) {
    let _ = crate::logging::append_log_line(&state.session_log_path, "INFO", message);
}

fn pdf_cache_task_key(project_id: &str, relative_path: &str) -> String {
    format!("{project_id}::{}", relative_path.trim().replace('\\', "/"))
}

fn read_pdf_cache_task(
    tasks: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, crate::state::LibraryPdfCacheTask>>>,
    task_key: &str,
) -> (Option<String>, Option<String>, Option<u64>, Option<u64>, Option<u64>) {
    let Ok(tasks_guard) = tasks.lock() else {
        return (None, None, None, None, None);
    };
    let Some(task) = tasks_guard.get(task_key) else {
        return (None, None, None, None, None);
    };
    let status = task.status.lock().ok().map(|value| value.clone());
    let error = task.error.lock().ok().and_then(|value| value.clone());
    let updated_at = Some(task.updated_at_unix_ms.load(std::sync::atomic::Ordering::Relaxed));
    let downloaded_bytes = Some(task.downloaded_bytes.load(std::sync::atomic::Ordering::Relaxed));
    let total_bytes = match task.total_bytes.load(std::sync::atomic::Ordering::Relaxed) {
        0 => None,
        value => Some(value),
    };
    (status, error, updated_at, downloaded_bytes, total_bytes)
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
        downloaded_bytes: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
        total_bytes: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(0)),
        updated_at_unix_ms: std::sync::Arc::new(std::sync::atomic::AtomicU64::new(current_unix_ms())),
    };
    let task_handle = task.clone();

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
            if let Ok(mut task_status) = task_handle.status.lock() {
                *task_status = status.to_string();
            }
            if let Ok(mut task_error) = task_handle.error.lock() {
                *task_error = error;
            }
            task_handle
                .updated_at_unix_ms
                .store(current_unix_ms(), std::sync::atomic::Ordering::Relaxed);
        };

        let update_progress = |downloaded_bytes: u64, total_bytes: Option<u64>| {
            task_handle
                .downloaded_bytes
                .store(downloaded_bytes, std::sync::atomic::Ordering::Relaxed);
            task_handle.total_bytes.store(
                total_bytes.unwrap_or(0),
                std::sync::atomic::Ordering::Relaxed,
            );
            task_handle
                .updated_at_unix_ms
                .store(current_unix_ms(), std::sync::atomic::Ordering::Relaxed);
        };

        match cache_remote_pdf_file(&cache_path_value, &source_url_value, update_progress) {
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
                let _ = fs::remove_file(temp_cache_path(&cache_path_value));
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

fn resolve_sync_remote_preview(
    ctx: &LibraryPdfPreviewContext,
    summary: &LibraryCitationSummaryResponse,
) -> Result<LibraryPdfPreviewResponse, String> {
    let Some(source_url) = find_remote_pdf_url(summary) else {
        return Ok(build_preview_response(
            &ctx.project_root,
            &ctx.papers_root,
            None,
            None,
            false,
            LIBRARY_PDF_CACHE_STATE_MISSING,
            None,
            None,
            None,
        ));
    };

    if let Some(cache_path) = resolve_cached_remote_pdf_path(ctx, &source_url, None)? {
        return build_cached_remote_preview_response(ctx, &source_url, &cache_path);
    }
    let cache_path = build_remote_cache_path(ctx, &source_url)?;
    cache_remote_pdf_file(&cache_path, &source_url, |_, _| {})?;

    build_cached_remote_preview_response(ctx, &source_url, &cache_path)
}

fn resolve_runtime_remote_preview(
    state: &crate::state::AppState,
    ctx: &LibraryPdfPreviewContext,
    project_id: &str,
    summary: &LibraryCitationSummaryResponse,
    bust_cache: bool,
) -> Result<LibraryPdfPreviewResponse, String> {
    let Some(source_url) = find_remote_pdf_url(summary) else {
        return Ok(build_preview_response(
            &ctx.project_root,
            &ctx.papers_root,
            None,
            None,
            false,
            LIBRARY_PDF_CACHE_STATE_MISSING,
            None,
            None,
            None,
        ));
    };

    let cache_path = build_remote_cache_path(ctx, &source_url)?;
    let task_key = pdf_cache_task_key(project_id, &ctx.normalized_relative);

    if bust_cache {
        clear_remote_cache_binding(ctx);
        clear_remote_cache_variants(ctx, &source_url);
        clear_pdf_cache_entry(&state.library_pdf_cache_tasks, &task_key, &cache_path);
    } else if let Some(existing_cache_path) = resolve_cached_remote_pdf_path(ctx, &source_url, None)? {
        clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
        return build_cached_remote_preview_response(ctx, &source_url, &existing_cache_path);
    }

    let (task_status, task_error, task_updated_at, downloaded_bytes, total_bytes) =
        read_pdf_cache_task(&state.library_pdf_cache_tasks, &task_key);
    if matches!(task_status.as_deref(), Some(LIBRARY_PDF_CACHE_STATE_PENDING)) {
        let updated_at = task_updated_at.unwrap_or(0);
        if current_unix_ms().saturating_sub(updated_at) > LIBRARY_PDF_CACHE_TASK_STALE_MS {
            let timeout_error = mark_pdf_cache_task_timed_out(&state.library_pdf_cache_tasks, &task_key);
            clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
            return Ok(build_preview_response(
                &ctx.project_root,
                &ctx.papers_root,
                None,
                Some(source_url),
                false,
                LIBRARY_PDF_CACHE_STATE_ERROR,
                timeout_error,
                downloaded_bytes,
                total_bytes,
            ));
        }
        return Ok(build_preview_response(
            &ctx.project_root,
            &ctx.papers_root,
            None,
            Some(source_url),
            false,
            LIBRARY_PDF_CACHE_STATE_PENDING,
            None,
            downloaded_bytes,
            total_bytes,
        ));
    }
    if matches!(task_status.as_deref(), Some(LIBRARY_PDF_CACHE_STATE_ERROR)) {
        clear_pdf_cache_task_if_terminal(&state.library_pdf_cache_tasks, &task_key);
        return Ok(build_preview_response(
            &ctx.project_root,
            &ctx.papers_root,
            None,
            Some(source_url),
            false,
            LIBRARY_PDF_CACHE_STATE_ERROR,
            task_error,
            downloaded_bytes,
            total_bytes,
        ));
    }

    start_library_pdf_cache_task(
        state,
        &task_key,
        project_id,
        &ctx.normalized_relative,
        &source_url,
        &cache_path,
    );

    Ok(build_preview_response(
        &ctx.project_root,
        &ctx.papers_root,
        None,
        Some(source_url),
        false,
        LIBRARY_PDF_CACHE_STATE_PENDING,
        None,
        Some(0),
        None,
    ))
}

pub fn library_resolve_pdf_preview(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<LibraryPdfPreviewResponse, String> {
    let ctx = prepare_library_pdf_preview_context(db_path, project_id, relative_path)?;
    if let Some(preview) = build_local_preview_response(&ctx, true)? {
        return Ok(preview);
    }

    let citation = library_citation_summary_remote(db_path, project_id, &ctx.normalized_relative)?;
    resolve_sync_remote_preview(&ctx, &citation)
}

pub fn library_resolve_pdf_preview_runtime(
    state: &crate::state::AppState,
    project_id: &str,
    relative_path: &str,
    bust_cache: bool,
) -> Result<LibraryPdfPreviewResponse, String> {
    let ctx = prepare_library_pdf_preview_context(&state.db_path, project_id, relative_path)?;
    if let Some(preview) = build_local_preview_response(&ctx, !bust_cache)? {
        let source = if preview.cached {
            "cached_remote_binding"
        } else {
            "local_pdf"
        };
        log_library_pdf_preview(
            state,
            &format!(
                "library_pdf_preview.local_hit: project={}, path={}, source={}, preview_path={}",
                project_id,
                relative_path,
                source,
                preview.relative_path.as_deref().unwrap_or("-")
            ),
        );
        return Ok(preview);
    }

    log_library_pdf_preview(
        state,
        &format!(
            "library_pdf_preview.remote_lookup_start: project={}, path={}, bust_cache={}",
            project_id, relative_path, bust_cache
        ),
    );
    let citation = library_citation_summary_remote(&state.db_path, project_id, relative_path)?;
    let preview = resolve_runtime_remote_preview(state, &ctx, project_id, &citation, bust_cache)?;
    let preview_state = preview.cache_state.clone();
    let source_url = preview.source_url.clone().unwrap_or_else(|| "-".to_string());
    log_library_pdf_preview(
        state,
        &format!(
            "library_pdf_preview.remote_result: project={}, path={}, state={}, source_url={}, preview_path={}",
            project_id,
            relative_path,
            preview_state,
            source_url,
            preview.relative_path.as_deref().unwrap_or("-")
        ),
    );
    Ok(preview)
}

#[cfg(test)]
#[path = "library_pdf_preview_cache_tests.rs"]
mod library_pdf_preview_cache_tests;
