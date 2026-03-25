use crate::state::AppState;
use crate::storage;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::fs;
use std::path::Path;
use std::time::SystemTime;
use tauri::State;
#[path = "analysis_search.rs"]
mod analysis_search;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckInput {
    pub queries: Vec<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceEvidence {
    pub title: String,
    pub url: String,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckItem {
    pub query: String,
    pub ok: bool,
    pub message: String,
    pub results: Vec<ReferenceEvidence>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckResponse {
    pub items: Vec<ReferenceCheckItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisAssetInput {
    pub file_name: String,
    pub data_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSaveReportInput {
    pub project_id: String,
    pub run_id: Option<String>,
    pub title: Option<String>,
    pub report_html: String,
    pub assets: Option<Vec<AnalysisAssetInput>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSaveReportResponse {
    pub run_id: String,
    pub run_dir: String,
    pub report_relative_path: String,
    pub asset_relative_paths: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisListReportsInput {
    pub project_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisReportItem {
    pub run_id: String,
    pub report_relative_path: String,
    pub asset_relative_paths: Vec<String>,
    pub updated_at_unix_ms: i64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisListReportsResponse {
    pub reports: Vec<AnalysisReportItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisExportArtifactInput {
    pub project_id: String,
    pub relative_path: String,
    pub default_file_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisExportArtifactResponse {
    pub saved_path: String,
}

fn sanitize_file_name(value: &str) -> String {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        return "asset.bin".to_string();
    }
    trimmed
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '.' || ch == '_' || ch == '-' {
                ch
            } else {
                '_'
            }
        })
        .collect()
}

fn parse_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    if !data_url.starts_with("data:") {
        return Err("Asset payload must be a data URL".to_string());
    }
    let comma_index = data_url
        .find(',')
        .ok_or_else(|| "Invalid data URL".to_string())?;
    let meta = &data_url[..comma_index];
    let payload = &data_url[comma_index + 1..];
    if !meta.ends_with(";base64") {
        return Err("Only base64 data URLs are supported".to_string());
    }
    BASE64_STANDARD
        .decode(payload)
        .map_err(|e| format!("Failed to decode asset payload: {e}"))
}

fn unix_ms(value: SystemTime) -> i64 {
    value
        .duration_since(SystemTime::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as i64)
        .unwrap_or(0)
}

fn ensure_inside_root(root: &Path, path: &Path) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let canonical_path = path.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_path.starts_with(canonical_root) {
        return Err("Path traversal detected".to_string());
    }
    Ok(())
}

#[tauri::command]
pub fn reference_check(
    state: State<'_, AppState>,
    input: ReferenceCheckInput,
) -> Result<ReferenceCheckResponse, String> {
    state.log(
        "INFO",
        &format!("reference_check: {} queries", input.queries.len()),
    );
    analysis_search::run_reference_check_queries(input.queries, input.limit.unwrap_or(5))
}

pub(crate) fn run_reference_check_queries(
    queries: Vec<String>,
    limit: u32,
) -> Result<ReferenceCheckResponse, String> {
    analysis_search::run_reference_check_queries(queries, limit)
}

#[tauri::command]
pub fn analysis_save_report(
    state: State<'_, AppState>,
    input: AnalysisSaveReportInput,
) -> Result<AnalysisSaveReportResponse, String> {
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let analysis_root = root.join(".latotex").join("analysis");
    fs::create_dir_all(&analysis_root).map_err(|e| e.to_string())?;

    let default_run_id = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let run_id = sanitize_file_name(input.run_id.as_deref().unwrap_or(&default_run_id));
    let run_dir = analysis_root.join(&run_id);
    let images_dir = run_dir.join("images");
    fs::create_dir_all(&images_dir).map_err(|e| e.to_string())?;

    let title = input.title.unwrap_or_else(|| "Analysis Report".to_string());
    let html = input.report_html;
    let report_path = run_dir.join("report.html");
    fs::write(&report_path, html).map_err(|e| e.to_string())?;
    let meta_path = run_dir.join("meta.json");
    fs::write(
        &meta_path,
        serde_json::to_string_pretty(&serde_json::json!({
            "title": title,
            "runId": run_id,
            "updatedAt": chrono::Utc::now().to_rfc3339(),
        }))
        .map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;

    let mut asset_relative_paths = Vec::new();
    for asset in input.assets.unwrap_or_default() {
        let file_name = sanitize_file_name(&asset.file_name);
        let bytes = parse_data_url(&asset.data_url)?;
        let target_path = images_dir.join(&file_name);
        fs::write(&target_path, bytes).map_err(|e| e.to_string())?;
        let rel = target_path
            .strip_prefix(&root)
            .map_err(|_| "Failed to resolve relative asset path".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        asset_relative_paths.push(rel);
    }

    let report_relative_path = report_path
        .strip_prefix(&root)
        .map_err(|_| "Failed to resolve report path".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let run_dir_relative = run_dir
        .strip_prefix(&root)
        .map_err(|_| "Failed to resolve run directory".to_string())?
        .to_string_lossy()
        .replace('\\', "/");

    state.log(
        "INFO",
        &format!(
            "analysis_save_report: project={}, run={}, assets={}",
            input.project_id,
            run_id,
            asset_relative_paths.len()
        ),
    );

    Ok(AnalysisSaveReportResponse {
        run_id,
        run_dir: run_dir_relative,
        report_relative_path,
        asset_relative_paths,
    })
}

#[tauri::command]
pub fn analysis_list_reports(
    state: State<'_, AppState>,
    input: AnalysisListReportsInput,
) -> Result<AnalysisListReportsResponse, String> {
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let analysis_root = root.join(".latotex").join("analysis");
    if !analysis_root.exists() {
        return Ok(AnalysisListReportsResponse {
            reports: Vec::new(),
        });
    }

    let mut reports = Vec::new();
    for entry in fs::read_dir(&analysis_root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_dir() {
            continue;
        }
        let run_id = entry.file_name().to_string_lossy().to_string();
        let report_path = path.join("report.html");
        if !report_path.exists() {
            continue;
        }
        let mut asset_relative_paths = Vec::new();
        let images_dir = path.join("images");
        if images_dir.exists() {
            for image in fs::read_dir(images_dir).map_err(|e| e.to_string())? {
                let image = image.map_err(|e| e.to_string())?;
                let image_path = image.path();
                if !image_path.is_file() {
                    continue;
                }
                let rel = image_path
                    .strip_prefix(&root)
                    .map_err(|_| "Failed to resolve asset path".to_string())?
                    .to_string_lossy()
                    .replace('\\', "/");
                asset_relative_paths.push(rel);
            }
        }
        let report_relative_path = report_path
            .strip_prefix(&root)
            .map_err(|_| "Failed to resolve report path".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let updated_at_unix_ms = path
            .metadata()
            .and_then(|meta| meta.modified())
            .map(unix_ms)
            .unwrap_or(0);
        reports.push(AnalysisReportItem {
            run_id,
            report_relative_path,
            asset_relative_paths,
            updated_at_unix_ms,
        });
    }

    reports.sort_by_key(|item| Reverse(item.updated_at_unix_ms));
    state.log(
        "INFO",
        &format!(
            "analysis_list_reports: project={}, count={}",
            input.project_id,
            reports.len()
        ),
    );
    Ok(AnalysisListReportsResponse { reports })
}

#[tauri::command]
pub fn analysis_export_artifact(
    state: State<'_, AppState>,
    input: AnalysisExportArtifactInput,
) -> Result<Option<AnalysisExportArtifactResponse>, String> {
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let relative = input.relative_path.trim().replace('\\', "/");
    if relative.is_empty() {
        return Err("Artifact path cannot be empty".to_string());
    }
    let source_path = root.join(&relative);
    if !source_path.exists() || !source_path.is_file() {
        return Err("Artifact file not found".to_string());
    }
    ensure_inside_root(&root, &source_path)?;

    let default_file_name = input
        .default_file_name
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            source_path
                .file_name()
                .map(|value| value.to_string_lossy().to_string())
                .unwrap_or_else(|| "artifact.bin".to_string())
        });

    let selected = FileDialog::new()
        .set_file_name(&default_file_name)
        .save_file();
    let Some(save_path) = selected else {
        return Ok(None);
    };

    let bytes = fs::read(&source_path).map_err(|e| e.to_string())?;
    fs::write(&save_path, bytes).map_err(|e| e.to_string())?;
    state.log(
        "INFO",
        &format!(
            "analysis_export_artifact: project={}, source={}, target={}",
            input.project_id,
            relative,
            save_path.to_string_lossy()
        ),
    );

    Ok(Some(AnalysisExportArtifactResponse {
        saved_path: save_path.to_string_lossy().to_string(),
    }))
}
