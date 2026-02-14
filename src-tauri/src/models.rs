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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FileWriteInput {
    pub project_id: String,
    pub relative_path: String,
    pub content: String,
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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeLogInfo {
    pub session_log_file: String,
    pub logs_dir: String,
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
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunAccepted {
    pub run_id: String,
    pub status: String,
    pub output: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EventQuery {
    pub cursor: Option<i64>,
    pub limit: Option<u32>,
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

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfig {
    pub provider: String,
    pub base_url: String,
    pub api_key_set: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentModelBinding {
    pub role: String,
    pub provider: String,
    pub model: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    pub active_project_id: Option<String>,
    pub providers: Vec<ProviderConfig>,
    pub agent_bindings: Vec<AgentModelBinding>,
    pub ui_prefs: Option<UiPrefs>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct UiPrefs {
    pub language: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderConfigInput {
    pub provider: String,
    pub base_url: String,
    pub api_key: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateInput {
    pub active_project_id: Option<String>,
    pub providers: Vec<ProviderConfigInput>,
    pub agent_bindings: Vec<AgentModelBinding>,
    pub ui_prefs: Option<UiPrefs>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderTestInput {
    pub provider: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderHealth {
    pub provider: String,
    pub ok: bool,
    pub message: String,
}
