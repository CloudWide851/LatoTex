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
    pub bust_cache: Option<bool>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocumentOpenInput {
    pub project_id: String,
    pub relative_path: String,
    pub bust_cache: Option<bool>,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfPreviewResponse {
    pub relative_path: Option<String>,
    pub preview_url: Option<String>,
    pub source_url: Option<String>,
    pub cached: bool,
    pub cache_state: String,
    pub cache_error: Option<String>,
    pub downloaded_bytes: Option<u64>,
    pub total_bytes: Option<u64>,
    pub translated_relative_path: Option<String>,
    pub translated_preview_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfImportResponse {
    pub ok: bool,
    pub message: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryLinkImportResponse {
    pub ok: bool,
    pub message: String,
    pub relative_path: String,
    pub pdf_preview: LibraryPdfPreviewResponse,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPdfResumeResponse {
    pub queued: u32,
    pub skipped: u32,
    pub failed: u32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryDocumentOpenResponse {
    pub citation: LibraryCitationSummaryResponse,
    pub bib_preview: String,
    pub pdf_preview: LibraryPdfPreviewResponse,
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

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTranslateResponse {
    pub relative_path: String,
    pub source_kind: String,
    pub engine: String,
    #[serde(default)]
    pub artifact_paths: Vec<String>,
    pub detected_language: Option<String>,
    pub extraction_engine: Option<String>,
    pub extraction_mode: Option<String>,
    pub refined_by_search: bool,
    pub glossary_count: u32,
    pub translated_pdf_relative_path: String,
    pub source_pdf_relative_path: String,
    pub page_count: u32,
    pub ocr_page_count: u32,
    pub layout_mode: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTranslateStartResponse {
    pub task_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTranslateStatusInput {
    pub task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryTranslateStatusResponse {
    pub task_id: String,
    pub run_id: Option<String>,
    pub status: String,
    pub current_page: u32,
    pub total_pages: u32,
    pub stage: Option<String>,
    pub message: Option<String>,
    pub error: Option<String>,
    pub error_code: Option<String>,
    pub diagnostics: Vec<String>,
    pub result: Option<LibraryTranslateResponse>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPaperExtractInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPaperExtractChunk {
    pub chunk_index: u32,
    pub page_start: u32,
    pub page_end: u32,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LibraryPaperExtractResponse {
    pub source_path: String,
    pub title: String,
    pub metadata_block: String,
    pub chunks: Vec<LibraryPaperExtractChunk>,
    pub pdf_relative_path: Option<String>,
    pub detected_language: Option<String>,
    pub extraction_engine: Option<String>,
    pub extraction_mode: Option<String>,
    pub page_count: u32,
    pub ocr_page_count: u32,
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

