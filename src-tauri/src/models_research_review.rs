#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReviewProtocol {
    pub task_id: String,
    pub title: String,
    pub research_question: String,
    pub inclusion_criteria: Vec<String>,
    pub exclusion_criteria: Vec<String>,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReviewProtocolSaveInput {
    pub project_id: String,
    pub task_id: String,
    pub title: String,
    pub research_question: String,
    pub inclusion_criteria: Vec<String>,
    pub exclusion_criteria: Vec<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchQuerySnapshot {
    pub id: String,
    pub task_id: String,
    pub query: String,
    pub sources: Vec<String>,
    pub result_count: u32,
    pub stop_reason: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchQuerySnapshotRecordInput {
    pub project_id: String,
    pub task_id: String,
    pub stable_id: Option<String>,
    pub query: String,
    pub sources: Vec<String>,
    pub result_count: u32,
    pub stop_reason: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchScreeningRecord {
    pub id: String,
    pub task_id: String,
    pub evidence_id: String,
    pub recommendation: String,
    pub confidence: f64,
    pub suggestion_reason: String,
    pub decision: String,
    pub exclusion_reason: Option<String>,
    pub full_text_reviewed: bool,
    pub created_at: String,
    pub updated_at: String,
    pub decided_at: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchScreeningSuggestInput {
    pub project_id: String,
    pub task_id: String,
    pub evidence_id: String,
    pub recommendation: String,
    pub confidence: f64,
    pub suggestion_reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchScreeningDecisionInput {
    pub screening_id: String,
    pub decision: String,
    pub exclusion_reason: Option<String>,
    pub full_text_reviewed: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchScreeningConfirmBatchInput {
    pub project_id: String,
    pub task_id: String,
    pub decisions: Vec<ResearchScreeningDecisionInput>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Default)]
#[serde(rename_all = "camelCase")]
pub struct ResearchPrismaCounts {
    pub identified: u32,
    pub deduplicated: u32,
    pub screened: u32,
    pub excluded: u32,
    pub full_text_assessed: u32,
    pub included: u32,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReviewWorkspaceInput {
    pub project_id: String,
    pub task_id: String,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ResearchReviewWorkspace {
    pub protocol: Option<ResearchReviewProtocol>,
    pub query_snapshots: Vec<ResearchQuerySnapshot>,
    pub screenings: Vec<ResearchScreeningRecord>,
    pub prisma: ResearchPrismaCounts,
}
