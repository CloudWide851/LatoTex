use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct HealthCheckResponse {
    pub app: String,
    pub version: String,
    pub timestamp: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSummary {
    pub id: String,
    pub name: String,
    pub root_path: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceNode {
    pub name: String,
    pub relative_path: String,
    pub kind: String,
    pub children: Vec<ResourceNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub summary: ProjectSummary,
    pub tree: Vec<ResourceNode>,
    pub main_file: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRefInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectPathActionInput {
    pub project_id: String,
    pub relative_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct OpenExternalLinkInput {
    pub url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExportPdfInput {
    pub project_id: String,
    pub default_file_name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExportPdfResponse {
    pub saved_path: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSessionCreateInput {
    pub project_id: String,
    pub target_path: String,
    pub mode: Option<String>,
    pub session_name: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShareParticipantInfo {
    pub participant_id: String,
    pub username: String,
    pub last_seen_at: String,
    pub last_action: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ShareSessionInfo {
    pub active: bool,
    pub session_id: Option<String>,
    pub session_name: Option<String>,
    pub session_created_at: Option<String>,
    pub project_id: Option<String>,
    pub target_path: Option<String>,
    pub mode: Option<String>,
    pub local_url: Option<String>,
    pub tunnel_url: Option<String>,
    pub local_join_url: Option<String>,
    pub remote_join_url: Option<String>,
    pub active_join_url: Option<String>,
    pub password_required: Option<bool>,
    pub password: Option<String>,
    pub expires_at: Option<String>,
    pub status: Option<String>,
    pub pdf_state: Option<String>,
    pub pdf_updated_at: Option<String>,
    pub tunnel_state: Option<String>,
    pub tunnel_error: Option<String>,
    #[serde(default)]
    pub participants: Vec<ShareParticipantInfo>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadResponse {
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileReadBinaryResponse {
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteInput {
    pub project_id: String,
    pub relative_path: String,
    pub content: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteBinaryInput {
    pub project_id: String,
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ack {
    pub ok: bool,
    pub message: String,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRequest {
    pub project_id: String,
    pub role: String,
    pub prompt: String,
    pub context_refs: Vec<String>,
    pub model_override: Option<String>,
    #[serde(default)]
    pub bypass_cache: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunCancelInput {
    pub run_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunAccepted {
    pub run_id: String,
    pub status: String,
    pub output: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunStartAccepted {
    pub run_id: String,
    pub status: String,
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
    pub theme: Option<String>,
    pub busytex_cache_policy: Option<String>,
    pub busytex_cache_dir: Option<String>,
    pub preview_default_zoom: Option<f64>,
    pub panel_layout: Option<Value>,
    pub feature_model_bindings: Option<FeatureModelBindings>,
    pub channels: Option<ChannelPrefs>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeatureModelBindings {
    pub latex_agent_model_id: Option<String>,
    pub analysis_agent_model_id: Option<String>,
    pub translation_model_id: Option<String>,
    pub completion_model_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPrefs {
    pub telegram_enabled: Option<bool>,
    pub telegram_bot_token: Option<String>,
    pub telegram_chat_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramPollInput {
    pub offset: Option<i64>,
    pub limit: Option<u32>,
    pub timeout_secs: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramUpdateItem {
    pub update_id: i64,
    pub message_id: i64,
    pub chat_id: String,
    pub username: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramPollResult {
    pub next_offset: i64,
    pub updates: Vec<TelegramUpdateItem>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramSendInput {
    pub chat_id: Option<String>,
    pub text: String,
    pub reply_to_message_id: Option<i64>,
}

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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRefInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCitationSummaryInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfPreviewInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCitationSummaryResponse {
    pub source_path: String,
    pub bib_path: Option<String>,
    pub citation_key: Option<String>,
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub published_at: Option<String>,
    pub doi: Option<String>,
    pub arxiv_id: Option<String>,
    pub source: Option<String>,
    pub urls: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfPreviewResponse {
    pub relative_path: Option<String>,
    pub source_url: Option<String>,
    pub cached: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryLinkImportInput {
    pub project_id: String,
    pub link: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchInput {
    pub project_id: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchHit {
    pub relative_path: String,
    pub line_number: u32,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIntegrityStatus {
    pub project_id: String,
    pub missing_required: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsOperationInput {
    pub project_id: String,
    pub scope: String,
    pub action: String,
    pub path: String,
    pub target_path: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsOperationResult {
    pub ok: bool,
    pub message: String,
}
include!("models_git.rs");
