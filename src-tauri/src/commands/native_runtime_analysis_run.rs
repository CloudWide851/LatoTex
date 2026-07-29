use super::native_runtime_analysis_env::{
    ensure_analysis_env_blocking, resolve_analysis_runtime_root,
};
use super::native_runtime_common::{configure_hidden_process, sanitize_log_lines};
use crate::models::{AnalysisPlanInput, AnalysisRunPythonInput, AnalysisRunPythonResponse};
use crate::state::AppState;
use crate::storage;
use ring::digest::{digest, SHA256};
use serde::Serialize;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::State;
use uuid::Uuid;

const ANALYSIS_INPUT_FILE_LIMIT: u64 = 64 * 1024 * 1024;
const ANALYSIS_INPUT_TOTAL_LIMIT: u64 = 256 * 1024 * 1024;
const ANALYSIS_INPUT_FILE_COUNT_LIMIT: usize = 8;
const ANALYSIS_SUPPORTED_EXTENSIONS: [&str; 6] = ["csv", "tsv", "xlsx", "xlsm", "json", "jsonl"];

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct StagedAnalysisFile {
    source_path: String,
    staged_path: String,
    sha256: String,
    size_bytes: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct AnalysisRunnerPayload<'a> {
    prompt: &'a str,
    output_language: &'a str,
    plan: &'a AnalysisPlanInput,
    staged_files: Vec<StagedAnalysisFile>,
}

fn normalize_analysis_run_key(value: &str) -> Result<String, String> {
    let normalized = value.trim();
    if normalized.is_empty()
        || normalized.len() > 128
        || !normalized
            .chars()
            .all(|character| character.is_ascii_alphanumeric() || matches!(character, '-' | '_'))
    {
        return Err("python.run.invalid_task_id".to_string());
    }
    Ok(normalized.to_string())
}

fn validate_analysis_plan(plan: &AnalysisPlanInput) -> Result<(), String> {
    if plan.intent.trim().is_empty() || plan.intent.chars().count() > 16_000 {
        return Err("analysis.plan.invalid_intent".to_string());
    }
    if plan.input_files.is_empty() {
        return Err("analysis.input.missing".to_string());
    }
    if plan.input_files.len() > ANALYSIS_INPUT_FILE_COUNT_LIMIT {
        return Err("analysis.input.too_many_files".to_string());
    }
    if !(0.0 < plan.alpha && plan.alpha < 1.0) {
        return Err("analysis.plan.invalid_alpha".to_string());
    }
    if !matches!(
        plan.missing_value_strategy.as_str(),
        "complete_case" | "report_only"
    ) {
        return Err("analysis.plan.invalid_missing_strategy".to_string());
    }
    if plan.target_columns.len() > 32
        || plan
            .target_columns
            .iter()
            .any(|value| value.trim().is_empty() || value.chars().count() > 512)
        || plan
            .group_column
            .as_ref()
            .is_some_and(|value| value.trim().is_empty() || value.chars().count() > 512)
    {
        return Err("analysis.plan.invalid_columns".to_string());
    }
    Ok(())
}

