use super::native_runtime_latex_core::{compile_blocking, compile_blocking_with_progress};
use crate::models::{
    LatexCompileInput, LatexCompileResponse, LatexCompileStartResponse,
    LatexCompileTaskStatusResponse, NativeTaskStatusInput,
};
use crate::state::{AppState, LatexCompileTask};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

fn append_runtime_log(log_file: &std::path::Path, level: &str, message: String) {
    let _ = crate::logging::append_log_line(log_file, level, &message);
}

fn snapshot_latex_compile_task(
    task: &LatexCompileTask,
) -> Result<LatexCompileTaskStatusResponse, String> {
    Ok(LatexCompileTaskStatusResponse {
        task_id: task.id.clone(),
        status: task
            .status
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        stage: task
            .stage
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        percent: task.percent_basis_points.load(Ordering::Relaxed) as f64 / 100.0,
        message: task
            .message
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        current_item: task
            .current_item
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        latest_log_line: task
            .latest_log_line
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        error: task
            .error
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        diagnostics: task
            .diagnostics
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
        result: task
            .result
            .lock()
            .map_err(|_| "compile.task_lock_failed".to_string())?
            .clone(),
    })
}

#[tauri::command]
pub async fn latex_compile_native(
    state: State<'_, AppState>,
    input: LatexCompileInput,
) -> Result<LatexCompileResponse, String> {
    let project_id = input.project_id.clone();
    let main_path = input.main_path.clone();
    let reason = input.reason.clone().unwrap_or_else(|| "manual".to_string());
    state.log(
        "INFO",
        &format!(
            "latex_compile_native: project={}, file={}, reason={}",
            input.project_id, input.main_path, reason
        ),
    );

    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let response = tauri::async_runtime::spawn_blocking(move || {
        compile_blocking(&db_path, &runtime_root, input)
    })
    .await
    .map_err(|e| e.to_string())??;
    state.log(
        if response.status == "success" {
            "INFO"
        } else {
            "ERROR"
        },
        &format!(
            "latex_compile_native.result: project={}, file={}, status={}, engine={}, duration_ms={}, diagnostics={}",
            project_id,
            main_path,
            response.status,
            response.engine,
            response.duration_ms,
            response.diagnostics.join(" | ")
        ),
    );
    Ok(response)
}

