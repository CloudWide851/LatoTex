#[derive(Debug, Serialize, Clone, Copy, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub enum TerminalStatus {
    Idle,
    Starting,
    Running,
    Exited,
    Failed,
    Activating,
}

#[derive(Debug, Serialize, Deserialize, Clone, Copy, PartialEq, Eq, Default)]
#[serde(rename_all = "kebab-case")]
pub enum TerminalLaunchKind {
    #[default]
    Shell,
    CodexCli,
    ClaudeCodeCli,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct TerminalFailure {
    pub code: String,
    pub stage: String,
    pub retryable: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartInput {
    pub project_id: String,
    pub request_id: String,
    #[serde(default)]
    pub launch_kind: TerminalLaunchKind,
    pub relative_path: Option<String>,
    pub cols: Option<u16>,
    pub rows: Option<u16>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStartResponse {
    pub session_id: String,
    pub cwd: String,
    pub shell: String,
    pub launch_kind: TerminalLaunchKind,
    pub venv_path: Option<String>,
    pub env_source: Option<String>,
    pub status: TerminalStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalCancelStartInput {
    pub request_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalActivateInput {
    pub project_id: String,
    pub session_id: String,
    pub retry: Option<bool>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalActivateResponse {
    pub session_id: String,
    pub venv_path: String,
    pub env_source: String,
    pub status: TerminalStatus,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalWriteInput {
    pub session_id: String,
    pub data: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReadInput {
    pub session_id: String,
    pub cursor: Option<u64>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalOutputChunk {
    pub seq: u64,
    pub stream: String,
    pub text: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalReadResponse {
    pub cursor: u64,
    pub chunks: Vec<TerminalOutputChunk>,
    pub exit_code: Option<i32>,
    pub status: TerminalStatus,
    pub failure: Option<TerminalFailure>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalResizeInput {
    pub session_id: String,
    pub cols: u16,
    pub rows: u16,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalStopInput {
    pub session_id: String,
}
