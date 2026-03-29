#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWarmupStartInput {
    pub project_id: String,
    #[serde(default)]
    pub scopes: Vec<String>,
    pub library_relative_path: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWarmupStatusInput {
    pub task_id: String,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TectonicWarmupInfo {
    pub ready: bool,
    pub engine_path: String,
    pub cache_dir: String,
    #[serde(default)]
    pub search_paths: Vec<String>,
    pub use_only_cached: bool,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWarmupResult {
    pub drawio: Option<DrawioCacheInfo>,
    pub tectonic: Option<TectonicWarmupInfo>,
    pub library_pdf: Option<LibraryPdfPreviewResponse>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWarmupStartResponse {
    pub task_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ResourceWarmupTaskStatusResponse {
    pub task_id: String,
    pub status: String,
    pub stage: Option<String>,
    pub percent: f64,
    pub message: Option<String>,
    pub current_item: Option<String>,
    pub error: Option<String>,
    pub diagnostics: Vec<String>,
    pub result: Option<ResourceWarmupResult>,
}