#[tauri::command]
pub fn latex_compile_start(
    state: State<'_, AppState>,
    input: LatexCompileInput,
) -> Result<LatexCompileStartResponse, String> {
    state.log(
        "INFO",
        &format!(
            "latex_compile_start: project={}, file={}, reason={}",
            input.project_id,
            input.main_path,
            input.reason.as_deref().unwrap_or("manual")
        ),
    );
    let task_id = Uuid::new_v4().to_string();
    let task = LatexCompileTask {
        id: task_id.clone(),
        status: Arc::new(Mutex::new("running".to_string())),
        stage: Arc::new(Mutex::new(Some("queued".to_string()))),
        message: Arc::new(Mutex::new(Some("queued".to_string()))),
        current_item: Arc::new(Mutex::new(None)),
        latest_log_line: Arc::new(Mutex::new(None)),
        percent_basis_points: Arc::new(AtomicU64::new(0)),
        error: Arc::new(Mutex::new(None)),
        diagnostics: Arc::new(Mutex::new(Vec::new())),
        result: Arc::new(Mutex::new(None)),
    };
    state
        .latex_compile_tasks
        .lock()
        .map_err(|_| "compile.task_lock_failed".to_string())?
        .insert(task_id.clone(), task);

    let tasks = state.latex_compile_tasks.clone();
    let session_log_path = state.session_log_path.clone();
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let task_id_for_thread = task_id.clone();
    let project_id = input.project_id.clone();
    let main_path = input.main_path.clone();

    std::thread::spawn(move || {
        let with_task = |fn_apply: &dyn Fn(&LatexCompileTask)| {
            if let Ok(tasks_guard) = tasks.lock() {
                if let Some(task_ref) = tasks_guard.get(&task_id_for_thread) {
                    fn_apply(task_ref);
                }
            }
        };
        let mut last_progress = String::new();
        append_runtime_log(
            &session_log_path,
            "INFO",
            format!(
                "latex_compile.task.start: task_id={}, project={}, file={}",
                task_id_for_thread, project_id, main_path
            ),
        );
        match compile_blocking_with_progress(
            &db_path,
            &runtime_root,
            input,
            |percent, stage, current_item, latest_log_line| {
                with_task(&|task_ref| {
                    task_ref.percent_basis_points.store(
                        (percent.clamp(0.0, 100.0) * 100.0).round() as u64,
                        Ordering::Relaxed,
                    );
                    if let Ok(mut stage_slot) = task_ref.stage.lock() {
                        *stage_slot = Some(stage.to_string());
                    }
                    if let Ok(mut message_slot) = task_ref.message.lock() {
                        *message_slot = Some(stage.to_string());
                    }
                    if let Ok(mut current_item_slot) = task_ref.current_item.lock() {
                        *current_item_slot = current_item.map(|value| value.to_string());
                    }
                    if let Ok(mut latest_slot) = task_ref.latest_log_line.lock() {
                        *latest_slot = latest_log_line.map(|value| value.to_string());
                    }
                });
                let log_line = format!(
                    "stage={} percent={:.1} current_item={} latest={}",
                    stage,
                    percent,
                    current_item.unwrap_or("-"),
                    latest_log_line.unwrap_or("-")
                );
                if log_line != last_progress {
                    append_runtime_log(
                        &session_log_path,
                        "INFO",
                        format!(
                            "latex_compile.task.progress: task_id={}, {}",
                            task_id_for_thread, log_line
                        ),
                    );
                    last_progress = log_line;
                }
            },
        ) {
            Ok(result) => {
                with_task(&|task_ref| {
                    if let Ok(mut status_slot) = task_ref.status.lock() {
                        *status_slot = "completed".to_string();
                    }
                    if let Ok(mut stage_slot) = task_ref.stage.lock() {
                        *stage_slot = Some("completed".to_string());
                    }
                    if let Ok(mut message_slot) = task_ref.message.lock() {
                        *message_slot = Some(result.status.clone());
                    }
                    if let Ok(mut error_slot) = task_ref.error.lock() {
                        *error_slot = None;
                    }
                    if let Ok(mut diagnostics_slot) = task_ref.diagnostics.lock() {
                        *diagnostics_slot = result.diagnostics.clone();
                    }
                    if let Ok(mut result_slot) = task_ref.result.lock() {
                        *result_slot = Some(result.clone());
                    }
                    task_ref.percent_basis_points.store(10_000, Ordering::Relaxed);
                });
                append_runtime_log(
                    &session_log_path,
                    if result.status == "success" {
                        "INFO"
                    } else {
                        "ERROR"
                    },
                    format!(
                        "latex_compile.task.completed: task_id={}, status={}, engine={}, duration_ms={}",
                        task_id_for_thread, result.status, result.engine, result.duration_ms
                    ),
                );
            }
            Err(error) => {
                with_task(&|task_ref| {
                    if let Ok(mut status_slot) = task_ref.status.lock() {
                        *status_slot = "failed".to_string();
                    }
                    if let Ok(mut stage_slot) = task_ref.stage.lock() {
                        *stage_slot = Some("failed".to_string());
                    }
                    if let Ok(mut message_slot) = task_ref.message.lock() {
                        *message_slot = Some(error.clone());
                    }
                    if let Ok(mut error_slot) = task_ref.error.lock() {
                        *error_slot = Some(error.clone());
                    }
                    if let Ok(mut diagnostics_slot) = task_ref.diagnostics.lock() {
                        *diagnostics_slot = vec![error.clone()];
                    }
                });
                append_runtime_log(
                    &session_log_path,
                    "ERROR",
                    format!(
                        "latex_compile.task.failed: task_id={}, error={}",
                        task_id_for_thread, error
                    ),
                );
            }
        }
    });

    Ok(LatexCompileStartResponse { task_id })
}

#[tauri::command]
pub fn latex_compile_status(
    state: State<'_, AppState>,
    input: NativeTaskStatusInput,
) -> Result<LatexCompileTaskStatusResponse, String> {
    let tasks = state
        .latex_compile_tasks
        .lock()
        .map_err(|_| "compile.task_lock_failed".to_string())?;
    let task = tasks
        .get(&input.task_id)
        .ok_or_else(|| "compile.task_not_found".to_string())?;
    snapshot_latex_compile_task(task)
}
