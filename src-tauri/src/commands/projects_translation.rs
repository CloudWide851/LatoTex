use crate::models::{
    LibraryPaperExtractInput, LibraryPaperExtractResponse, LibraryTranslateInput,
    LibraryTranslateResponse, LibraryTranslateStartResponse, LibraryTranslateStatusInput,
    LibraryTranslateStatusResponse,
};
use crate::state::AppState;
use crate::storage::{self, LibraryTranslateFailure};
use std::path::Path;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

fn translation_failure_summary(failure: &LibraryTranslateFailure) -> String {
    format!(
        "code={} message={} diagnostics={}",
        failure.code,
        failure.message,
        failure.diagnostics.join(" | ")
    )
}

fn append_runtime_log(log_file: &Path, level: &str, message: String) {
    let _ = crate::logging::append_log_line(log_file, level, &message);
}

#[tauri::command]
pub async fn library_translate_document(
    state: State<'_, AppState>,
    input: LibraryTranslateInput,
) -> Result<LibraryTranslateResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_translate_document: project={}, path={}, lang={}, model_override={}",
            input.project_id,
            input.relative_path,
            input.target_language.as_deref().unwrap_or("-"),
            input.model_override.as_deref().unwrap_or("-")
        ),
    );

    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let app_data_dir = state.app_data_dir.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let log_project_id = project_id.clone();
    let log_relative_path = relative_path.clone();
    let target_language = input.target_language;
    let model_override = input.model_override;

    let result = tauri::async_runtime::spawn_blocking(move || {
        storage::translate_library_document(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &relative_path,
            target_language.as_deref(),
            model_override.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())?;

    match result {
        Ok(response) => {
            state.log(
                "INFO",
                &format!(
                    "library_translate_document.result: project={}, path={}, status=completed, engine={}, output={}",
                    log_project_id,
                    log_relative_path,
                    response.engine,
                    response.translated_pdf_relative_path
                ),
            );
            Ok(response)
        }
        Err(failure) => {
            state.log(
                "ERROR",
                &format!(
                    "library_translate_document.result: project={}, path={}, status=failed, {}",
                    log_project_id,
                    log_relative_path,
                    translation_failure_summary(&failure)
                ),
            );
            Err(failure.status_message())
        }
    }
}

#[tauri::command]
pub async fn library_extract_paper_context(
    state: State<'_, AppState>,
    input: LibraryPaperExtractInput,
) -> Result<LibraryPaperExtractResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_extract_paper_context: project={}, path={}",
            input.project_id, input.relative_path,
        ),
    );

    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;

    tauri::async_runtime::spawn_blocking(move || {
        storage::extract_library_paper_context(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &relative_path,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn library_translate_start(
    state: State<'_, AppState>,
    input: LibraryTranslateInput,
) -> Result<LibraryTranslateStartResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_translate_start: project={}, path={}, lang={}, model_override={}",
            input.project_id,
            input.relative_path,
            input.target_language.as_deref().unwrap_or("-"),
            input.model_override.as_deref().unwrap_or("-")
        ),
    );

    let task_id = Uuid::new_v4().to_string();
    let run_id = task_id.clone();
    let task = crate::state::LibraryTranslateTask {
        id: task_id.clone(),
        run_id: run_id.clone(),
        status: Arc::new(Mutex::new("running".to_string())),
        stage: Arc::new(Mutex::new(Some("queued".to_string()))),
        message: Arc::new(Mutex::new(Some("queued".to_string()))),
        error: Arc::new(Mutex::new(None)),
        error_code: Arc::new(Mutex::new(None)),
        diagnostics: Arc::new(Mutex::new(Vec::new())),
        current_page: Arc::new(AtomicU64::new(0)),
        total_pages: Arc::new(AtomicU64::new(0)),
        result: Arc::new(Mutex::new(None)),
    };

    if let Ok(mut tasks) = state.library_translate_tasks.lock() {
        tasks.insert(task_id.clone(), task);
    }

    let session_log_path = state.session_log_path.clone();
    let tasks = state.library_translate_tasks.clone();
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let app_data_dir = state.app_data_dir.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let target_language = input.target_language;
    let model_override = input.model_override;
    let task_id_for_thread = task_id.clone();
    let run_id_for_thread = run_id.clone();

    std::thread::spawn(move || {
        let with_task = |fn_apply: &dyn Fn(&crate::state::LibraryTranslateTask)| {
            if let Ok(tasks_guard) = tasks.lock() {
                if let Some(task_ref) = tasks_guard.get(&task_id_for_thread) {
                    fn_apply(task_ref);
                }
            }
        };

        append_runtime_log(
            &session_log_path,
            "INFO",
            format!(
                "library_translate.task.start: task_id={}, run_id={}, project={}, path={}, lang={}, model_override={}",
                task_id_for_thread,
                run_id_for_thread,
                project_id,
                relative_path,
                target_language.as_deref().unwrap_or("-"),
                model_override.as_deref().unwrap_or("-")
            ),
        );

        with_task(&|task_ref| {
            if let Ok(mut stage) = task_ref.stage.lock() {
                *stage = Some("starting".to_string());
            }
            if let Ok(mut message) = task_ref.message.lock() {
                *message = Some("starting".to_string());
            }
        });

        let mut last_stage_log = String::new();
        let result = storage::translate_library_document_with_progress(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &relative_path,
            target_language.as_deref(),
            model_override.as_deref(),
            |current, total, stage| {
                with_task(&|task_ref| {
                    let stage_value = stage.to_string();
                    let stage_key = if stage_value.starts_with("model:") {
                        "model".to_string()
                    } else {
                        stage_value.clone()
                    };
                    task_ref.current_page.store(current as u64, Ordering::Relaxed);
                    task_ref.total_pages.store(total as u64, Ordering::Relaxed);
                    if let Ok(mut stage_slot) = task_ref.stage.lock() {
                        *stage_slot = Some(stage_key);
                    }
                    if let Ok(mut message) = task_ref.message.lock() {
                        *message = Some(stage_value.clone());
                    }
                });
                let stage_log = format!("stage={} current_page={} total_pages={}", stage, current, total);
                if last_stage_log != stage_log {
                    append_runtime_log(
                        &session_log_path,
                        "INFO",
                        format!(
                            "library_translate.task.progress: task_id={}, run_id={}, {}",
                            task_id_for_thread, run_id_for_thread, stage_log
                        ),
                    );
                    last_stage_log = stage_log;
                }
            },
        );

        match result {
            Ok(response) => {
                with_task(&|task_ref| {
                    if let Ok(mut status) = task_ref.status.lock() {
                        *status = "completed".to_string();
                    }
                    if let Ok(mut stage) = task_ref.stage.lock() {
                        *stage = Some("completed".to_string());
                    }
                    if let Ok(mut message) = task_ref.message.lock() {
                        *message = Some("completed".to_string());
                    }
                    if let Ok(mut result_slot) = task_ref.result.lock() {
                        *result_slot = Some(response.clone());
                    }
                    if let Ok(mut error_slot) = task_ref.error.lock() {
                        *error_slot = None;
                    }
                    if let Ok(mut error_code_slot) = task_ref.error_code.lock() {
                        *error_code_slot = None;
                    }
                    if let Ok(mut diagnostics_slot) = task_ref.diagnostics.lock() {
                        diagnostics_slot.clear();
                    }
                });
                append_runtime_log(
                    &session_log_path,
                    "INFO",
                    format!(
                        "library_translate.task.completed: task_id={}, run_id={}, engine={}, output={}",
                        task_id_for_thread,
                        run_id_for_thread,
                        response.engine,
                        response.translated_pdf_relative_path
                    ),
                );
            }
            Err(failure) => {
                with_task(&|task_ref| {
                    if let Ok(mut status) = task_ref.status.lock() {
                        *status = "failed".to_string();
                    }
                    if let Ok(mut stage) = task_ref.stage.lock() {
                        *stage = Some("failed".to_string());
                    }
                    if let Ok(mut error_slot) = task_ref.error.lock() {
                        *error_slot = Some(failure.message.clone());
                    }
                    if let Ok(mut error_code_slot) = task_ref.error_code.lock() {
                        *error_code_slot = Some(failure.code.clone());
                    }
                    if let Ok(mut diagnostics_slot) = task_ref.diagnostics.lock() {
                        *diagnostics_slot = failure.diagnostics.clone();
                    }
                    if let Ok(mut message) = task_ref.message.lock() {
                        *message = Some(failure.message.clone());
                    }
                });
                append_runtime_log(
                    &session_log_path,
                    "ERROR",
                    format!(
                        "library_translate.task.failed: task_id={}, run_id={}, {}",
                        task_id_for_thread,
                        run_id_for_thread,
                        translation_failure_summary(&failure)
                    ),
                );
            }
        }
    });

    Ok(LibraryTranslateStartResponse { task_id })
}

