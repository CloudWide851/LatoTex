#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcpServerTemplate {
    pub id: String,
    pub command: String,
    pub args: Option<Vec<String>>,
    pub env: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginContribution {
    pub kind: String,
    pub id: String,
    pub title: String,
    pub description: Option<String>,
    pub mcp_server: Option<PluginMcpServerTemplate>,
    pub skill_id: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    pub schema: String,
    pub id: String,
    pub name: String,
    pub publisher: String,
    pub version: String,
    pub description: String,
    pub categories: Vec<String>,
    pub icon: Option<String>,
    pub download_url: Option<String>,
    pub sha256: Option<String>,
    pub permissions: Vec<String>,
    pub contributions: Vec<PluginContribution>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub installed_at: String,
    pub source: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogInput {
    pub catalog_url: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogResponse {
    pub schema: String,
    pub items: Vec<PluginManifest>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallInput {
    pub manifest: PluginManifest,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginRefInput {
    pub plugin_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginSetEnabledInput {
    pub plugin_id: String,
    pub enabled: bool,
}
