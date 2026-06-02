#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainInstallRecord {
    pub plugin_id: String,
    pub contribution_id: String,
    pub installer: PluginToolchainInstaller,
    pub installed_at: String,
    pub root_dir: String,
    pub executable_path: String,
    pub version: Option<String>,
    #[serde(default)]
    pub source: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainActionInput {
    pub plugin_id: String,
    pub contribution_id: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainLocalRegisterInput {
    pub plugin_id: String,
    pub contribution_id: String,
    pub root_dir: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainStatus {
    pub plugin_id: String,
    pub contribution_id: String,
    pub kind: String,
    pub installed: bool,
    pub install_path: Option<String>,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub message: String,
    pub source: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssetInstallRecord {
    pub plugin_id: String,
    pub contribution_id: String,
    pub asset: PluginRuntimeAsset,
    pub installed_at: String,
    pub root_dir: String,
    pub entry_path: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssetActionInput {
    pub plugin_id: String,
    pub contribution_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssetStatus {
    pub plugin_id: String,
    pub contribution_id: String,
    pub kind: String,
    pub installed: bool,
    pub install_path: Option<String>,
    pub entry_path: Option<String>,
    pub message: String,
    pub source: String,
}
