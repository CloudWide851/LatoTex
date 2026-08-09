use crate::state::AppState;
use crate::storage;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use rfd::FileDialog;
use serde::{Deserialize, Serialize};
use std::cmp::Reverse;
use std::fs;
use std::time::SystemTime;
use tauri::State;
#[path = "analysis_academic_providers.rs"]
mod analysis_academic_providers;
#[path = "analysis_domain_providers.rs"]
mod analysis_domain_providers;
#[path = "analysis_fulltext.rs"]
mod analysis_fulltext;
#[path = "analysis_research_providers.rs"]
mod analysis_research_providers;
#[path = "analysis_search.rs"]
mod analysis_search;
#[path = "analysis_search_coordinator.rs"]
mod analysis_search_coordinator;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckInput {
    pub queries: Vec<String>,
    pub limit: Option<u32>,
    pub project_id: Option<String>,
    pub unpaywall_contact_email: Option<String>,
    pub research_plan: Option<AnalysisResearchPlanInput>,
    pub deep: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisResearchPlanInput {
    pub intent: String,
    pub queries: Vec<String>,
    pub inclusion_criteria: Vec<String>,
    pub exclusion_criteria: Vec<String>,
    pub data_checks: Vec<String>,
    pub expected_validations: Vec<String>,
    pub network_requirement: String,
    pub network_reason_code: String,
}

fn validate_research_plan(plan: &AnalysisResearchPlanInput) -> Result<(), String> {
    if plan.intent.trim().is_empty() || plan.intent.chars().count() > 1_200 {
        return Err("analysis.research_plan.invalid_intent".to_string());
    }
    if plan.queries.is_empty()
        || plan.queries.len() > 8
        || plan
            .queries
            .iter()
            .any(|query| query.trim().is_empty() || query.chars().count() > 512)
    {
        return Err("analysis.research_plan.invalid_queries".to_string());
    }
    if !matches!(
        plan.network_requirement.as_str(),
        "required" | "optional" | "not_needed"
    ) || plan.network_reason_code.trim().is_empty()
        || plan.inclusion_criteria.len() > 16
        || plan.exclusion_criteria.len() > 16
        || plan.data_checks.len() > 16
        || plan.expected_validations.len() > 16
    {
        return Err("analysis.research_plan.invalid_policy".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod research_plan_tests {
    use super::{validate_research_plan, AnalysisResearchPlanInput};

    fn plan() -> AnalysisResearchPlanInput {
        AnalysisResearchPlanInput {
            intent: "Compare evidence".to_string(),
            queries: vec!["evidence query".to_string()],
            inclusion_criteria: vec!["topic-match".to_string()],
            exclusion_criteria: vec!["missing-title".to_string()],
            data_checks: vec!["schema".to_string()],
            expected_validations: vec!["review-gate".to_string()],
            network_requirement: "required".to_string(),
            network_reason_code: "explicit_research_evidence".to_string(),
        }
    }

    #[test]
    fn research_plan_validation_accepts_bounded_contract() {
        assert!(validate_research_plan(&plan()).is_ok());
    }

    #[test]
    fn research_plan_validation_rejects_unknown_network_policy() {
        let mut value = plan();
        value.network_requirement = "always".to_string();
        assert_eq!(
            validate_research_plan(&value).unwrap_err(),
            "analysis.research_plan.invalid_policy"
        );
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceEvidence {
    pub stable_id: String,
    pub title: String,
    pub authors: Vec<String>,
    pub year: Option<i32>,
    pub venue: Option<String>,
    pub doi: Option<String>,
    pub arxiv_id: Option<String>,
    pub open_access: Option<bool>,
    pub pdf_url: Option<String>,
    pub landing_url: String,
    pub citation_count: Option<u64>,
    pub abstract_text: Option<String>,
    pub source: String,
    pub evidence_level: String,
    pub provenance: Vec<String>,
    pub original_source_url: String,
    pub rrf_score: f64,
    /// Compatibility projection for existing reference-check consumers.
    pub url: String,
    /// Compatibility projection for existing reference-check consumers.
    pub snippet: String,
}

pub type AcademicEvidence = ReferenceEvidence;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicProviderFailure {
    pub provider: String,
    pub code: String,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AcademicProviderHealth {
    pub provider: String,
    pub category: String,
    pub status: String,
    pub result_count: usize,
    pub cache_age_seconds: Option<u64>,
    pub code: Option<String>,
    pub retryable: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckItem {
    pub query: String,
    pub ok: bool,
    pub message: String,
    /// Compatibility projection. Academic evidence is listed before general-web evidence.
    pub results: Vec<ReferenceEvidence>,
    pub academic_results: Vec<ReferenceEvidence>,
    pub web_results: Vec<ReferenceEvidence>,
    pub provider_errors: Vec<AcademicProviderFailure>,
    pub provider_health: Vec<AcademicProviderHealth>,
    pub network_used: bool,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceCheckResponse {
    pub items: Vec<ReferenceCheckItem>,
}

pub type AcademicSearchResponse = ReferenceCheckResponse;

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

#[tauri::command]
pub fn reference_check(
    state: State<'_, AppState>,
    input: ReferenceCheckInput,
) -> Result<ReferenceCheckResponse, String> {
    state.log(
        "INFO",
        &format!("reference_check: {} queries", input.queries.len()),
    );
    let queries = if let Some(plan) = input.research_plan.as_ref() {
        validate_research_plan(plan)?;
        plan.queries.clone()
    } else {
        input.queries
    };
    run_reference_check_queries_for_project(
        &state.db_path,
        &state.runtime_root,
        Some(&state.app_data_dir),
        input.project_id.as_deref(),
        queries,
        input.limit.unwrap_or(5),
        input.unpaywall_contact_email.as_deref(),
        input.deep.unwrap_or(false),
    )
}

pub(crate) fn run_reference_check_queries_for_project(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: Option<&std::path::Path>,
    project_id: Option<&str>,
    queries: Vec<String>,
    limit: u32,
    unpaywall_contact_email: Option<&str>,
    deep: bool,
) -> Result<ReferenceCheckResponse, String> {
    let project_root = project_id
        .map(|value| storage::load_project_root(db_path, value))
        .transpose()?;
    let configured_email = unpaywall_contact_email
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or_else(|| {
            storage::load_settings(db_path, runtime_root)
                .ok()?
                .ui_prefs?
                .unpaywall_contact_email
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
        });
    let (allow_remote_metadata, allow_verified_oa_download) = match project_id {
        Some(project_id) => {
            let policy = storage::load_research_network_policy(db_path, project_id)?;
            (
                policy.academic_metadata_enabled,
                policy.verified_oa_download_enabled,
            )
        }
        None => (true, false),
    };
    analysis_search::run_reference_check_queries(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        queries,
        limit,
        project_root.as_deref(),
        configured_email.as_deref(),
        deep,
        allow_remote_metadata,
        allow_verified_oa_download,
    )
}

#[tauri::command]
pub fn analysis_save_report(
    state: State<'_, AppState>,
    input: AnalysisSaveReportInput,
) -> Result<AnalysisSaveReportResponse, String> {
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let default_run_id = chrono::Utc::now().format("%Y%m%d-%H%M%S").to_string();
    let run_id = sanitize_file_name(input.run_id.as_deref().unwrap_or(&default_run_id));
    let run_dir_relative = format!(".latotex/analysis/{run_id}");

    let title = input.title.unwrap_or_else(|| "Analysis Report".to_string());
    let html = input.report_html;
    let report_relative_path = format!("{run_dir_relative}/report.html");
    storage::atomic_write_under_root(
        &root,
        &report_relative_path,
        html.as_bytes(),
        storage::WORKSPACE_TEXT_FILE_LIMIT,
    )?;
    let meta_payload = serde_json::to_vec_pretty(&serde_json::json!({
        "title": title,
        "runId": run_id,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
    }))
    .map_err(|e| e.to_string())?;
    storage::atomic_write_under_root(
        &root,
        &format!("{run_dir_relative}/meta.json"),
        &meta_payload,
        storage::WORKSPACE_TEXT_FILE_LIMIT,
    )?;

    let mut asset_relative_paths = Vec::new();
    for asset in input.assets.unwrap_or_default() {
        let file_name = sanitize_file_name(&asset.file_name);
        let bytes = parse_data_url(&asset.data_url)?;
        let rel = format!("{run_dir_relative}/images/{file_name}");
        storage::atomic_write_under_root(
            &root,
            &rel,
            &bytes,
            storage::WORKSPACE_BINARY_FILE_LIMIT,
        )?;
        asset_relative_paths.push(rel);
    }

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
    let source_path = storage::safe_join(&root, &relative)?;
    storage::ensure_workspace_binary_file(&source_path)?;

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

    let bytes =
        storage::read_binary_under_root(&root, &relative, storage::WORKSPACE_BINARY_FILE_LIMIT)?;
    storage::atomic_write_file(&save_path, &bytes)?;
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
