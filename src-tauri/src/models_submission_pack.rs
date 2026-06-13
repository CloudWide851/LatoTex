#[derive(Debug, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionPackIssueInput {
    pub id: String,
    pub severity: String,
    pub count: Option<u32>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionPackIssue {
    pub id: String,
    pub severity: String,
    pub count: Option<u32>,
    pub detail: Option<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionPackFile {
    pub path: String,
    pub size_bytes: u64,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionPackSkippedFile {
    pub path: String,
    pub reason: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionPackBuildInput {
    pub project_id: String,
    pub main_path: String,
    pub profile_id: String,
    #[serde(default)]
    pub gate_issues: Vec<SubmissionPackIssueInput>,
    #[serde(default)]
    pub compile_diagnostics: Vec<String>,
}

#[derive(Debug, Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct SubmissionPackBuildResponse {
    pub status: String,
    pub profile_id: String,
    pub manifest_path: String,
    pub zip_path: Option<String>,
    pub blockers: Vec<SubmissionPackIssue>,
    pub warnings: Vec<SubmissionPackIssue>,
    pub included_files: Vec<SubmissionPackFile>,
    pub skipped_files: Vec<SubmissionPackSkippedFile>,
}
