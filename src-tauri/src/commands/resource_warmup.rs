use super::local_resources::prepare_drawio_cache_info;
use super::native_runtime::ensure_tectonic_runtime_warmup;
use crate::models::{
    ResourceWarmupResult, ResourceWarmupStartInput, ResourceWarmupStartResponse,
    ResourceWarmupStatusInput, ResourceWarmupTaskStatusResponse,
};
use crate::state::{AppState, ResourceWarmupTask};
use crate::storage;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

fn append_runtime_log(log_file: &std::path::Path, level: &str, message: String) {
    let _ = crate::logging::append_log_line(log_file, level, &message);
}

fn snapshot_resource_warmup_task(
    task: &ResourceWarmupTask,
) -> Result<ResourceWarmupTaskStatusResponse, String> {
    Ok(ResourceWarmupTaskStatusResponse {
        task_id: task.id.clone(),
        status: task
            .status
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
        stage: task
            .stage
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
        percent: task.percent_basis_points.load(Ordering::Relaxed) as f64 / 100.0,
        message: task
            .message
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
        current_item: task
            .current_item
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
        error: task
            .error
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
        diagnostics: task
            .diagnostics
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
        result: task
            .result
            .lock()
            .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
            .clone(),
    })
}

fn normalize_scopes(scopes: &[String]) -> Vec<String> {
    let mut output = Vec::<String>::new();
    for scope in scopes {
        let normalized = scope.trim().to_lowercase();
        if normalized.is_empty() || output.contains(&normalized) {
            continue;
        }
        output.push(normalized);
    }
    output
}

