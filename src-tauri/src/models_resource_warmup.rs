#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TectonicWarmupInfo {
    pub ready: bool,
    pub engine_path: String,
    #[serde(default)]
    pub cache_dir: String,
    #[serde(default)]
    pub search_paths: Vec<String>,
    pub use_only_cached: bool,
}
