use crate::models::{
    LibraryTranslateInput, LibraryTranslateResponse, LibraryTranslateStartResponse,
    LibraryTranslateStatusInput, LibraryTranslateStatusResponse,
};
use crate::state::AppState;
use crate::storage;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub async fn library_translate_document(
    state: State<'_, AppState>,
    input: LibraryTranslateInput,
) -> Result<LibraryTranslateResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_translate_document: project={}, path={}, lang={}",
            input.project_id,
            input.relative_path,
            input.target_language.as_deref().unwrap_or("-")
        ),
    );

    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let target_language = input.target_language;
    let model_override = input.model_override;

    tauri::async_runtime::spawn_blocking(move || {
        storage::translate_library_document(
            &db_path,
            &runtime_root,
            &project_id,
            &relative_path,
            target_language.as_deref(),
            model_override.as_deref(),
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
            "library_translate_start: project={}, path={}, lang={}",
            input.project_id,
            input.relative_path,
            input.target_language.as_deref().unwrap_or("-")
        ),
    );

    let task_id = Uuid::new_v4().to_string();
    let task = crate::state::LibraryTranslateTask {
        id: task_id.clone(),
        status: Arc::new(Mutex::new("running".to_string())),
        message: Arc::new(Mutex::new(Some("queued".to_string()))),
        error: Arc::new(Mutex::new(None)),
        current_page: Arc::new(AtomicU64::new(0)),
        total_pages: Arc::new(AtomicU64::new(0)),
        result: Arc::new(Mutex::new(None)),
    };

    if let Ok(mut tasks) = state.library_translate_tasks.lock() {
        tasks.insert(task_id.clone(), task);
    }

    let tasks = state.library_translate_tasks.clone();
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let target_language = input.target_language;
    let model_override = input.model_override;
    let task_id_for_thread = task_id.clone();

    std::thread::spawn(move || {
        let with_task = |fn_apply: &dyn Fn(&crate::state::LibraryTranslateTask)| {
            if let Ok(tasks_guard) = tasks.lock() {
                if let Some(task_ref) = tasks_guard.get(&task_id_for_thread) {
                    fn_apply(task_ref);
                }
            }
        };

        with_task(&|task_ref| {
            if let Ok(mut message) = task_ref.message.lock() {
                *message = Some("starting".to_string());
            }
        });

        let result = storage::translate_library_document_with_progress(
            &db_path,
            &runtime_root,
            &project_id,
            &relative_path,
            target_language.as_deref(),
            model_override.as_deref(),
            |current, total, stage| {
                with_task(&|task_ref| {
                    task_ref.current_page.store(current as u64, Ordering::Relaxed);
                    task_ref.total_pages.store(total as u64, Ordering::Relaxed);
                    if let Ok(mut message) = task_ref.message.lock() {
                        *message = Some(stage.to_string());
                    }
                });
            },
        );

        match result {
            Ok(response) => {
                with_task(&|task_ref| {
                    if let Ok(mut status) = task_ref.status.lock() {
                        *status = "completed".to_string();
                    }
                    if let Ok(mut message) = task_ref.message.lock() {
                        *message = Some("completed".to_string());
                    }
                    if let Ok(mut result_slot) = task_ref.result.lock() {
                        *result_slot = Some(response.clone());
                    }
                });
            }
            Err(error) => {
                with_task(&|task_ref| {
                    if let Ok(mut status) = task_ref.status.lock() {
                        *status = "failed".to_string();
                    }
                    if let Ok(mut error_slot) = task_ref.error.lock() {
                        *error_slot = Some(error.clone());
                    }
                    if let Ok(mut message) = task_ref.message.lock() {
                        *message = Some("failed".to_string());
                    }
                });
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
    let message = task.message.lock().ok().and_then(|value| value.clone());
    let error = task.error.lock().ok().and_then(|value| value.clone());
    let result = task.result.lock().ok().and_then(|value| value.clone());

    Ok(LibraryTranslateStatusResponse {
        task_id: task.id.clone(),
        status,
        current_page: task.current_page.load(Ordering::Relaxed) as u32,
        total_pages: task.total_pages.load(Ordering::Relaxed) as u32,
        message,
        error,
        result,
    })
}

