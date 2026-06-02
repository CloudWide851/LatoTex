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

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginFileOpenHandler {
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub open_with: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginPreviewProvider {
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub preview_mode: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginResourceBadge {
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginResourceClassifier {
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub category: String,
    #[serde(default)]
    pub icon: Option<String>,
    #[serde(default)]
    pub color: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginProblemMatcher {
    #[serde(default)]
    pub owner: String,
    #[serde(default)]
    pub pattern: String,
    #[serde(default)]
    pub file_group: Option<u8>,
    #[serde(default)]
    pub line_group: Option<u8>,
    #[serde(default)]
    pub column_group: Option<u8>,
    #[serde(default)]
    pub message_group: Option<u8>,
    #[serde(default)]
    pub severity: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginPanel {
    #[serde(default)]
    pub location: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub markdown: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsQuickAction {
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub command_ref: Option<PluginCommandRef>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginRuntimeAssetDetector {
    #[serde(default)]
    pub kind: String,
    #[serde(default)]
    pub filenames: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsSchemaField {
    #[serde(default)]
    pub key: String,
    #[serde(default)]
    pub field_kind: String,
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub required: Option<bool>,
    #[serde(default)]
    pub options: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSettingsSchema {
    #[serde(default)]
    pub section: String,
    #[serde(default)]
    pub fields: Vec<PluginSettingsSchemaField>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginFileTemplate {
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub default_name: String,
    #[serde(default)]
    pub template_kind: String,
    #[serde(default)]
    pub content: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSnippet {
    #[serde(default)]
    pub label: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub body: String,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginSnippetProvider {
    #[serde(default)]
    pub languages: Vec<String>,
    #[serde(default)]
    pub snippets: Vec<PluginSnippet>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginAgentContextPack {
    #[serde(default)]
    pub scopes: Vec<String>,
    #[serde(default)]
    pub include_patterns: Vec<String>,
    #[serde(default)]
    pub exclude_patterns: Vec<String>,
    #[serde(default)]
    pub max_files: Option<u16>,
    #[serde(default)]
    pub max_bytes: Option<u32>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginLanguageSupport {
    #[serde(default)]
    pub language: String,
    #[serde(default)]
    pub extensions: Vec<String>,
    #[serde(default)]
    pub filenames: Vec<String>,
    #[serde(default)]
    pub patterns: Vec<String>,
    #[serde(default)]
    pub editor_language: Option<String>,
    #[serde(default)]
    pub preview_mode: Option<String>,
}

include!("models_plugins_ui.rs");

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginLocalizedContribution {
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
}

#[derive(Debug, Serialize, Deserialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct PluginLocalizedManifest {
    #[serde(default)]
    pub name: Option<String>,
    #[serde(default)]
    pub display_name: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub categories: Vec<String>,
    #[serde(default)]
    pub keywords: Vec<String>,
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
    #[serde(default)]
    pub file_open_handler: Option<PluginFileOpenHandler>,
    #[serde(default)]
    pub preview_provider: Option<PluginPreviewProvider>,
    #[serde(default)]
    pub resource_badge: Option<PluginResourceBadge>,
    #[serde(default)]
    pub resource_classifier: Option<PluginResourceClassifier>,
    #[serde(default)]
    pub problem_matcher: Option<PluginProblemMatcher>,
    #[serde(default)]
    pub plugin_panel: Option<PluginPanel>,
    #[serde(default)]
    pub settings_quick_action: Option<PluginSettingsQuickAction>,
    #[serde(default)]
    pub runtime_asset_detector: Option<PluginRuntimeAssetDetector>,
    #[serde(default)]
    pub settings_schema: Option<PluginSettingsSchema>,
    #[serde(default)]
    pub file_template: Option<PluginFileTemplate>,
    #[serde(default)]
    pub snippet_provider: Option<PluginSnippetProvider>,
    #[serde(default)]
    pub agent_context_pack: Option<PluginAgentContextPack>,
    #[serde(default)]
    pub language_support: Option<PluginLanguageSupport>,
    #[serde(default)]
    pub sidebar_view: Option<PluginSidebarView>,
    #[serde(default)]
    pub tree_decoration: Option<PluginTreeDecoration>,
    #[serde(default)]
    pub command_palette_item: Option<PluginCommandPaletteItem>,
    #[serde(default)]
    pub localized: Option<std::collections::HashMap<String, PluginLocalizedContribution>>,
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
    #[serde(default)]
    pub localized: Option<std::collections::HashMap<String, PluginLocalizedManifest>>,
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

include!("models_plugins_toolchains.rs");
