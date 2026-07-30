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

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct MarkdownRunCodeCapability {
    pub language: String,
    pub available: bool,
    pub runner: Option<String>,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ScientificCommandInput {
    pub project_id: String,
    pub plugin_id: String,
    pub command_id: String,
    pub relative_path: String,
    #[serde(default)]
    pub code: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ScientificCommandResponse {
    pub command_id: String,
    pub status: String,
    pub message: String,
    pub output: Option<MarkdownRunCodeResponse>,
}
