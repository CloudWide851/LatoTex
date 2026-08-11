#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelProtocolInput {
    pub id: String,
    pub display_name: String,
    pub base_url: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelCatalogItemInput {
    pub id: String,
    pub protocol_id: String,
    pub display_name: String,
    pub request_name: String,
    #[serde(default)]
    pub capabilities: Option<ModelCapabilities>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SettingsUpdateInput {
    pub active_project_id: Option<String>,
    pub model_protocols: Vec<ModelProtocolInput>,
    pub model_catalog: Vec<ModelCatalogItemInput>,
    pub agent_bindings: Vec<AgentModelBinding>,
    pub ui_prefs: Option<UiPrefs>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeySetInput {
    pub model_id: String,
    pub api_key: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeyGetInput {
    pub model_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeyValue {
    pub model_id: String,
    pub api_key: String,
    pub source: String,
    pub diagnostic_code: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelApiKeySaveVerifiedInput {
    pub model_id: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CredentialSaveResult {
    pub ok: bool,
    pub stage: String,
    pub message: String,
    pub storage_backend: String,
    pub diagnostic_code: Option<String>,
    pub readback_source: Option<String>,
    pub readback_attempts: Option<u32>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolTestInput {
    pub protocol_id: String,
    pub base_url: Option<String>,
    pub api_key: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProtocolHealth {
    pub protocol_id: String,
    pub ok: bool,
    pub message: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestInput {
    pub model_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelDraftTestInput {
    pub protocol_id: String,
    pub base_url: String,
    pub request_name: String,
    pub api_key: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ModelTestResult {
    pub model_id: String,
    pub ok: bool,
    pub message: String,
}