#[tauri::command]
pub fn resource_warmup_start(
    state: State<'_, AppState>,
    input: ResourceWarmupStartInput,
) -> Result<ResourceWarmupStartResponse, String> {
    let scopes = normalize_scopes(&input.scopes);
    if scopes.is_empty() {
        return Err("resource_warmup.scopes_required".to_string());
    }

    state.log(
        "INFO",
        &format!(
            "resource_warmup_start: project={}, scopes={}, library_path={}",
            input.project_id,
            scopes.join(","),
            input.library_relative_path.as_deref().unwrap_or("-")
        ),
    );

    let task_id = Uuid::new_v4().to_string();
    let task = ResourceWarmupTask {
        id: task_id.clone(),
        status: Arc::new(Mutex::new("running".to_string())),
        stage: Arc::new(Mutex::new(Some("queued".to_string()))),
        message: Arc::new(Mutex::new(Some("queued".to_string()))),
        current_item: Arc::new(Mutex::new(None)),
        percent_basis_points: Arc::new(AtomicU64::new(0)),
        error: Arc::new(Mutex::new(None)),
        diagnostics: Arc::new(Mutex::new(Vec::new())),
        result: Arc::new(Mutex::new(None)),
    };
    state
        .resource_warmup_tasks
        .lock()
        .map_err(|_| "resource_warmup.task_lock_failed".to_string())?
        .insert(task_id.clone(), task);

    let state_for_thread = state.inner().clone();
    let session_log_path = state.session_log_path.clone();
    let tasks = state.resource_warmup_tasks.clone();
    let task_id_for_thread = task_id.clone();
    let project_id = input.project_id.clone();
    let library_relative_path = input.library_relative_path.clone();

    std::thread::spawn(move || {
        let with_task = |fn_apply: &dyn Fn(&ResourceWarmupTask)| {
            if let Ok(tasks_guard) = tasks.lock() {
                if let Some(task_ref) = tasks_guard.get(&task_id_for_thread) {
                    fn_apply(task_ref);
                }
            }
        };

        let update_progress = |percent: f64, stage: &str, current_item: Option<&str>, message: Option<&str>| {
            with_task(&|task_ref| {
                task_ref.percent_basis_points.store(
                    (percent.clamp(0.0, 100.0) * 100.0).round() as u64,
                    Ordering::Relaxed,
                );
                if let Ok(mut stage_slot) = task_ref.stage.lock() {
                    *stage_slot = Some(stage.to_string());
                }
                if let Ok(mut current_slot) = task_ref.current_item.lock() {
                    *current_slot = current_item.map(|value| value.to_string());
                }
                if let Ok(mut message_slot) = task_ref.message.lock() {
                    *message_slot = message.map(|value| value.to_string()).or_else(|| Some(stage.to_string()));
                }
            });
        };

        append_runtime_log(
            &session_log_path,
            "INFO",
            format!(
                "resource_warmup.task.start: task_id={}, project={}, scopes={}",
                task_id_for_thread,
                project_id,
                scopes.join(",")
            ),
        );

        let mut result = ResourceWarmupResult {
            drawio: None,
            tectonic: None,
            library_pdf: None,
        };
        let scope_count = scopes.len().max(1) as f64;
        let mut diagnostics = Vec::<String>::new();

        let mut run = || -> Result<(), String> {
            for (index, scope) in scopes.iter().enumerate() {
                let percent_base = (index as f64 / scope_count) * 100.0;
                update_progress(percent_base + 5.0, scope, Some(scope.as_str()), Some(scope.as_str()));
                match scope.as_str() {
                    "drawio" => {
                        let info = prepare_drawio_cache_info(&state_for_thread, "install-first")?;
                        result.drawio = Some(info);
                    }
                    "tectonic" => {
                        let info = ensure_tectonic_runtime_warmup(
                            &state_for_thread.runtime_root,
                            &state_for_thread.app_data_dir,
                        )?;
                        result.tectonic = Some(info);
                    }
                    "librarypdf" => {
                        let relative_path = library_relative_path
                            .as_deref()
                            .map(str::trim)
                            .filter(|value| !value.is_empty())
                            .ok_or_else(|| "resource_warmup.library_path_required".to_string())?;
                        let preview = storage::wait_for_library_pdf_preview_ready(
                            &state_for_thread,
                            &project_id,
                            relative_path,
                            std::time::Duration::from_secs(40),
                        )?;
                        if preview.cache_state == "error" {
                            return Err(preview
                                .cache_error
                                .clone()
                                .unwrap_or_else(|| "resource_warmup.library_pdf_failed".to_string()));
                        }
                        result.library_pdf = Some(preview);
                    }
                    other => {
                        diagnostics.push(format!("resource_warmup.unsupported_scope: {}", other));
                    }
                }
                update_progress(((index + 1) as f64 / scope_count) * 100.0, scope, Some(scope.as_str()), Some("completed"));
            }
            Ok(())
        };

        match run() {
            Ok(_) => {
                with_task(&|task_ref| {
                    if let Ok(mut status_slot) = task_ref.status.lock() {
                        *status_slot = "completed".to_string();
                    }
                    if let Ok(mut stage_slot) = task_ref.stage.lock() {
                        *stage_slot = Some("completed".to_string());
                    }
                    if let Ok(mut message_slot) = task_ref.message.lock() {
                        *message_slot = Some("completed".to_string());
                    }
                    if let Ok(mut diagnostics_slot) = task_ref.diagnostics.lock() {
                        *diagnostics_slot = diagnostics.clone();
                    }
                    if let Ok(mut result_slot) = task_ref.result.lock() {
                        *result_slot = Some(result.clone());
                    }
                    task_ref.percent_basis_points.store(10_000, Ordering::Relaxed);
                });
                append_runtime_log(
                    &session_log_path,
                    "INFO",
                    format!(
                        "resource_warmup.task.completed: task_id={}, project={}, scopes={}",
                        task_id_for_thread,
                        project_id,
                        scopes.join(",")
                    ),
                );
            }
            Err(error) => {
                diagnostics.push(error.clone());
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
                        *diagnostics_slot = diagnostics.clone();
                    }
                    if let Ok(mut result_slot) = task_ref.result.lock() {
                        *result_slot = Some(result.clone());
                    }
                });
                append_runtime_log(
                    &session_log_path,
                    "ERROR",
                    format!(
                        "resource_warmup.task.failed: task_id={}, project={}, reason={}",
                        task_id_for_thread,
                        project_id,
                        error
                    ),
                );
            }
        }
    });

    Ok(ResourceWarmupStartResponse { task_id })
}

#[tauri::command]
pub fn resource_warmup_status(
    state: State<'_, AppState>,
    input: ResourceWarmupStatusInput,
) -> Result<ResourceWarmupTaskStatusResponse, String> {
    let tasks = state
        .resource_warmup_tasks
        .lock()
        .map_err(|_| "resource_warmup.task_lock_failed".to_string())?;
    let task = tasks
        .get(&input.task_id)
        .ok_or_else(|| "resource_warmup.task_not_found".to_string())?;
    snapshot_resource_warmup_task(task)
}


