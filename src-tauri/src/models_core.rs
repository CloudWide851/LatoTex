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
    pub sync_seq: Option<u64>,
    pub sync_event_count: Option<u32>,
    pub last_sync_at: Option<String>,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriSmokeConfig {
    pub enabled: bool,
    pub report_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TauriSmokeFinishInput {
    pub ok: bool,
    pub status: String,
    pub steps: Vec<Value>,
    pub error: Option<String>,
}
