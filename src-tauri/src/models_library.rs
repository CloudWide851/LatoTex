#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryRefInput {
    pub project_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCitationSummaryInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfPreviewInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryCitationSummaryResponse {
    pub source_path: String,
    pub bib_path: Option<String>,
    pub citation_key: Option<String>,
    pub title: Option<String>,
    pub authors: Vec<String>,
    pub published_at: Option<String>,
    pub doi: Option<String>,
    pub arxiv_id: Option<String>,
    pub source: Option<String>,
    pub urls: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfPreviewResponse {
    pub relative_path: Option<String>,
    pub source_url: Option<String>,
    pub cached: bool,
    pub translated_relative_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryLinkImportInput {
    pub project_id: String,
    pub link: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryZoteroSyncInput {
    pub project_id: String,
    pub scope: Option<String>,
    pub owner_id: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryZoteroSyncResponse {
    pub relative_path: String,
    pub entry_count: u32,
    pub total_results: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTranslateInput {
    pub project_id: String,
    pub relative_path: String,
    pub target_language: Option<String>,
    pub model_override: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTranslateResponse {
    pub relative_path: String,
    pub source_kind: String,
    pub engine: String,
    #[serde(default)]
    pub artifact_paths: Vec<String>,
    pub detected_language: Option<String>,
    pub extraction_engine: Option<String>,
    pub refined_by_search: bool,
    pub glossary_count: u32,
    pub translated_pdf_relative_path: String,
    pub source_pdf_relative_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchInput {
    pub project_id: String,
    pub query: String,
    pub limit: Option<u32>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectSearchHit {
    pub relative_path: String,
    pub line_number: u32,
    pub snippet: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectIntegrityStatus {
    pub project_id: String,
    pub missing_required: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct FsOperationInput {
    pub project_id: String,
    pub scope: String,
    pub action: String,
    pub path: String,
    pub target_path: Option<String>,
    pub content: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FsOperationResult {
    pub ok: bool,
    pub message: String,
}