#[tauri::command]
pub fn library_translate_status(
    state: State<'_, AppState>,
    input: LibraryTranslateStatusInput,
) -> Result<LibraryTranslateStatusResponse, String> {
    let tasks = state
        .library_translate_tasks
        .lock()
        .map_err(|_| "translation.task_lock_failed".to_string())?;
    let task = tasks
        .get(&input.task_id)
        .ok_or_else(|| "translation.task_not_found".to_string())?;

    let status = task
        .status
        .lock()
        .map(|value| value.clone())
        .unwrap_or_else(|_| "failed".to_string());
    let stage = task.stage.lock().ok().and_then(|value| value.clone());
    let message = task.message.lock().ok().and_then(|value| value.clone());
    let error = task.error.lock().ok().and_then(|value| value.clone());
    let error_code = task.error_code.lock().ok().and_then(|value| value.clone());
    let diagnostics = task
        .diagnostics
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let result = task.result.lock().ok().and_then(|value| value.clone());

    Ok(LibraryTranslateStatusResponse {
        task_id: task.id.clone(),
        run_id: Some(task.run_id.clone()),
        status,
        current_page: task.current_page.load(Ordering::Relaxed) as u32,
        total_pages: task.total_pages.load(Ordering::Relaxed) as u32,
        stage,
        message,
        error,
        error_code,
        diagnostics,
        result,
    })
}




