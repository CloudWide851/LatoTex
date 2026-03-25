use std::collections::HashMap;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexCompileInput {
    pub project_id: String,
    pub main_path: String,
    pub entry_content: String,
    pub file_map: HashMap<String, String>,
    pub prefer_engine: Option<String>,
    pub reason: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct LatexCompileResponse {
    pub status: String,
    pub engine: String,
    pub diagnostics: Vec<String>,
    pub duration_ms: u64,
    pub pdf_relative_path: Option<String>,
    pub log_relative_path: Option<String>,
    pub pdf_bytes: Option<Vec<u8>>,
    pub used_fallback_fonts: Vec<String>,
    pub recovered_packages: Vec<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisEnvStatusResponse {
    pub ready: bool,
    pub exists: bool,
    pub env_key: String,
    pub managed_root: String,
    pub uv_path: Option<String>,
    pub uv_version: Option<String>,
    pub python_path: Option<String>,
    pub python_version: Option<String>,
    pub pdf_math_translate_version: Option<String>,
    pub venv_path: String,
    pub runtime_root: String,
    pub last_error: Option<String>,
}
#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisNumericSeriesItem {
    pub label: String,
    pub value: f64,
}

#[derive(Debug, Deserialize, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisSourceSnapshotInput {
    pub path: String,
    pub kind: String,
    pub summary: String,
    pub excerpt: String,
    pub rows: Option<u32>,
    pub columns: Option<u32>,
    pub numeric_series: Option<Vec<AnalysisNumericSeriesItem>>,
}

#[derive(Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunPythonInput {
    pub project_id: String,
    pub task_id: Option<String>,
    pub prompt: String,
    pub output_language: String,
    pub snapshots: Vec<AnalysisSourceSnapshotInput>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AnalysisRunPythonResponse {
    pub status: String,
    pub runtime_source: String,
    pub python_path: String,
    pub venv_path: String,
    pub stdout: String,
    pub stderr: String,
    pub diagnostics: Vec<String>,
    pub profile_json: Value,
}





