#[derive(Clone, Debug, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct EvidenceLocator {
    pub page: Option<u32>,
    pub section: Option<String>,
    pub paragraph: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidencePacket {
    pub id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub source: String,
    pub doi: Option<String>,
    pub source_version: Option<String>,
    pub title: String,
    pub excerpt: String,
    pub locator: EvidenceLocator,
    pub content_hash: String,
    pub retraction_status: String,
    pub correction_status: String,
    pub source_url: String,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidencePacketUpsertInput {
    pub project_id: String,
    pub task_id: String,
    pub run_id: Option<String>,
    pub stable_id: Option<String>,
    pub source: String,
    pub doi: Option<String>,
    pub source_version: Option<String>,
    pub title: String,
    pub excerpt: String,
    pub locator: EvidenceLocator,
    pub retraction_status: Option<String>,
    pub correction_status: Option<String>,
    pub source_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct EvidencePacketListInput {
    pub project_id: String,
    pub task_id: String,
}

#[derive(Clone, Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimEvidenceAssessment {
    pub id: String,
    pub task_id: String,
    pub claim: String,
    pub status: String,
    pub evidence_ids: Vec<String>,
    pub verbatim_excerpts: Vec<String>,
    pub rationale: String,
    pub repair_attempted: bool,
    pub repaired_claim: Option<String>,
    pub requires_unconfirmed_label: bool,
    pub created_at: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimEvidenceAssessInput {
    pub project_id: String,
    pub task_id: String,
    pub claim: String,
    pub evidence_ids: Vec<String>,
    pub repaired_claim: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ClaimEvidenceAssessmentListInput {
    pub project_id: String,
    pub task_id: String,
}
