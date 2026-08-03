#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfile {
    pub id: String,
    pub name: String,
    pub description: String,
    pub color: String,
    pub model_id: Option<String>,
    #[serde(default = "default_agent_runtime_id")]
    pub runtime_id: String,
    #[serde(default = "default_agent_runtime_id")]
    pub fallback_runtime_id: String,
    pub identity_prompt: String,
    #[serde(default)]
    pub skill_ids: Vec<String>,
    #[serde(default)]
    pub mcp_server_ids: Vec<String>,
    #[serde(default)]
    pub tool_ids: Vec<String>,
    #[serde(default)]
    pub read_scopes: Vec<String>,
    #[serde(default)]
    pub write_scopes: Vec<String>,
    pub tool_call_budget: u32,
    pub token_budget: u32,
    pub timeout_ms: u64,
    pub built_in: bool,
    pub created_at: String,
    pub updated_at: String,
}

fn default_agent_runtime_id() -> String {
    "native".to_string()
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExternalAgentFailure {
    pub code: String,
    pub stage: String,
    pub retryable: bool,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeDescriptor {
    pub id: String,
    pub plugin_id: String,
    pub label_key: String,
    pub enabled: bool,
    pub available: bool,
    pub authenticated: bool,
    pub source: String,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub failure: Option<ExternalAgentFailure>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeInput {
    pub runtime_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRuntimeSetEnabledInput {
    pub runtime_id: String,
    pub enabled: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct McpCapabilitySession {
    pub session_id: String,
    pub run_id: String,
    pub project_id: String,
    pub profile_id: String,
    pub allowed_tools: Vec<String>,
    pub read_scopes: Vec<String>,
    pub write_scopes: Vec<String>,
    pub expires_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentBinding {
    pub project_id: Option<String>,
    pub callsite: String,
    pub profile_id: String,
    pub graph_template_id: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphNode {
    pub id: String,
    pub role: String,
    pub title: String,
    pub profile_id: Option<String>,
    pub instruction: String,
    pub optional: bool,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphEdge {
    pub from: String,
    pub to: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphTemplate {
    pub id: String,
    pub name: String,
    pub description: String,
    #[serde(default)]
    pub nodes: Vec<AgentGraphNode>,
    #[serde(default)]
    pub edges: Vec<AgentGraphEdge>,
    pub max_parallelism: u32,
    pub built_in: bool,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentCallsiteDescriptor {
    pub id: String,
    pub label_key: String,
    pub description_key: String,
    pub supports_graph: bool,
    pub default_profile_id: String,
    pub default_graph_template_id: Option<String>,
    pub effective_profile_id: String,
    pub effective_graph_template_id: Option<String>,
    pub binding_source: String,
}

#[derive(Debug, Serialize, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunSummary {
    pub run_id: String,
    pub project_id: String,
    pub callsite: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlCatalogInput {
    pub project_id: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlCatalogResponse {
    pub profiles: Vec<AgentProfile>,
    pub bindings: Vec<AgentBinding>,
    pub graph_templates: Vec<AgentGraphTemplate>,
    pub callsites: Vec<AgentCallsiteDescriptor>,
    pub recent_runs: Vec<AgentRunSummary>,
    pub runtimes: Vec<AgentRuntimeDescriptor>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileUpsertInput {
    pub profile: AgentProfile,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentProfileDeleteInput {
    pub profile_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBindingUpsertInput {
    pub binding: AgentBinding,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentBindingDeleteInput {
    pub project_id: Option<String>,
    pub callsite: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphUpsertInput {
    pub graph_template: AgentGraphTemplate,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentGraphDeleteInput {
    pub graph_template_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentControlDeleteResponse {
    pub deleted: bool,
    pub fallback_profile_id: Option<String>,
    pub affected_bindings: Vec<AgentBinding>,
}
