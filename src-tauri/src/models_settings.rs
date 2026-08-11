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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphPrefs {
    pub max_visible_nodes: Option<u32>,
    pub show_labels: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct AgentWorkspaceLayoutPrefs {
    pub tasks_open: Option<bool>,
    pub inspector_open: Option<bool>,
    pub inspector_tab: Option<String>,
    pub panel_sizes: Option<Vec<f64>>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
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
    pub busytex_cache_policy: Option<String>,
    pub terminal_shell: Option<String>,
    pub panel_layout: Option<Value>,
    pub feature_model_bindings: Option<FeatureModelBindings>,
    pub channels: Option<ChannelPrefs>,
    pub background_image_path: Option<String>,
    pub background_image_paths: Option<Vec<String>>,
    pub background_blur_px: Option<f64>,
    pub background_crop_by_path: Option<std::collections::HashMap<String, BackgroundCropRect>>,
    pub editor_background_color: Option<String>,
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
    pub pdf_page_gap_px: Option<f64>,
    pub log_font_size_px: Option<f64>,
    pub panel_radius_px: Option<f64>,
    pub panel_border_contrast: Option<String>,
    pub memory_guard_prefs: Option<MemoryGuardPrefs>,
    pub analysis_env_roots_by_project: Option<std::collections::HashMap<String, String>>,
    pub unpaywall_contact_email: Option<String>,
    pub knowledge_semantic_model_reminder_enabled: Option<bool>,
    pub knowledge_default_scope: Option<String>,
    pub knowledge_background_index_enabled: Option<bool>,
    pub knowledge_graph_prefs: Option<KnowledgeGraphPrefs>,
    pub library_selected_path_by_project: Option<std::collections::HashMap<String, String>>,
    pub library_view_mode_by_project: Option<std::collections::HashMap<String, String>>,
    pub workspace_explorer_default_expanded: Option<bool>,
    pub library_explorer_default_expanded: Option<bool>,
    pub workspace_explorer_scrollbar_visible: Option<bool>,
    pub library_explorer_scrollbar_visible: Option<bool>,
    pub editor_resize_refresh_delay_ms: Option<f64>,
    pub workspace_explorer_expanded_paths_by_project:
        Option<std::collections::HashMap<String, Vec<String>>>,
    pub library_explorer_expanded_paths_by_project:
        Option<std::collections::HashMap<String, Vec<String>>>,
    pub agent_workspace_layout_by_project:
        Option<std::collections::HashMap<String, AgentWorkspaceLayoutPrefs>>,
    pub research_goal_by_project: Option<std::collections::HashMap<String, String>>,
    pub research_domain_by_project: Option<std::collections::HashMap<String, String>>,
    pub research_privacy_reviewed_by_project: Option<std::collections::HashMap<String, bool>>,
    pub agent_tool_prefs: Option<AgentToolPrefs>,
    pub agent_permission_prefs: Option<AgentPermissionPrefs>,
    pub agent_team_prefs: Option<AgentTeamPrefs>,
    pub plugin_catalog_sources: Option<Vec<PluginCatalogSource>>,
    pub docx_auto_save_enabled: Option<bool>,
    pub mcp_servers: Option<Vec<McpServerConfig>>,
    pub enabled_skills: Option<Vec<String>>,
    pub hidden_skills: Option<Vec<String>>,
    pub skill_catalog_version: Option<u32>,
    pub onboarding: Option<OnboardingPrefs>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct OnboardingPrefs {
    pub version: u32,
    pub status: String,
    pub project_id: Option<String>,
    #[serde(default)]
    pub completed_steps: Vec<String>,
}

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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SkillValidationResult {
    pub ok: bool,
    pub skill_id: String,
    pub message: String,
    pub source: String,
    pub manifest_path: Option<String>,
    pub details: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResearchSkillDescriptor {
    pub id: String,
    pub name: String,
    pub description: String,
    pub enabled: bool,
    pub hidden: bool,
    pub source: String,
    pub validation: SkillValidationResult,
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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct ChannelPrefs {
    pub telegram_enabled: Option<bool>,
    /// Legacy plaintext field. It is accepted only for one-time secure migration
    /// and must be scrubbed before settings are returned to the WebView.
    pub telegram_bot_token: Option<String>,
    pub telegram_chat_id: Option<String>,
    pub telegram_api_base_url: Option<String>,
    pub telegram_proxy_mode: Option<String>,
    pub telegram_manual_proxy_url: Option<String>,
    pub telegram_token_stored: Option<bool>,
    /// Legacy boolean retained only for migration to telegram_proxy_mode.
    pub telegram_proxy_enabled: Option<bool>,
    pub dingtalk_enabled: Option<bool>,
    pub dingtalk_client_id: Option<String>,
    pub dingtalk_client_secret: Option<String>,
    pub email_enabled: Option<bool>,
    pub email_address: Option<String>,
    pub email_imap_host: Option<String>,
    pub email_imap_port: Option<u16>,
    pub email_security: Option<String>,
    pub email_username: Option<String>,
    pub email_mailbox: Option<String>,
    pub email_search_keywords: Option<String>,
    pub email_max_results: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailPasswordSaveInput {
    pub password: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailFetchSubmissionInput {
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailSubmissionItem {
    pub id: String,
    pub subject: String,
    pub from: String,
    pub date: String,
    pub preview: String,
    pub match_reason: String,
    pub status_tag: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EmailFetchSubmissionResult {
    pub items: Vec<EmailSubmissionItem>,
    pub status: String,
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
    pub text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramTokenSaveInput {
    pub token: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ChannelFailure {
    pub code: String,
    pub stage: String,
    pub retryable: bool,
    pub proxy_source: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TelegramConnectionResult {
    pub ok: bool,
    pub code: String,
    pub stage: String,
    pub retryable: bool,
    pub proxy_source: String,
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
