#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownRunCodeInput {
    pub project_id: String,
    pub relative_path: Option<String>,
    pub language: String,
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownRunCodeResponse {
    pub language: String,
    pub status: String,
    pub stdout: String,
    pub stderr: String,
    pub exit_code: Option<i32>,
    pub duration_ms: u128,
    pub truncated: bool,
    pub runner: String,
}
