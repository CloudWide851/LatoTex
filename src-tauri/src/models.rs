use serde::{Deserialize, Serialize};
use serde_json::Value;

include!("models_core.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogWriteInput {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogReadInput {
    pub limit: Option<u32>,
    pub level: Option<String>,
    pub keyword: Option<String>,
    pub from_time: Option<String>,
    pub to_time: Option<String>,
    pub log_file_name: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogEntry {
    pub timestamp: String,
    pub level: String,
    pub message: String,
    pub raw: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogReadResponse {
    pub entries: Vec<RuntimeLogEntry>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogSession {
    pub file_name: String,
    pub modified_at: String,
    pub size_bytes: u64,
    pub is_current: bool,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogSessionListResponse {
    pub sessions: Vec<RuntimeLogSession>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogClearInput {
    pub confirm_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogInfo {
    pub session_log_file: String,
    pub logs_dir: String,
    pub runtime_root: String,
    pub install_mode: String,
    pub version: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeMemorySnapshot {
    pub process_id: u32,
    pub rss_bytes: u64,
    pub private_bytes: Option<u64>,
    pub webview_rss_bytes: Option<u64>,
    pub webview_private_bytes: Option<u64>,
    pub webview_process_count: Option<u32>,
    pub total_rss_bytes: Option<u64>,
    pub total_private_bytes: Option<u64>,
    pub sampled_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeDiagnosticsBundleExport {
    pub path: String,
    pub file_name: String,
    pub size_bytes: u64,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBackgroundImage {
    pub path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundImageReadInput {
    pub path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppBackgroundImagePayload {
    pub path: String,
    pub mime: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileRecordInput {
    pub project_id: String,
    pub main_file: String,
    pub status: String,
    pub diagnostics: Vec<String>,
    pub duration_ms: u64,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CompileRecord {
    pub id: String,
    pub project_id: String,
    pub main_file: String,
    pub status: String,
    pub diagnostics: Vec<String>,
    pub duration_ms: u64,
    pub created_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecuteRequest {
    pub project_id: String,
    pub workflow_id: String,
    pub callsite: String,
    pub prompt: String,
    pub context_refs: Vec<String>,
    pub model_override: Option<String>,
    #[serde(default)]
    pub bypass_cache: bool,
    pub team_mode: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecuteCancelInput {
    pub run_id: String,
}
#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentExecuteStartAccepted {
    pub run_id: String,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunsRecoverInput {
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunsRecoverResponse {
    pub recovered_run_ids: Vec<String>,
}
#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EventQuery {
    pub cursor: Option<i64>,
    pub limit: Option<u32>,
    pub run_id: Option<String>,
    pub wait_ms: Option<u64>,
    pub exclude_kinds: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SwarmEvent {
    pub seq: i64,
    pub id: String,
    pub run_id: String,
    pub project_id: String,
    pub role: String,
    pub kind: String,
    pub payload: Value,
    pub created_at: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EventBatch {
    pub next_cursor: i64,
    pub events: Vec<SwarmEvent>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TrayLabelsInput {
    pub show_label: String,
    pub exit_label: String,
    pub tooltip: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelProtocol {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
    pub api_key_set: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelCapabilities {
    pub api_mode: Option<String>,
    pub reasoning_mode: Option<String>,
    pub auto_repair: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogItem {
    pub id: String,
    pub protocol_id: String,
    pub display_name: String,
    pub request_name: String,
    #[serde(default)]
    pub capabilities: Option<ModelCapabilities>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelBinding {
    pub role: String,
    pub model_id: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub active_project_id: Option<String>,
    pub model_protocols: Vec<ModelProtocol>,
    pub model_catalog: Vec<ModelCatalogItem>,
    pub agent_bindings: Vec<AgentModelBinding>,
    pub ui_prefs: Option<UiPrefs>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    pub language: Option<String>,
    pub skip_delete_confirm: Option<bool>,
    pub close_to_tray_notice_enabled: Option<bool>,
    pub close_behavior: Option<String>,
    pub close_behavior_remember: Option<bool>,
    pub theme: Option<String>,
    pub theme_preset: Option<String>,
    pub preview_default_zoom: Option<f64>,
    pub paper_brief_engine: Option<String>,
    pub terminal_shell: Option<String>,
    pub panel_layout: Option<Value>,
    pub feature_model_bindings: Option<FeatureModelBindings>,
    pub channels: Option<ChannelPrefs>,
    pub background_image_path: Option<String>,
    pub background_image_paths: Option<Vec<String>>,
    pub background_blur_px: Option<f64>,
    pub interface_density: Option<String>,
    pub accent_color: Option<String>,
    pub accent_custom_color: Option<String>,
    pub scrollbar_color_mode: Option<String>,
    pub scrollbar_width_px: Option<f64>,
    pub scrollbar_thumb_color: Option<String>,
    pub scrollbar_track_color: Option<String>,
    pub glass_opacity: Option<f64>,
    pub glass_blur_px: Option<f64>,
    pub motion_level: Option<String>,
    pub font_scale: Option<f64>,
    pub pdf_page_gap_px: Option<f64>,
    pub log_font_size_px: Option<f64>,
    pub panel_radius_px: Option<f64>,
    pub panel_border_contrast: Option<String>,
    pub memory_guard_prefs: Option<MemoryGuardPrefs>,
    pub analysis_env_roots_by_project: Option<std::collections::HashMap<String, String>>,
    pub library_selected_path_by_project: Option<std::collections::HashMap<String, String>>,
    pub library_view_mode_by_project: Option<std::collections::HashMap<String, String>>,
    pub workspace_explorer_default_expanded: Option<bool>,
    pub library_explorer_default_expanded: Option<bool>,
    pub workspace_explorer_expanded_paths_by_project:
        Option<std::collections::HashMap<String, Vec<String>>>,
    pub library_explorer_expanded_paths_by_project:
        Option<std::collections::HashMap<String, Vec<String>>>,
    pub agent_tool_prefs: Option<AgentToolPrefs>,
    pub agent_team_prefs: Option<AgentTeamPrefs>,
    pub mcp_servers: Option<Vec<McpServerConfig>>,
    pub enabled_skills: Option<Vec<String>>,
}

include!("models_settings.rs");

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProtocolInput {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogItemInput {
    pub id: String,
    pub protocol_id: String,
    pub display_name: String,
    pub request_name: String,
    #[serde(default)]
    pub capabilities: Option<ModelCapabilities>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateInput {
    pub active_project_id: Option<String>,
    pub model_protocols: Vec<ModelProtocolInput>,
    pub model_catalog: Vec<ModelCatalogItemInput>,
    pub agent_bindings: Vec<AgentModelBinding>,
    pub ui_prefs: Option<UiPrefs>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeySetInput {
    pub model_id: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeyGetInput {
    pub model_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeyValue {
    pub model_id: String,
    pub api_key: String,
    pub source: String,
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeySaveVerifiedInput {
    pub model_id: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSaveResult {
    pub ok: bool,
    pub stage: String,
    pub message: String,
    pub storage_backend: String,
    pub diagnostic_code: Option<String>,
    pub readback_source: Option<String>,
    pub readback_attempts: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolTestInput {
    pub protocol_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolHealth {
    pub protocol_id: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestInput {
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDraftTestInput {
    pub protocol_id: String,
    pub base_url: String,
    pub request_name: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    pub model_id: String,
    pub ok: bool,
    pub message: String,
}
include!("models_library.rs");
include!("models_git.rs");
include!("models_agent_workflows.rs");
include!("models_native_runtime.rs");
include!("models_resource_warmup.rs");
include!("models_terminal.rs");
