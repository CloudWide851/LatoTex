use super::native_runtime_analysis_env::{
    analysis_env_status_blocking, ensure_analysis_env_blocking, project_env_key,
    resolve_analysis_env_paths, resolve_analysis_runtime_root, resolve_uv_path,
};
use super::native_runtime_common::{configure_hidden_process, sanitize_log_lines, try_version_command};
use crate::models::{AnalysisEnvStatusResponse, AnalysisRunPythonInput, AnalysisRunPythonResponse};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use tauri::State;
use uuid::Uuid;

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