fn hex_sha256(bytes: &[u8]) -> String {
    digest(&SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn analysis_file_extension(relative_path: &str) -> Result<String, String> {
    let normalized = storage::normalize_workspace_path(relative_path)?;
    let extension = normalized
        .extension()
        .and_then(|value| value.to_str())
        .map(str::to_ascii_lowercase)
        .ok_or_else(|| "analysis.input.unsupported_type".to_string())?;
    if !ANALYSIS_SUPPORTED_EXTENSIONS.contains(&extension.as_str()) {
        return Err("analysis.input.unsupported_type".to_string());
    }
    Ok(extension)
}

fn stage_analysis_inputs_with_limits(
    project_root: &Path,
    run_relative: &str,
    plan: &AnalysisPlanInput,
    file_limit: u64,
    total_limit: u64,
) -> Result<Vec<StagedAnalysisFile>, String> {
    validate_analysis_plan(plan)?;
    let mut staged = Vec::with_capacity(plan.input_files.len());
    let mut total_bytes = 0_u64;
    for (index, source_path) in plan.input_files.iter().enumerate() {
        let extension = analysis_file_extension(source_path)?;
        let bytes = storage::read_binary_under_root(project_root, source_path, file_limit)
            .map_err(|error| {
                if error == "workspace.file_read.too_large" {
                    "analysis.input.file_too_large".to_string()
                } else {
                    error
                }
            })?;
        let size_bytes = bytes.len() as u64;
        total_bytes = total_bytes
            .checked_add(size_bytes)
            .ok_or_else(|| "analysis.input.total_too_large".to_string())?;
        if total_bytes > total_limit {
            return Err("analysis.input.total_too_large".to_string());
        }
        let sha256 = hex_sha256(&bytes);
        let staged_path = format!("inputs/{:02}-{}.{}", index + 1, &sha256[..12], extension);
        let staged_relative = format!("{run_relative}/{staged_path}");
        storage::atomic_write_under_root(project_root, &staged_relative, &bytes, file_limit)?;
        staged.push(StagedAnalysisFile {
            source_path: source_path.clone(),
            staged_path,
            sha256,
            size_bytes,
        });
    }
    Ok(staged)
}

fn stage_analysis_inputs(
    project_root: &Path,
    run_relative: &str,
    plan: &AnalysisPlanInput,
) -> Result<Vec<StagedAnalysisFile>, String> {
    stage_analysis_inputs_with_limits(
        project_root,
        run_relative,
        plan,
        ANALYSIS_INPUT_FILE_LIMIT,
        ANALYSIS_INPUT_TOTAL_LIMIT,
    )
}

#[tauri::command]
pub async fn analysis_run_python(
    state: State<'_, AppState>,
    input: AnalysisRunPythonInput,
) -> Result<AnalysisRunPythonResponse, String> {
    state.log(
        "INFO",
        &format!(
            "analysis_run_python: project={}, task={}, files={}",
            input.project_id,
            input.task_id.as_deref().unwrap_or("-"),
            input.plan.input_files.len()
        ),
    );
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let session_log_path = state.session_log_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        validate_analysis_plan(&input.plan)?;
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
        let analysis_runtime_root = resolve_analysis_runtime_root()
            .ok_or_else(|| "python.env.runtime_resource_missing".to_string())?;
        let run_key = input
            .task_id
            .as_deref()
            .map(normalize_analysis_run_key)
            .transpose()?
            .unwrap_or_else(|| Uuid::new_v4().to_string());
        let run_relative = format!(".latotex/analysis-runtime/{run_key}");
        let input_relative = format!("{run_relative}/input.json");
        let output_relative = format!("{run_relative}/output.json");
        let staged_files = stage_analysis_inputs(&project_root, &run_relative, &input.plan)?;
        let runner_payload = AnalysisRunnerPayload {
            prompt: &input.prompt,
            output_language: &input.output_language,
            plan: &input.plan,
            staged_files,
        };
        let payload = serde_json::to_string_pretty(&runner_payload).map_err(|e| e.to_string())?;
        let input_path = storage::atomic_write_under_root(
            &project_root,
            &input_relative,
            payload.as_bytes(),
            storage::WORKSPACE_TEXT_FILE_LIMIT,
        )?;
        let output_path =
            storage::prepare_workspace_mutation_path(&project_root, &output_relative)?;

        let mut command = Command::new(&python_path);
        configure_hidden_process(&mut command);
        let output = command
            .arg(analysis_runtime_root.join("analysis_runner.py"))
            .arg("--input")
            .arg(&input_path)
            .arg("--output")
            .arg(&output_path)
            .current_dir(
                input_path
                    .parent()
                    .ok_or_else(|| "python.run.invalid_staging_root".to_string())?,
            )
            .output()
            .map_err(|error| format!("python.run.spawn_failed: {error}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let sanitized_stdout = sanitize_log_lines(&stdout).join("\n");
        let sanitized_stderr = sanitize_log_lines(&stderr).join("\n");
        let diagnostics = sanitize_log_lines(&format!("{stdout}\n{stderr}"));
        let output_json = if output_path.exists() {
            storage::read_text_under_root(
                &project_root,
                &output_relative,
                storage::WORKSPACE_TEXT_FILE_LIMIT,
            )?
        } else {
            String::new()
        };
        if !output.status.success() {
            let _ = crate::logging::append_log_line(
                &session_log_path,
                "ERROR",
                &format!(
                    "analysis_run_python.failed: code=python.run.failed diagnostics={}",
                    diagnostics.join(" | ")
                ),
            );
            return Err("python.run.failed".to_string());
        }
        let profile_json = if output_json.trim().is_empty() {
            serde_json::json!({
                "runtimeSource": "uv",
                "status": "empty"
            })
        } else {
            serde_json::from_str(&output_json).map_err(|_| "python.run.invalid_json".to_string())?
        };

        Ok(AnalysisRunPythonResponse {
            status: "completed".to_string(),
            runtime_source: "uv".to_string(),
            python_path: python_path.to_string_lossy().to_string(),
            venv_path: env_status.venv_path,
            stdout: sanitized_stdout,
            stderr: sanitized_stderr,
            diagnostics,
            profile_json,
        })
    })
    .await
    .map_err(|error| error.to_string())?
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_analysis_run_key, stage_analysis_inputs_with_limits, validate_analysis_plan,
    };
    use crate::models::AnalysisPlanInput;
    use std::fs;

    fn plan(input_files: Vec<String>) -> AnalysisPlanInput {
        AnalysisPlanInput {
            intent: "Compare the outcome by group".to_string(),
            input_files,
            target_columns: vec!["data.csv:outcome".to_string()],
            group_column: Some("data.csv:group".to_string()),
            paired: Some(false),
            missing_value_strategy: "complete_case".to_string(),
            alpha: 0.05,
        }
    }

    fn temp_root(name: &str) -> std::path::PathBuf {
        let root = std::env::temp_dir().join(format!(
            "latotex-analysis-stage-{name}-{}",
            uuid::Uuid::new_v4()
        ));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn analysis_run_key_rejects_path_components() {
        assert!(normalize_analysis_run_key("analysis-abc_123").is_ok());
        assert_eq!(
            normalize_analysis_run_key("../outside").unwrap_err(),
            "python.run.invalid_task_id"
        );
        assert_eq!(
            normalize_analysis_run_key(r"folder\outside").unwrap_err(),
            "python.run.invalid_task_id"
        );
    }

    #[test]
    fn plan_validation_rejects_invalid_alpha_and_excess_files() {
        let mut invalid_alpha = plan(vec!["data.csv".to_string()]);
        invalid_alpha.alpha = 1.0;
        assert_eq!(
            validate_analysis_plan(&invalid_alpha).unwrap_err(),
            "analysis.plan.invalid_alpha"
        );
        let too_many = plan((0..9).map(|index| format!("data-{index}.csv")).collect());
        assert_eq!(
            validate_analysis_plan(&too_many).unwrap_err(),
            "analysis.input.too_many_files"
        );
    }

    #[test]
    fn staging_copies_supported_files_with_hashes() {
        let root = temp_root("happy");
        fs::write(root.join("data.csv"), b"group,outcome\nA,1\nB,2\n").unwrap();
        let staged = stage_analysis_inputs_with_limits(
            &root,
            ".latotex/analysis-runtime/run",
            &plan(vec!["data.csv".to_string()]),
            1024,
            2048,
        )
        .unwrap();
        assert_eq!(staged.len(), 1);
        assert_eq!(staged[0].source_path, "data.csv");
        assert_eq!(staged[0].sha256.len(), 64);
        assert!(root
            .join(".latotex/analysis-runtime/run")
            .join(&staged[0].staged_path)
            .is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn staging_rejects_traversal_and_total_quota_without_payload() {
        let root = temp_root("bounds");
        fs::write(root.join("one.csv"), b"12345678").unwrap();
        fs::write(root.join("two.csv"), b"12345678").unwrap();
        assert_eq!(
            stage_analysis_inputs_with_limits(
                &root,
                ".latotex/analysis-runtime/run",
                &plan(vec!["../outside.csv".to_string()]),
                16,
                16,
            )
            .unwrap_err(),
            "workspace.path.outside_root"
        );
        assert_eq!(
            stage_analysis_inputs_with_limits(
                &root,
                ".latotex/analysis-runtime/run",
                &plan(vec!["one.csv".to_string(), "two.csv".to_string()]),
                16,
                12,
            )
            .unwrap_err(),
            "analysis.input.total_too_large"
        );
        assert!(!root
            .join(".latotex/analysis-runtime/run/input.json")
            .exists());
        let _ = fs::remove_dir_all(root);
    }
}
