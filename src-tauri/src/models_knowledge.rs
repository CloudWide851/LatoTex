#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeArchiveInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeRefInput {
    pub project_id: String,
    pub item_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeListInput {
    pub project_id: String,
    pub source_kind: Option<String>,
    pub index_state: Option<String>,
}

#[derive(Debug, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchInput {
    pub project_id: String,
    pub project_ids: Option<Vec<String>>,
    pub query: String,
    pub limit: Option<u32>,
    pub deep: Option<bool>,
    pub run_id: Option<String>,
    pub semantic: Option<bool>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchCancelInput {
    pub run_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFetchInput {
    pub project_id: String,
    pub evidence_id: String,
    pub max_chars: Option<u32>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphInput {
    pub project_id: String,
    pub item_id: Option<String>,
    pub query: Option<String>,
    pub limit: Option<u32>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMutationPreviewInput {
    pub project_id: String,
    pub scope: String,
    pub action: String,
    pub path: String,
    pub target_path: Option<String>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeAnchor {
    pub kind: String,
    pub value: String,
    pub page: Option<u32>,
    pub line_start: Option<u32>,
    pub line_end: Option<u32>,
    pub heading: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeItem {
    pub item_id: String,
    pub project_id: String,
    pub relative_path: String,
    pub title: String,
    pub source_kind: String,
    pub content_hash: String,
    pub index_state: String,
    pub chunk_count: u32,
    pub locked: bool,
    pub updated_at: String,
    pub failure_code: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeArchiveResponse {
    pub item: KnowledgeItem,
    pub semantic_available: bool,
    pub semantic_reminder: bool,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeCitation {
    pub citation_id: String,
    pub project_id: String,
    pub item_id: String,
    pub title: String,
    pub relative_path: String,
    pub source_kind: String,
    pub anchor: KnowledgeAnchor,
    pub snippet: String,
    pub url: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchHit {
    pub evidence_id: String,
    pub project_id: String,
    pub item_id: String,
    pub title: String,
    pub relative_path: String,
    pub source_kind: String,
    pub anchor: KnowledgeAnchor,
    pub snippet: String,
    pub score: f64,
    pub match_kinds: Vec<String>,
    pub citation: KnowledgeCitation,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct EmbeddingRuntimeStatus {
    pub plugin_id: String,
    pub installed: bool,
    pub available: bool,
    pub model_fingerprint: Option<String>,
    pub index_fingerprint: Option<String>,
    pub rebuild_required: bool,
    pub mode: String,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeEmbeddingJobStatus {
    pub state: String,
    pub processed: u64,
    pub total: u64,
    pub generation: Option<String>,
    pub failure_code: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeSearchResponse {
    pub run_id: String,
    pub hits: Vec<KnowledgeSearchHit>,
    pub strategy: String,
    pub embedding: EmbeddingRuntimeStatus,
    pub lexical_elapsed_ms: u64,
    pub semantic_elapsed_ms: u64,
    pub elapsed_ms: u64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeFetchResponse {
    pub evidence_id: String,
    pub text: String,
    pub citation: KnowledgeCitation,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphNode {
    pub id: String,
    pub kind: String,
    pub label: String,
    pub confidence: f64,
    pub item_id: Option<String>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphEdge {
    pub id: String,
    pub source: String,
    pub target: String,
    pub kind: String,
    pub confidence: f64,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeGraphResponse {
    pub nodes: Vec<KnowledgeGraphNode>,
    pub edges: Vec<KnowledgeGraphEdge>,
    pub aggregated: bool,
    pub total_nodes: u32,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTopicListInput {
    pub project_id: String,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTopicMutationInput {
    pub project_id: String,
    pub topic_id: String,
    pub action: String,
    pub label: Option<String>,
    pub target_topic_id: Option<String>,
}

#[derive(Debug, serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeTopic {
    pub topic_id: String,
    pub label: String,
    pub source: String,
    pub confidence: f64,
    pub hidden: bool,
    pub manual: bool,
    pub link_count: u32,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMutationApproval {
    pub token: String,
    pub expires_at_unix_ms: u64,
    pub content_version: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct KnowledgeMutationPreview {
    pub required: bool,
    pub affected_items: Vec<KnowledgeItem>,
    pub approval: Option<KnowledgeMutationApproval>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchAnswerClaim {
    pub text: String,
    pub kind: String,
    pub citation_ids: Vec<String>,
}

#[derive(Debug, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchAnswerEnvelope {
    pub project_id: String,
    pub claims: Vec<ResearchAnswerClaim>,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResearchAnswerValidation {
    pub valid: bool,
    pub unsupported_claims: Vec<u32>,
    pub invalid_citation_ids: Vec<String>,
}
