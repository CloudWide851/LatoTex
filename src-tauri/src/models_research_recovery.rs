#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChangeCheckpoint {
    pub checkpoint_id: String,
    pub project_id: String,
    pub run_id: String,
    pub step_id: String,
    pub relative_path: String,
    pub before_hash: String,
    pub after_hash: Option<String>,
    pub status: String,
    pub created_at: String,
    pub applied_at: Option<String>,
    pub undone_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChangeConflict {
    pub base_content: String,
    pub applied_content: String,
    pub current_content: String,
    pub patch: serde_json::Value,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChangeCheckpointUndoResult {
    pub checkpoint: ResearchChangeCheckpoint,
    pub outcome: String,
    pub conflict: Option<ResearchChangeConflict>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChangeCheckpointListInput {
    pub project_id: String,
    pub run_id: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchChangeCheckpointUndoInput {
    pub project_id: String,
    pub checkpoint_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRunRecoveryResponse {
    pub resumed_run_ids: Vec<String>,
    pub preserved_run_ids: Vec<String>,
    pub review_required_run_ids: Vec<String>,
    pub cleaned_lease_count: usize,
    pub cleaned_lock_count: usize,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchRunsRecoverInput {
    pub project_id: String,
}
