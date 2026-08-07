#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchAgentRun {
    pub run_id: String,
    pub project_id: String,
    pub task_id: String,
    pub plan_version: i64,
    pub status: String,
    pub current_step_id: Option<String>,
    pub completed_steps: i64,
    pub total_steps: i64,
    pub last_operation: Option<String>,
    pub evidence_count: i64,
    pub diagnostic_code: Option<String>,
    pub started_at: String,
    pub updated_at: String,
    pub finished_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanExecuteInput {
    pub project_id: String,
    pub task_id: String,
    pub version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRunControlInput {
    pub project_id: String,
    pub run_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRunListInput {
    pub project_id: Option<String>,
    pub include_terminal: Option<bool>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanExecutionAccepted {
    pub run_id: String,
    pub status: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanApproval {
    pub approval_id: String,
    pub project_id: String,
    pub run_id: String,
    pub step_id: String,
    pub risk_level: String,
    pub command_summary: String,
    pub status: String,
    pub created_at: String,
    pub resolved_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanApprovalResolveInput {
    pub project_id: String,
    pub approval_id: String,
    pub decision: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchUiCommand {
    pub project_id: String,
    pub run_id: String,
    pub step_id: String,
    pub capability: String,
    pub command: AgentAppCommand,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchUiCommandListInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchUiCommandResolveInput {
    pub project_id: String,
    pub run_id: String,
    pub step_id: String,
    pub status: String,
    pub result: Option<serde_json::Value>,
    pub diagnostic_code: Option<String>,
}
