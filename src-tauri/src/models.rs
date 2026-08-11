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
    pub directory_role: Option<String>,
    pub knowledge_state: Option<String>,
    pub knowledge_locked: Option<bool>,
    pub children: Vec<ResourceNode>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSnapshot {
    pub summary: ProjectSummary,
    pub tree: Vec<ResourceNode>,
    pub main_file: String,
}

#[derive(Debug, Deserialize, Clone, Copy)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectTemplate {
    ResearchPaper,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CreateProjectInput {
    pub name: String,
    #[serde(default)]
    pub template: Option<ProjectTemplate>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectRefInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteInput {
    pub project_id: String,
    pub mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectDeleteResponse {
    pub deleted_project_id: String,
    pub root_path: String,
    pub trashed_root: bool,
    pub next_active_project_id: Option<String>,
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
pub struct WorkspaceExportAssetInput {
    pub project_id: String,
    pub default_relative_dir: String,
    pub default_file_name: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkspaceExportAssetResponse {
    pub saved_path: String,
    pub file_name: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawExportAssetInput {
    pub project_id: String,
    pub relative_path: String,
    pub bytes: Vec<u8>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DrawExportAssetResponse {
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareOwnerAuthInput {
    pub session_id: String,
    pub username: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSessionSecretInput {
    pub session_id: String,
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
pub struct ShareOwnerAuth {
    pub participant_id: String,
    pub participant_token: String,
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
    pub expires_at: Option<String>,
    pub status: Option<String>,
    pub pdf_state: Option<String>,
    pub pdf_updated_at: Option<String>,
    pub sync_seq: Option<u64>,
    pub sync_event_count: Option<u32>,
    pub last_sync_at: Option<String>,
    pub tunnel_state: Option<String>,
    pub tunnel_error: Option<String>,
    #[serde(default)]
    pub participants: Vec<ShareParticipantInfo>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSessionCreateResult {
    pub session: ShareSessionInfo,
    pub owner_auth: ShareOwnerAuth,
    pub password: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ShareSessionPasswordResult {
    pub password: String,
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
    #[serde(default)]
    pub knowledge_approval_token: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteBinaryInput {
    pub project_id: String,
    pub relative_path: String,
    pub bytes: Vec<u8>,
    #[serde(default)]
    pub knowledge_approval_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Ack {
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriSmokeConfig {
    pub enabled: bool,
    pub report_path: Option<String>,
    pub progress_path: Option<String>,
    pub scenario: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriSmokeFinishInput {
    pub ok: bool,
    pub status: String,
    pub steps: Vec<Value>,
    pub error: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriSmokeProgressInput {
    pub stage: String,
    pub status: String,
    pub detail: Option<Value>,
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
    pub harness_profile_id: Option<String>,
    pub profile_id: Option<String>,
    pub graph_template_id: Option<String>,
    #[serde(default)]
    pub research_task_id: Option<String>,
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

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalCapability {
    pub capability: String,
    pub resource: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalRequest {
    pub approval_id: String,
    pub run_id: String,
    pub project_id: String,
    pub workflow_id: String,
    pub capabilities: Vec<AgentApprovalCapability>,
    pub status: String,
    pub created_at: String,
    pub expires_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalListInput {
    pub project_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentApprovalResolveInput {
    pub approval_id: String,
    pub decision: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissionGrant {
    pub grant_id: String,
    pub project_id: String,
    pub capability: String,
    pub resource: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissionGrantRevokeInput {
    pub grant_id: String,
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
include!("models_knowledge.rs");
include!("models_git.rs");
include!("models_agent_workflows.rs");
include!("models_agent_control.rs");
include!("models_native_runtime.rs");
include!("models_resource_warmup.rs");
include!("models_terminal.rs");
include!("models_plugins.rs");
include!("models_docx.rs");
include!("models_markdown_runtime.rs");
include!("models_submission_pack.rs");
include!("models_research_agent.rs");
include!("models_research_capability.rs");
include!("models_research_runs.rs");
include!("models_research_evidence.rs");
include!("models_research_review.rs");
include!("models_research_planning.rs");
include!("models_research_recovery.rs");
