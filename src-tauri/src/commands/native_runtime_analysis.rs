use super::native_runtime_analysis_env::{
    analysis_env_status_blocking, ensure_analysis_env_blocking,
    ensure_analysis_env_with_progress_blocking, project_env_key, resolve_analysis_env_paths,
    resolve_analysis_runtime_root, resolve_uv_path,
};
use super::native_runtime_common::{configure_hidden_process, sanitize_log_lines, try_version_command};
use crate::models::{
    AnalysisEnvPrepareStartResponse, AnalysisEnvPrepareStatusResponse, AnalysisEnvStatusResponse,
    AnalysisRunPythonInput, AnalysisRunPythonResponse, NativeTaskStatusInput,
};
use crate::state::{AnalysisEnvPrepareTask, AppState};
use crate::storage;
use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

fn append_runtime_log(log_file: &std::path::Path, level: &str, message: String) {
    let _ = crate::logging::append_log_line(log_file, level, &message);
}

fn snapshot_analysis_env_prepare_task(
    task: &AnalysisEnvPrepareTask,
) -> Result<AnalysisEnvPrepareStatusResponse, String> {
    Ok(AnalysisEnvPrepareStatusResponse {
        task_id: task.id.clone(),
        status: task
            .status
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
        stage: task
            .stage
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
        percent: task.percent_basis_points.load(Ordering::Relaxed) as f64 / 100.0,
        message: task
            .message
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
        current_item: task
            .current_item
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
        error: task
            .error
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
        diagnostics: task
            .diagnostics
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
        result: task
            .result
            .lock()
            .map_err(|_| "analysis.env.task_lock_failed".to_string())?
            .clone(),
    })
}
#[tauri::command]
pub async fn analysis_env_prepare(
    state: State<'_, AppState>,
    input: crate::models::ProjectRefInput,
) -> Result<AnalysisEnvStatusResponse, String> {
    state.log(
        "INFO",
        &format!("analysis_env_prepare: project={}", input.project_id),
    );
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &project_id)?;
        ensure_analysis_env_blocking(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &project_root,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn analysis_env_prepare_start(
    state: State<'_, AppState>,
    input: crate::models::ProjectRefInput,
) -> Result<AnalysisEnvPrepareStartResponse, String> {
    state.log(
        "INFO",
        &format!("analysis_env_prepare_start: project={}", input.project_id),
    );
    let task_id = Uuid::new_v4().to_string();
    let task = AnalysisEnvPrepareTask {
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
        .analysis_env_prepare_tasks
        .lock()
        .map_err(|_| "analysis.env.task_lock_failed".to_string())?
        .insert(task_id.clone(), task);

    let tasks = state.analysis_env_prepare_tasks.clone();
    let session_log_path = state.session_log_path.clone();
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    let task_id_for_thread = task_id.clone();

    std::thread::spawn(move || {
        let with_task = |fn_apply: &dyn Fn(&AnalysisEnvPrepareTask)| {
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
                "analysis_env_prepare.task.start: task_id={}, project={}",
                task_id_for_thread, project_id
            ),
        );
        match storage::load_project_root(&db_path, &project_id).and_then(|project_root| {
            ensure_analysis_env_with_progress_blocking(
                &db_path,
                &runtime_root,
                &app_data_dir,
                &project_id,
                &project_root,
                |percent, stage, current_item| {
                    with_task(&|task_ref| {
                        task_ref
                            .percent_basis_points
                            .store((percent.clamp(0.0, 100.0) * 100.0).round() as u64, Ordering::Relaxed);
                        if let Ok(mut stage_slot) = task_ref.stage.lock() {
                            *stage_slot = Some(stage.to_string());
                        }
                        if let Ok(mut message_slot) = task_ref.message.lock() {
                            *message_slot = Some(stage.to_string());
                        }
                        if let Ok(mut current_item_slot) = task_ref.current_item.lock() {
                            *current_item_slot = current_item.map(|value| value.to_string());
                        }
                    });
                    let log_line = format!(
                        "stage={} percent={:.1} current_item={}",
                        stage,
                        percent,
                        current_item.unwrap_or("-")
                    );
                    if log_line != last_progress {
                        append_runtime_log(
                            &session_log_path,
                            "INFO",
                            format!(
                                "analysis_env_prepare.task.progress: task_id={}, {}",
                                task_id_for_thread, log_line
                            ),
                        );
                        last_progress = log_line;
                    }
                },
            )
        }) {
            Ok(status) => {
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
                    if let Ok(mut current_item_slot) = task_ref.current_item.lock() {
                        *current_item_slot = Some(status.venv_path.clone());
                    }
                    task_ref.percent_basis_points.store(10_000, Ordering::Relaxed);
                    if let Ok(mut error_slot) = task_ref.error.lock() {
                        *error_slot = None;
                    }
                    if let Ok(mut diagnostics_slot) = task_ref.diagnostics.lock() {
                        diagnostics_slot.clear();
                    }
                    if let Ok(mut result_slot) = task_ref.result.lock() {
                        *result_slot = Some(status.clone());
                    }
                });
                append_runtime_log(
                    &session_log_path,
                    "INFO",
                    format!(
                        "analysis_env_prepare.task.completed: task_id={}, venv_path={}",
                        task_id_for_thread, status.venv_path
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
                        "analysis_env_prepare.task.failed: task_id={}, error={}",
                        task_id_for_thread, error
                    ),
                );
            }
        }
    });

    Ok(AnalysisEnvPrepareStartResponse { task_id })
}

