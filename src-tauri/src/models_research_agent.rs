#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTask {
    pub id: String,
    pub project_id: String,
    pub goal: String,
    pub status: String,
    pub current_plan_version: Option<i64>,
    pub run_ids: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanStep {
    pub id: String,
    pub order: i64,
    pub enabled: bool,
    pub dependencies: Vec<String>,
    pub capability: String,
    pub input: serde_json::Value,
    pub risk_level: String,
    pub status: String,
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanVersion {
    pub id: String,
    pub task_id: String,
    pub version: i64,
    pub source_message: String,
    pub approval_status: String,
    pub authorized_project_ids: Vec<String>,
    pub steps: Vec<ResearchPlanStep>,
    pub created_at: String,
    pub approved_at: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChatMessage {
    pub id: String,
    pub role: String,
    pub text: String,
    pub created_at: String,
    pub run_id: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChatSession {
    pub id: String,
    pub title: String,
    pub created_at: String,
    pub updated_at: String,
    pub messages: Vec<ResearchChatMessage>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChatStore {
    pub sessions: Vec<ResearchChatSession>,
    pub active_session_id: Option<String>,
    pub migration_completed: bool,
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchProjectInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchTaskCreateInput {
    pub project_id: String,
    pub goal: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanStepDraft {
    pub id: Option<String>,
    pub enabled: bool,
    pub dependencies: Vec<String>,
    pub capability: String,
    pub input: serde_json::Value,
    pub risk_level: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanSaveInput {
    pub project_id: String,
    pub task_id: String,
    pub source_message: String,
    pub authorized_project_ids: Vec<String>,
    pub steps: Vec<ResearchPlanStepDraft>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPlanApproveInput {
    pub project_id: String,
    pub task_id: String,
    pub version: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChatStoreReplaceInput {
    pub project_id: String,
    pub store: ResearchChatStore,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChatMigrationInput {
    pub project_id: String,
    pub migration_id: String,
    pub store: ResearchChatStore,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChatMigrationResult {
    pub migrated: bool,
    pub verified: bool,
    pub store: ResearchChatStore,
    pub diagnostic_code: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchWorkspaceSnapshot {
    pub tasks: Vec<ResearchTask>,
    pub plans: Vec<ResearchPlanVersion>,
    pub chat_store: ResearchChatStore,
}
