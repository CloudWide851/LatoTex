#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentToolPrefs {
    pub web_search_enabled: Option<bool>,
    pub workspace_read_enabled: Option<bool>,
    pub python_enabled: Option<bool>,
    pub mcp_enabled: Option<bool>,
    pub write_requires_confirmation: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct BackgroundCropRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentPermissionPrefs {
    pub web_search: Option<String>,
    pub workspace_read: Option<String>,
    pub python: Option<String>,
    pub mcp: Option<String>,
    pub skills: Option<String>,
    pub plugin_commands: Option<String>,
    pub non_latex_writes: Option<String>,
    pub mcp_server_modes: Option<std::collections::HashMap<String, String>>,
    pub plugin_modes: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamRolePrefs {
    pub id: String,
    pub name: String,
    pub description: Option<String>,
    pub identity_prompt: Option<String>,
    pub model_id: Option<String>,
    pub phase: Option<String>,
    pub can_write: Option<bool>,
    pub tool_access: Option<Vec<String>>,
    pub mcp_server_ids: Option<Vec<String>>,
    pub skill_ids: Option<Vec<String>>,
    pub color: Option<String>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamConfig {
    pub id: String,
    pub name: String,
    pub enabled: Option<bool>,
    pub callsites: Option<Vec<String>>,
    pub parallelism: Option<u32>,
    pub require_plan_approval: Option<bool>,
    pub roles: Option<Vec<AgentTeamRolePrefs>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AgentTeamPrefs {
    pub enabled: Option<bool>,
    pub default_team_id: Option<String>,
    pub teams: Option<Vec<AgentTeamConfig>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MemoryGuardPrefs {
    pub enabled: Option<bool>,
    pub high_watermark_mb: Option<u32>,
    pub critical_watermark_mb: Option<u32>,
    pub sample_interval_sec: Option<u32>,
    pub critical_action: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct McpServerConfig {
    pub id: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct McpValidationResult {
    pub ok: bool,
    pub message: String,
    pub tools: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillValidationInput {
    pub skill_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SkillValidationResult {
    pub ok: bool,
    pub skill_id: String,
    pub message: String,
    pub source: String,
    pub manifest_path: Option<String>,
    pub details: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct FeatureModelBindings {
    pub latex_agent_model_id: Option<String>,
    pub analysis_agent_model_id: Option<String>,
    pub git_summary_model_id: Option<String>,
    pub chat_agent_model_id: Option<String>,
    pub translation_model_id: Option<String>,
    pub completion_model_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPrefs {
    pub telegram_enabled: Option<bool>,
    pub telegram_bot_token: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub telegram_api_base_url: Option<String>,
    pub dingtalk_enabled: Option<bool>,
    pub dingtalk_client_id: Option<String>,
    pub dingtalk_client_secret: Option<String>,
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
pub struct TelegramTestInput {
    pub token: String,
    pub chat_id: Option<String>,
    pub api_base_url: Option<String>,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkPollInput {
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkUpdateItem {
    pub conversation_id: String,
    pub sender_id: String,
    pub sender_name: String,
    pub text: String,
    pub reply_token: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkPollResult {
    pub updates: Vec<DingTalkUpdateItem>,
    pub status: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkSendInput {
    pub reply_token: Option<String>,
    pub webhook: Option<String>,
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DingTalkTestInput {
    pub client_id: String,
    pub client_secret: String,
}
