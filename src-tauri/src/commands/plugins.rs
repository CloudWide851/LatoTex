use crate::models::{
    Ack, InstalledPlugin, PluginCatalogEntry, PluginCatalogInput,
    PluginCatalogResponse, PluginCatalogSource,
    PluginInstallInput, PluginManifest, PluginRefInput, PluginSetEnabledInput,
    PluginToolchainInstaller, PluginValidationIssue, PluginValidationResult,
};
use crate::state::AppState;
use crate::storage;
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use super::plugins_builtin::built_in_catalog;

const PLUGIN_SCHEMA: &str = "latotex.plugin.v1";
const CATALOG_SCHEMA: &str = "latotex.marketplace.v1";

fn registry_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("plugins").join("registry.json")
}

fn issue(code: &str, severity: &str, message: &str) -> PluginValidationIssue {
    PluginValidationIssue {
        code: code.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
    }
}

fn validate_identifier(value: &str, max_len: usize) -> bool {
    let trimmed = value.trim();
    !trimmed.is_empty()
        && trimmed.len() <= max_len
        && trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn is_http_url(value: &Option<String>) -> bool {
    value
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.starts_with("https://") || item.starts_with("http://"))
        .unwrap_or(true)
}

fn is_https_url(value: &str) -> bool {
    value.trim().starts_with("https://")
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub(crate) fn validate_manifest(manifest: &PluginManifest) -> PluginValidationResult {
    let mut issues = Vec::new();
    if manifest.schema != PLUGIN_SCHEMA {
        issues.push(issue(
            "plugin.manifest.unsupported_schema",
            "error",
            "Manifest schema must be latotex.plugin.v1.",
        ));
    }
    if !validate_identifier(&manifest.id, 96) {
        issues.push(issue(
            "plugin.manifest.invalid_id",
            "error",
            "Plugin id must be ASCII and use letters, numbers, dot, dash, or underscore.",
        ));
    }
    if manifest.name.trim().is_empty()
        || manifest.publisher.trim().is_empty()
        || manifest.version.trim().is_empty()
        || manifest.description.trim().is_empty()
    {
        issues.push(issue(
            "plugin.manifest.missing_required",
            "error",
            "Manifest requires name, publisher, version, and description.",
        ));
    }
    if !is_http_url(&manifest.homepage)
        || !is_http_url(&manifest.repository)
        || !is_http_url(&manifest.download_url)
    {
        issues.push(issue(
            "plugin.manifest.invalid_url",
            "error",
            "Plugin URLs must use http or https.",
        ));
    }
    if manifest.license.as_deref().map(str::trim).unwrap_or("").is_empty() {
        issues.push(issue(
            "plugin.manifest.license_missing",
            "warning",
            "A plugin should declare a license.",
        ));
    }
    if manifest.repository.as_deref().map(str::trim).unwrap_or("").is_empty() {
        issues.push(issue(
            "plugin.manifest.repository_missing",
            "warning",
            "A plugin should declare a repository.",
        ));
    }
    let has_download = manifest
        .download_url
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .is_some();
    let has_hash = manifest
        .sha256
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .is_some();
    if has_download && !has_hash {
        issues.push(issue(
            "plugin.manifest.sha256_missing",
            "warning",
            "Downloadable plugins should declare sha256.",
        ));
    }
    validate_permissions(manifest, &mut issues);
    validate_contributions(manifest, &mut issues);
    let ok = !issues.iter().any(|item| item.severity == "error");
    PluginValidationResult { ok, issues }
}

fn validate_permissions(manifest: &PluginManifest, issues: &mut Vec<PluginValidationIssue>) {
    let high_risk = HashSet::from([
        "workspace.write",
        "process.spawn",
        "shell",
        "network.fetch",
        "env.read",
        "secrets.read",
        "mcp",
        "plugin.command",
    ]);
    for permission in &manifest.permissions {
        if high_risk.contains(permission.as_str()) {
            issues.push(issue(
                "plugin.permission.high_risk",
                "warning",
                &format!("High-risk permission declared: {permission}."),
            ));
        }
    }
}

fn validate_contributions(manifest: &PluginManifest, issues: &mut Vec<PluginValidationIssue>) {
    let allowed = HashSet::from([
        "workspacePage",
        "settingsSection",
        "command",
        "mcpServer",
        "skill",
        "docxTool",
        "toolbarButton",
        "menuItem",
        "statusItem",
        "workspaceCommand",
        "docxCommand",
        "editorCommand",
        "analysisCommand",
        "libraryCommand",
        "markdownCommand",
        "terminalCommand",
        "resourceCommand",
        "toolchainInstaller",
    ]);
    let safe_commands = HashSet::from([
        "app.openPage",
        "settings.openSection",
        "workspace.rescan",
        "workspace.openTerminal",
        "workspace.revealInSystem",
        "editor.save",
        "editor.reload",
        "editor.find",
        "editor.formatDocument",
        "analysis.createTask",
        "analysis.run",
        "analysis.continue",
        "analysis.exportReport",
        "library.rescan",
        "library.importPdf",
        "library.resolvePreview",
        "docx.save",
        "docx.reload",
        "docx.find",
        "docx.replaceAll",
        "docx.insertTable",
        "docx.insertLink",
        "docx.insertResource",
        "docx.insertImage",
        "markdown.runFence",
        "markdown.clearOutput",
        "terminal.restoreHistory",
        "terminal.clearTabHistory",
        "toolchain.install",
        "toolchain.verify",
        "toolchain.remove",
    ]);
    let declarative_command_kinds = HashSet::from([
        "toolbarButton",
        "menuItem",
        "statusItem",
        "workspaceCommand",
        "docxCommand",
        "editorCommand",
        "analysisCommand",
        "libraryCommand",
        "markdownCommand",
        "terminalCommand",
        "resourceCommand",
    ]);
    for contribution in &manifest.contributions {
        if !validate_identifier(&contribution.id, 96) || contribution.title.trim().is_empty() {
            issues.push(issue(
                "plugin.contribution.invalid",
                "error",
                "Contribution id and title are required.",
            ));
        }
        if !allowed.contains(contribution.kind.as_str()) {
            issues.push(issue(
                "plugin.contribution.unknown_kind",
                "error",
                &format!("Unknown contribution kind: {}.", contribution.kind),
            ));
        }
        if declarative_command_kinds.contains(contribution.kind.as_str()) {
            let Some(command_ref) = contribution.command_ref.as_ref() else {
                issues.push(issue(
                    "plugin.contribution.command_ref_missing",
                    "error",
                    "Declarative command contributions must declare commandRef.",
                ));
                continue;
            };
            let command_id = command_ref.id.trim();
            if !safe_commands.contains(command_id) {
                issues.push(issue(
                    "plugin.contribution.command_ref_unsafe",
                    "error",
                    &format!("Command reference is not in the safe allowlist: {command_id}."),
                ));
            }
            if matches!(contribution.kind.as_str(), "toolbarButton" | "menuItem" | "statusItem")
                && contribution.location.as_deref().map(str::trim).unwrap_or("").is_empty()
            {
                issues.push(issue(
                    "plugin.contribution.location_missing",
                    "error",
                    "UI command contributions must declare a location.",
                ));
            }
        }
        if contribution.kind == "mcpServer" {
            let Some(server) = contribution.mcp_server.as_ref() else {
                issues.push(issue(
                    "plugin.contribution.mcp_missing",
                    "error",
                    "MCP contribution must declare mcpServer.",
                ));
                continue;
            };
            if !validate_identifier(&server.id, 96) || server.command.trim().is_empty() {
                issues.push(issue(
                    "plugin.contribution.mcp_invalid",
                    "error",
                    "MCP server template requires id and command.",
                ));
            }
        }
        if contribution.kind == "command" {
            let Some(command) = contribution.command.as_ref() else {
                issues.push(issue(
                    "plugin.contribution.command_missing",
                    "error",
                    "Command contribution must declare command.",
                ));
                continue;
            };
            if !validate_identifier(&command.id, 96) || command.command.trim().is_empty() {
                issues.push(issue(
                    "plugin.contribution.command_invalid",
                    "error",
                    "Command contribution requires id and command.",
                ));
            }
        }
        if contribution.kind == "toolchainInstaller" {
            validate_toolchain_installer(contribution.toolchain_installer.as_ref(), issues);
        }
    }
}

fn validate_toolchain_installer(
    installer: Option<&PluginToolchainInstaller>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(installer) = installer else {
        issues.push(issue(
            "plugin.contribution.toolchain_missing",
            "error",
            "Toolchain installer contributions must declare toolchainInstaller.",
        ));
        return;
    };
    let allowed_kinds = HashSet::from(["git", "python", "node", "c", "cpp"]);
    let allowed_archives = HashSet::from(["zip", "exe"]);
    if !validate_identifier(&installer.id, 96)
        || !allowed_kinds.contains(installer.kind.as_str())
        || installer.platform != "windows-x64"
        || !allowed_archives.contains(installer.archive_format.as_str())
        || installer.executable.trim().is_empty()
    {
        issues.push(issue(
            "plugin.contribution.toolchain_invalid",
            "error",
            "Toolchain installer must target a supported Windows x64 portable toolchain.",
        ));
    }
    if !is_https_url(&installer.download_url) || !is_sha256(&installer.sha256) {
        issues.push(issue(
            "plugin.contribution.toolchain_integrity",
            "error",
            "Toolchain installer downloads require HTTPS and a SHA-256 hash.",
        ));
    }
}

fn read_registry(runtime_root: &Path) -> Result<Vec<InstalledPlugin>, String> {
    let path = registry_path(runtime_root);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Vec<InstalledPlugin>>(&content).map_err(|e| e.to_string())
}

fn write_registry(runtime_root: &Path, plugins: &[InstalledPlugin]) -> Result<(), String> {
    let path = registry_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(plugins).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn manifest_from_value(value: serde_json::Value) -> Result<PluginManifest, String> {
    serde_json::from_value::<PluginManifest>(value).map_err(|e| e.to_string())
}

fn parse_catalog_items(value: serde_json::Value) -> Vec<serde_json::Value> {
    value
        .get("items")
        .and_then(|item| item.as_array())
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default()
}

fn load_remote_catalog(source: &PluginCatalogSource) -> Result<Vec<PluginCatalogEntry>, String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?
        .get(source.url.trim())
        .send()
        .map_err(|e| format!("plugin.catalog.fetch_failed:{}:{e}", source.id))?;
    if !response.status().is_success() {
        return Err(format!("plugin.catalog.http:{}:{}", source.id, response.status()));
    }
    let value: serde_json::Value = response.json().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for (index, item) in parse_catalog_items(value).into_iter().enumerate() {
        match manifest_from_value(item) {
            Ok(manifest) => {
                let validation = validate_manifest(&manifest);
                entries.push(PluginCatalogEntry {
                    manifest,
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    validation,
                });
            }
            Err(error) => {
                let manifest = PluginManifest {
                    schema: PLUGIN_SCHEMA.to_string(),
                    id: format!("{}.__invalid_{index}", source.id),
                    name: "Invalid plugin manifest".to_string(),
                    display_name: None,
                    publisher: source.name.clone(),
                    version: "0.0.0".to_string(),
                    description: error.clone(),
                    categories: vec!["Invalid".to_string()],
                    icon: None,
                    download_url: None,
                    sha256: None,
                    homepage: None,
                    repository: None,
                    license: None,
                    keywords: Vec::new(),
                    engines: None,
                    activation_events: Vec::new(),
                    capabilities: None,
                    permissions: Vec::new(),
                    contributions: Vec::new(),
                };
                entries.push(PluginCatalogEntry {
                    manifest,
                    source_id: source.id.clone(),
                    source_name: source.name.clone(),
                    validation: PluginValidationResult {
                        ok: false,
                        issues: vec![issue(
                            "plugin.manifest.parse_failed",
                            "error",
                            &format!("Catalog entry could not be parsed: {error}"),
                        )],
                    },
                });
            }
        }
    }
    Ok(entries)
}

fn normalize_sources(input: &PluginCatalogInput) -> Vec<PluginCatalogSource> {
    let mut sources = input.catalog_sources.clone().unwrap_or_default();
    if let Some(url) = input.catalog_url.as_deref().map(str::trim).filter(|item| !item.is_empty()) {
        sources.push(PluginCatalogSource {
            id: "custom".to_string(),
            name: "Custom".to_string(),
            url: url.to_string(),
            enabled: Some(true),
        });
    }
    sources
        .into_iter()
        .map(|source| PluginCatalogSource {
            id: source.id.trim().to_string(),
            name: source.name.trim().to_string(),
            url: source.url.trim().to_string(),
            enabled: source.enabled,
        })
        .filter(|source| source.enabled.unwrap_or(true) && !source.url.is_empty())
        .collect()
}

fn merge_catalog(entries: Vec<PluginCatalogEntry>, warnings: &mut Vec<String>) -> Vec<PluginCatalogEntry> {
    let mut seen = HashSet::new();
    let mut out = Vec::new();
    for entry in entries {
        let id = entry.manifest.id.trim().to_string();
        if id.is_empty() {
            out.push(entry);
            continue;
        }
        if seen.contains(&id) {
            warnings.push(format!("plugin.catalog.duplicate:{id}"));
            continue;
        }
        seen.insert(id);
        out.push(entry);
    }
    out
}

#[tauri::command]
pub fn plugin_validate_manifest(input: PluginInstallInput) -> Result<PluginValidationResult, String> {
    Ok(validate_manifest(&input.manifest))
}

#[tauri::command]
pub fn plugin_marketplace_catalog(
    state: State<'_, AppState>,
    input: PluginCatalogInput,
) -> Result<PluginCatalogResponse, String> {
    state.log("INFO", "plugin_marketplace_catalog");
    let mut warnings = Vec::new();
    let mut items = built_in_catalog();
    for source in normalize_sources(&input) {
        if !source.url.starts_with("https://") && !source.url.starts_with("http://") {
            warnings.push(format!("plugin.catalog.invalid_url:{}", source.id));
            continue;
        }
        match load_remote_catalog(&source) {
            Ok(mut remote) => items.append(&mut remote),
            Err(error) => warnings.push(error),
        }
    }
    Ok(PluginCatalogResponse {
        schema: CATALOG_SCHEMA.to_string(),
        items: merge_catalog(items, &mut warnings),
        warnings,
    })
}

#[tauri::command]
pub fn plugin_installed_list(state: State<'_, AppState>) -> Result<Vec<InstalledPlugin>, String> {
    read_registry(&state.runtime_root)
}

#[tauri::command]
pub fn plugin_install(
    state: State<'_, AppState>,
    input: PluginInstallInput,
) -> Result<InstalledPlugin, String> {
    let validation = validate_manifest(&input.manifest);
    if !validation.ok {
        return Err("plugin.manifest.validation_failed".to_string());
    }
    state.log("INFO", &format!("plugin_install: {}", input.manifest.id));
    let mut plugins = read_registry(&state.runtime_root)?;
    plugins.retain(|item| item.manifest.id != input.manifest.id);
    let installed = InstalledPlugin {
        manifest: input.manifest,
        enabled: true,
        installed_at: storage::now_iso(),
        source: input.source.unwrap_or_else(|| "catalog".to_string()),
        validation_issues: validation.issues,
    };
    plugins.push(installed.clone());
    write_registry(&state.runtime_root, &plugins)?;
    Ok(installed)
}

#[tauri::command]
pub fn plugin_uninstall(state: State<'_, AppState>, input: PluginRefInput) -> Result<Ack, String> {
    state.log("INFO", &format!("plugin_uninstall: {}", input.plugin_id));
    let mut plugins = read_registry(&state.runtime_root)?;
    let before = plugins.len();
    plugins.retain(|item| item.manifest.id != input.plugin_id);
    write_registry(&state.runtime_root, &plugins)?;
    Ok(Ack {
        ok: before != plugins.len(),
        message: "plugin.uninstalled".to_string(),
    })
}

#[tauri::command]
pub fn plugin_set_enabled(
    state: State<'_, AppState>,
    input: PluginSetEnabledInput,
) -> Result<InstalledPlugin, String> {
    state.log(
        "INFO",
        &format!("plugin_set_enabled: {}={}", input.plugin_id, input.enabled),
    );
    let mut plugins = read_registry(&state.runtime_root)?;
    let Some(plugin) = plugins
        .iter_mut()
        .find(|item| item.manifest.id == input.plugin_id)
    else {
        return Err("plugin.not_installed".to_string());
    };
    plugin.enabled = input.enabled;
    let updated = plugin.clone();
    write_registry(&state.runtime_root, &plugins)?;
    Ok(updated)
}
