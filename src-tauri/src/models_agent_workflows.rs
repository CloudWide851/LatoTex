#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexEditStartInput {
    pub project_id: String,
    pub user_prompt: String,
    pub target_path: String,
    pub file_content: String,
    pub selected_file: Option<String>,
    pub paper_context_source_path: Option<String>,
    #[serde(default)]
    pub context_paths: Vec<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexReviewFixStartInput {
    pub project_id: String,
    pub selected_file: String,
    pub working_content: String,
    pub diagnostics: Vec<String>,
    pub extra_instruction: Option<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexReferenceCheckStartInput {
    pub project_id: String,
    pub selected_file: Option<String>,
    pub editor_content: String,
    pub user_hint: Option<String>,
    #[serde(default)]
    pub context_paths: Vec<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexPaperAnalyzeStartInput {
    pub project_id: String,
    pub source_path: String,
    pub instruction: Option<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatWorkflowStartInput {
    pub project_id: String,
    pub prompt: String,
    #[serde(default)]
    pub context_paths: Vec<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CompletionWorkflowStartInput {
    pub project_id: String,
    pub selected_file: Option<String>,
    pub line_prefix: String,
    pub full_text: String,
    #[serde(default)]
    pub project_symbols: Vec<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GitSummaryWorkflowStartInput {
    pub project_id: String,
    #[serde(default)]
    pub files: Vec<String>,
    pub joined_patch: String,
}

