use super::plugins_builtin::built_in_catalog;
use super::plugins_declarative_validation::validate_safe_contribution_details;
use super::plugins_declarative_validation_more::validate_more_safe_contribution_details;
use super::plugins_install_validation::{
    validate_runtime_asset, validate_toolchain_installer, validate_toolchain_probe,
};
use super::plugins_policy::{
    ALLOWED_CONTRIBUTION_KINDS, DECLARATIVE_COMMAND_KINDS, SAFE_COMMAND_REFS,
};
#[path = "plugins_catalog.rs"]
mod catalog;
use crate::models::{
    Ack, InstalledPlugin, PluginCatalogInput, PluginCatalogResponse, PluginInstallInput,
    PluginManifest, PluginRefInput, PluginSetEnabledInput, PluginValidationIssue,
    PluginValidationResult,
};
use crate::state::AppState;
use crate::storage;
pub(crate) use catalog::read_registry;
use catalog::{load_remote_catalog, merge_catalog, normalize_sources, write_registry};
use std::collections::HashSet;
use tauri::State;

const PLUGIN_SCHEMA: &str = "latotex.plugin.v1";
const CATALOG_SCHEMA: &str = "latotex.marketplace.v1";
fn issue(code: &str, severity: &str, message: &str) -> PluginValidationIssue {
    PluginValidationIssue {
        code: code.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        params: None,
    }
}
fn issue_with_params(
    code: &str,
    severity: &str,
    message: &str,
    params: std::collections::HashMap<String, String>,
) -> PluginValidationIssue {
    PluginValidationIssue {
        code: code.to_string(),
        severity: severity.to_string(),
        message: message.to_string(),
        params: Some(params),
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

fn sha256_is_valid(value: &str) -> bool {
    let trimmed = value.trim();
    trimmed.len() == 64 && trimmed.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn high_risk_permissions(manifest: &PluginManifest) -> HashSet<&str> {
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
    manifest
        .permissions
        .iter()
        .map(String::as_str)
        .filter(|permission| high_risk.contains(permission))
        .collect()
}

pub(crate) fn apply_plugin_enabled_policy(
    plugin: &mut InstalledPlugin,
    enabled: bool,
    approved_permissions: &[String],
) -> Result<(), String> {
    if enabled {
        let required = high_risk_permissions(&plugin.manifest);
        let approved = plugin
            .approved_permissions
            .iter()
            .chain(approved_permissions.iter())
            .map(String::as_str)
            .collect::<HashSet<_>>();
        let mut missing = required
            .into_iter()
            .filter(|permission| !approved.contains(permission))
            .collect::<Vec<_>>();
        missing.sort_unstable();
        if !missing.is_empty() {
            return Err(format!(
                "plugin.permission.approval_required:{}",
                missing.join(",")
            ));
        }
        for permission in approved_permissions {
            if !plugin.approved_permissions.contains(permission) {
                plugin.approved_permissions.push(permission.clone());
            }
        }
        plugin.trust_state = "user_approved".to_string();
    }
    plugin.enabled = enabled;
    Ok(())
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
    if !is_http_url(&manifest.homepage) || !is_http_url(&manifest.repository) {
        issues.push(issue(
            "plugin.manifest.invalid_url",
            "error",
            "Plugin homepage and repository URLs must use http or https.",
        ));
    }
    if manifest
        .license
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
        issues.push(issue(
            "plugin.manifest.license_missing",
            "warning",
            "A plugin should declare a license.",
        ));
    }
    if manifest
        .repository
        .as_deref()
        .map(str::trim)
        .unwrap_or("")
        .is_empty()
    {
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
    let hash = manifest
        .sha256
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty());
    if has_download
        && !manifest
            .download_url
            .as_deref()
            .map(is_https_url)
            .unwrap_or(false)
    {
        issues.push(issue(
            "plugin.manifest.download_https_required",
            "error",
            "Downloadable plugins must use HTTPS.",
        ));
    }
    if has_download && hash.is_none() {
        issues.push(issue(
            "plugin.manifest.sha256_missing",
            "error",
            "Downloadable plugins must declare sha256.",
        ));
    }
    if let Some(value) = hash {
        if !sha256_is_valid(value) {
            issues.push(issue(
                "plugin.manifest.sha256_invalid",
                "error",
                "Plugin sha256 must contain exactly 64 hexadecimal characters.",
            ));
        }
    }
    validate_permissions(manifest, &mut issues);
    validate_contributions(manifest, &mut issues);
    let ok = !issues.iter().any(|item| item.severity == "error");
    PluginValidationResult { ok, issues }
}

fn validate_permissions(manifest: &PluginManifest, issues: &mut Vec<PluginValidationIssue>) {
    let high_risk = high_risk_permissions(manifest);
    for permission in &manifest.permissions {
        if high_risk.contains(permission.as_str()) {
            let mut params = std::collections::HashMap::new();
            params.insert("permission".to_string(), permission.clone());
            issues.push(issue_with_params(
                "plugin.permission.high_risk",
                "warning",
                &format!("High-risk permission declared: {permission}."),
                params,
            ));
        }
    }
}

fn validate_contributions(manifest: &PluginManifest, issues: &mut Vec<PluginValidationIssue>) {
    for contribution in &manifest.contributions {
        if !validate_identifier(&contribution.id, 96) || contribution.title.trim().is_empty() {
            issues.push(issue(
                "plugin.contribution.invalid",
                "error",
                "Contribution id and title are required.",
            ));
        }
        if !ALLOWED_CONTRIBUTION_KINDS.contains(&contribution.kind.as_str()) {
            issues.push(issue(
                "plugin.contribution.unknown_kind",
                "error",
                &format!("Unknown contribution kind: {}.", contribution.kind),
            ));
        }
        if DECLARATIVE_COMMAND_KINDS.contains(&contribution.kind.as_str()) {
            let Some(command_ref) = contribution.command_ref.as_ref() else {
                issues.push(issue(
                    "plugin.contribution.command_ref_missing",
                    "error",
                    "Declarative command contributions must declare commandRef.",
                ));
                continue;
            };
            let command_id = command_ref.id.trim();
            if !SAFE_COMMAND_REFS.contains(&command_id) {
                issues.push(issue(
                    "plugin.contribution.command_ref_unsafe",
                    "error",
                    &format!("Command reference is not in the safe allowlist: {command_id}."),
                ));
            }
            if matches!(
                contribution.kind.as_str(),
                "toolbarButton" | "menuItem" | "statusItem"
            ) && contribution
                .location
                .as_deref()
                .map(str::trim)
                .unwrap_or("")
                .is_empty()
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
        if contribution.kind == "toolchainProbe" {
            validate_toolchain_probe(contribution.toolchain_probe.as_ref(), issues);
        }
        if contribution.kind == "runtimeAsset" {
            validate_runtime_asset(contribution.runtime_asset.as_ref(), issues);
        }
        validate_safe_contribution_details(contribution, issues);
        validate_more_safe_contribution_details(contribution, issues);
    }
}

#[tauri::command]
pub fn plugin_validate_manifest(
    input: PluginInstallInput,
) -> Result<PluginValidationResult, String> {
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
        if !source.url.starts_with("https://") {
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
        enabled: false,
        installed_at: storage::now_iso(),
        source: input.source.unwrap_or_else(|| "catalog".to_string()),
        trust_state: "catalog_declared".to_string(),
        integrity_verified: false,
        approved_permissions: Vec::new(),
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
    apply_plugin_enabled_policy(plugin, input.enabled, &input.approved_permissions)?;
    let updated = plugin.clone();
    write_registry(&state.runtime_root, &plugins)?;
    Ok(updated)
}
