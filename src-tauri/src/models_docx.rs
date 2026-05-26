#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxReadInput {
    pub project_id: String,
    pub relative_path: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxReadResponse {
    pub relative_path: String,
    pub html: String,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DocxWriteInput {
    pub project_id: String,
    pub relative_path: String,
    pub html: String,
}