#[tauri::command]
pub fn analysis_env_prepare_status(
    state: State<'_, AppState>,
    input: NativeTaskStatusInput,
) -> Result<AnalysisEnvPrepareStatusResponse, String> {
    let tasks = state
        .analysis_env_prepare_tasks
        .lock()
        .map_err(|_| "analysis.env.task_lock_failed".to_string())?;
    let task = tasks
        .get(&input.task_id)
        .ok_or_else(|| "analysis.env.task_not_found".to_string())?;
    snapshot_analysis_env_prepare_task(task)
}

#[tauri::command]
pub async fn analysis_env_status(
    state: State<'_, AppState>,
    input: crate::models::ProjectRefInput,
) -> Result<AnalysisEnvStatusResponse, String> {
    state.log(
        "INFO",
        &format!("analysis_env_status: project={}", input.project_id),
    );
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &project_id)?;
        match analysis_env_status_blocking(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &project_root,
        ) {
            Ok(status) => Ok(status),
            Err(error) => {
                let resolved_paths = resolve_analysis_env_paths(
                    &db_path,
                    &runtime_root,
                    &app_data_dir,
                    &project_id,
                    &project_root,
                )
                .ok();
                Ok(AnalysisEnvStatusResponse {
                    ready: false,
                    exists: false,
                    env_key: resolved_paths
                        .as_ref()
                        .map(|paths| paths.env_key.clone())
                        .unwrap_or_else(|| {
                            project_env_key(&project_root)
                                .unwrap_or_else(|_| "unknown".to_string())
                        }),
                    managed_root: resolved_paths
                        .as_ref()
                        .map(|paths| paths.managed_root.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    uv_path: resolve_uv_path().map(|path| path.to_string_lossy().to_string()),
                    uv_version: resolve_uv_path()
                        .and_then(|path| try_version_command(&path, &["--version"])),
                    python_path: None,
                    python_version: None,
                    pdf_math_translate_version: None,
                    venv_path: resolved_paths
                        .as_ref()
                        .map(|paths| paths.venv_path.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    runtime_root: resolve_analysis_runtime_root()
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    last_error: Some(error),
                })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn analysis_env_pick_directory(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.log("INFO", "analysis_env_pick_directory");
    Ok(FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn analysis_run_python(
    state: State<'_, AppState>,
    input: AnalysisRunPythonInput,
) -> Result<AnalysisRunPythonResponse, String> {
    state.log(
        "INFO",
        &format!(
            "analysis_run_python: project={}, task={}, snapshots={}",
            input.project_id,
            input.task_id.as_deref().unwrap_or("-"),
            input.snapshots.len()
        ),
    );
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &input.project_id)?;
        let env_status = ensure_analysis_env_blocking(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &input.project_id,
            &project_root,
        )?;
        let python_path = PathBuf::from(
            env_status
                .python_path
                .clone()
                .ok_or_else(|| "python.env.python_missing".to_string())?,
        );
        let runtime_root = resolve_analysis_runtime_root()
            .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
        let run_root = project_root.join(".latotex/analysis-runtime").join(
            input
                .task_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        );
        fs::create_dir_all(&run_root).map_err(|e| e.to_string())?;
        let input_path = run_root.join("input.json");
        let output_path = run_root.join("output.json");
        let payload = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
        fs::write(&input_path, payload).map_err(|e| e.to_string())?;

        let mut command = Command::new(&python_path);
        configure_hidden_process(&mut command);
        let output = command
            .arg(runtime_root.join("analysis_runner.py"))
            .arg("--input")
            .arg(&input_path)
            .arg("--output")
            .arg(&output_path)
            .output()
            .map_err(|e| format!("python.run.spawn_failed: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let output_json = if output_path.exists() {
            fs::read_to_string(&output_path).map_err(|e| e.to_string())?
        } else {
            String::new()
        };
        if !output.status.success() {
            let diagnostics = sanitize_log_lines(&format!("{}\n{}", stdout, stderr));
            return Err(format!(
                "python.run.failed: {}",
                diagnostics
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "analysis runner failed".to_string())
            ));
        }
        let profile_json = if output_json.trim().is_empty() {
            serde_json::json!({
                "runtimeSource": "uv",
                "status": "empty"
            })
        } else {
            serde_json::from_str(&output_json)
                .map_err(|e| format!("python.run.invalid_json: {e}"))?
        };

        Ok(AnalysisRunPythonResponse {
            status: "completed".to_string(),
            runtime_source: "uv".to_string(),
            python_path: python_path.to_string_lossy().to_string(),
            venv_path: env_status.venv_path,
            stdout: stdout.trim().to_string(),
            stderr: stderr.trim().to_string(),
            diagnostics: sanitize_log_lines(&format!("{}\n{}", stdout, stderr)),
            profile_json,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}




