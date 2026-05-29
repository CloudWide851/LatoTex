#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginMcpServerTemplate {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Option<Vec<String>>,
    #[serde(default)]
    pub env: Option<std::collections::HashMap<String, String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandTemplate {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub command: String,
    #[serde(default)]
    pub args: Option<Vec<String>>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginToolchainInstaller {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub download_url: String,
    #[serde(default)]
    pub download_url_cn: Option<String>,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub archive_format: String,
    #[serde(default)]
    pub executable: String,
    #[serde(default)]
    pub version_arg: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginRuntimeAsset {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub download_url: String,
    #[serde(default)]
    pub download_url_cn: Option<String>,
    #[serde(default)]
    pub sha256: String,
    #[serde(default)]
    pub archive_format: String,
    #[serde(default)]
    pub entry_path: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginToolchainProbe {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub platform: String,
    #[serde(default)]
    pub executables: Vec<String>,
    #[serde(default)]
    pub version_arg: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCommandRef {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginContribution {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub command_ref: Option<PluginCommandRef>,
    #[serde(default)]
    pub location: Option<String>,
    #[serde(default)]
    pub group: Option<String>,
    #[serde(default)]
    pub when: Option<String>,
    #[serde(default)]
    pub mcp_server: Option<PluginMcpServerTemplate>,
    #[serde(default)]
    pub command: Option<PluginCommandTemplate>,
    #[serde(default)]
    pub skill_id: Option<String>,
    #[serde(default)]
    pub toolchain_installer: Option<PluginToolchainInstaller>,
    #[serde(default)]
    pub toolchain_probe: Option<PluginToolchainProbe>,
    #[serde(default)]
    pub runtime_asset: Option<PluginRuntimeAsset>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginEngines {
    #[serde(default)]
    pub latotex: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCapabilities {
    #[serde(default)]
    pub untrusted_workspaces: Option<String>,
    #[serde(default)]
    pub virtual_workspaces: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginManifest {
    #[serde(default)]
    pub schema: String,
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub publisher: String,
    #[serde(default)]
    pub version: String,
    #[serde(default)]
    pub description: String,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub download_url: Option<String>,
    #[serde(default)]
    pub sha256: Option<String>,
    #[serde(default)]
    pub homepage: Option<String>,
    #[serde(default)]
    pub repository: Option<String>,
    #[serde(default)]
    pub license: Option<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
    #[serde(default)]
    pub engines: Option<PluginEngines>,
    #[serde(default)]
    pub activation_events: Vec<String>,
    #[serde(default)]
    pub capabilities: Option<PluginCapabilities>,
    #[serde(default)]
    pub permissions: Vec<String>,
    #[serde(default)]
    pub contributions: Vec<PluginContribution>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogSource {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub name: String,
    #[serde(default)]
    pub url: String,
    #[serde(default)]
    pub enabled: Option<bool>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginValidationIssue {
    pub code: String,
    pub severity: String,
    pub message: String,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginValidationResult {
    pub ok: bool,
    pub issues: Vec<PluginValidationIssue>,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogEntry {
    pub manifest: PluginManifest,
    pub source_id: String,
    pub source_name: String,
    pub validation: PluginValidationResult,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct InstalledPlugin {
    pub manifest: PluginManifest,
    pub enabled: bool,
    pub installed_at: String,
    pub source: String,
    #[serde(default)]
    pub validation_issues: Vec<PluginValidationIssue>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogInput {
    #[serde(default)]
    pub catalog_url: Option<String>,
    #[serde(default)]
    pub catalog_sources: Option<Vec<PluginCatalogSource>>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginCatalogResponse {
    pub schema: String,
    pub items: Vec<PluginCatalogEntry>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PluginInstallInput {
    pub manifest: PluginManifest,
    #[serde(default)]
    pub source: Option<String>,
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
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ToolchainActionInput {
    pub plugin_id: String,
    pub contribution_id: String,
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
}
