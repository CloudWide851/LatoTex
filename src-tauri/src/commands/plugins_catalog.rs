use super::{issue, validate_manifest, PLUGIN_SCHEMA};
use crate::models::{
    InstalledPlugin, PluginCatalogEntry, PluginCatalogInput, PluginCatalogSource, PluginManifest,
    PluginValidationResult,
};
use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

fn registry_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("plugins").join("registry.json")
}

pub(crate) fn read_registry(runtime_root: &Path) -> Result<Vec<InstalledPlugin>, String> {
    let path = registry_path(runtime_root);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    let mut plugins =
        serde_json::from_str::<Vec<InstalledPlugin>>(&content).map_err(|e| e.to_string())?;
    let mut migrated = false;
    for plugin in &mut plugins {
        if plugin.trust_state.trim().is_empty() {
            if plugin.source.eq_ignore_ascii_case("builtin")
                || plugin.source.eq_ignore_ascii_case("builtIn")
            {
                plugin.trust_state = "builtin_trusted".to_string();
            } else {
                plugin.trust_state = "legacy_unverified".to_string();
                plugin.enabled = false;
            }
            migrated = true;
        }
        if plugin.trust_state == "legacy_unverified" && plugin.enabled {
            plugin.enabled = false;
            migrated = true;
        }
    }
    if migrated {
        write_registry(runtime_root, &plugins)?;
    }
    Ok(plugins)
}

pub(super) fn write_registry(
    runtime_root: &Path,
    plugins: &[InstalledPlugin],
) -> Result<(), String> {
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

fn parse_catalog_items(value: serde_json::Value) -> Vec<serde_json::Value> {
    value
        .get("items")
        .and_then(|item| item.as_array())
        .cloned()
        .or_else(|| value.as_array().cloned())
        .unwrap_or_default()
}

pub(super) fn load_remote_catalog(
    source: &PluginCatalogSource,
) -> Result<Vec<PluginCatalogEntry>, String> {
    let response = crate::remote_network::blocking_get_with_policy(
        source.url.trim(),
        false,
        std::time::Duration::from_secs(8),
        std::time::Duration::from_secs(12),
        "LatoTex/0.1.5",
    )
    .map_err(|e| format!("plugin.catalog.fetch_failed:{}:{e}", source.id))?;
    if !response.status().is_success() {
        return Err(format!(
            "plugin.catalog.http:{}:{}",
            source.id,
            response.status()
        ));
    }
    let value: serde_json::Value = response.json().map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for (index, item) in parse_catalog_items(value).into_iter().enumerate() {
        match serde_json::from_value::<PluginManifest>(item) {
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
                    description: error.to_string(),
                    categories: vec!["Invalid".to_string()],
                    icon: None,
                    download_url: None,
                    sha256: None,
                    homepage: None,
                    repository: None,
                    license: None,
                    integration_level: None,
                    runtime_source: None,
                    integrity: None,
                    telemetry: None,
                    keywords: Vec::new(),
                    engines: None,
                    activation_events: Vec::new(),
                    capabilities: None,
                    permissions: Vec::new(),
                    contributions: Vec::new(),
                    localized: None,
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

pub(super) fn normalize_sources(input: &PluginCatalogInput) -> Vec<PluginCatalogSource> {
    let mut sources = input.catalog_sources.clone().unwrap_or_default();
    if let Some(url) = input
        .catalog_url
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
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

pub(super) fn merge_catalog(
    entries: Vec<PluginCatalogEntry>,
    warnings: &mut Vec<String>,
) -> Vec<PluginCatalogEntry> {
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
