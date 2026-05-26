use crate::models::{
    Ack, InstalledPlugin, PluginCatalogInput, PluginCatalogResponse, PluginContribution,
    PluginInstallInput, PluginManifest, PluginMcpServerTemplate, PluginRefInput,
    PluginSetEnabledInput,
};
use crate::state::AppState;
use crate::storage;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

const PLUGIN_SCHEMA: &str = "latotex.plugin.v1";
const CATALOG_SCHEMA: &str = "latotex.marketplace.v1";

fn registry_path(runtime_root: &Path) -> PathBuf {
    runtime_root.join("plugins").join("registry.json")
}

fn validate_manifest(manifest: &PluginManifest) -> Result<(), String> {
    if manifest.schema != PLUGIN_SCHEMA {
        return Err("plugin.manifest.unsupported_schema".to_string());
    }
    let id = manifest.id.trim();
    if id.is_empty() || id.len() > 96 {
        return Err("plugin.manifest.invalid_id".to_string());
    }
    if !id
        .chars()
        .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("plugin.manifest.invalid_id".to_string());
    }
    if manifest.name.trim().is_empty()
        || manifest.publisher.trim().is_empty()
        || manifest.version.trim().is_empty()
    {
        return Err("plugin.manifest.missing_required".to_string());
    }
    Ok(())
}

fn built_in_catalog() -> Vec<PluginManifest> {
    let stitch_mcp = PluginMcpServerTemplate {
        id: "stitch".to_string(),
        command: "pnpm".to_string(),
        args: Some(vec![
            "exec".to_string(),
            "stitch-mcp".to_string(),
            "proxy".to_string(),
        ]),
        env: Some(HashMap::from([(
            "STITCH_USE_SYSTEM_GCLOUD".to_string(),
            "1".to_string(),
        )])),
    };
    vec![
        PluginManifest {
            schema: PLUGIN_SCHEMA.to_string(),
            id: "latotex.stitch-tools".to_string(),
            name: "Stitch Tools".to_string(),
            publisher: "LatoTex".to_string(),
            version: "1.0.0".to_string(),
            description: "Design workflow helpers with Stitch MCP and design skills.".to_string(),
            categories: vec!["Design".to_string(), "MCP".to_string()],
            icon: None,
            download_url: None,
            sha256: None,
            permissions: vec!["mcp".to_string(), "agent.skills".to_string()],
            contributions: vec![
                PluginContribution {
                    kind: "mcpServer".to_string(),
                    id: "stitch".to_string(),
                    title: "Stitch MCP".to_string(),
                    description: Some("Installs a standard Stitch MCP server row.".to_string()),
                    mcp_server: Some(stitch_mcp),
                    skill_id: None,
                },
                PluginContribution {
                    kind: "skill".to_string(),
                    id: "stitch-design".to_string(),
                    title: "Stitch Design Skill".to_string(),
                    description: None,
                    mcp_server: None,
                    skill_id: Some("stitch".to_string()),
                },
            ],
        },
        PluginManifest {
            schema: PLUGIN_SCHEMA.to_string(),
            id: "latotex.docx-workspace".to_string(),
            name: "DOCX Workspace".to_string(),
            publisher: "LatoTex".to_string(),
            version: "1.0.0".to_string(),
            description: "Adds DOCX reading, rich text editing, and binary save support.".to_string(),
            categories: vec!["Editor".to_string(), "Office".to_string()],
            icon: None,
            download_url: None,
            sha256: None,
            permissions: vec!["workspace.read".to_string(), "workspace.write".to_string()],
            contributions: vec![PluginContribution {
                kind: "workspacePage".to_string(),
                id: "docx".to_string(),
                title: "DOCX".to_string(),
                description: Some("DOCX editor under the LaTeX workspace.".to_string()),
                mcp_server: None,
                skill_id: None,
            }],
        },
    ]
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

fn merge_catalog(mut base: Vec<PluginManifest>, mut extra: Vec<PluginManifest>) -> Vec<PluginManifest> {
    for item in extra.drain(..) {
        if base.iter().any(|existing| existing.id == item.id) {
            continue;
        }
        base.push(item);
    }
    base
}

fn load_remote_catalog(url: &str) -> Result<Vec<PluginManifest>, String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?
        .get(url)
        .send()
        .map_err(|e| format!("plugin.catalog.fetch_failed:{e}"))?;
    if !response.status().is_success() {
        return Err(format!("plugin.catalog.http:{}", response.status()));
    }
    let value: serde_json::Value = response.json().map_err(|e| e.to_string())?;
    let items = value
        .get("items")
        .cloned()
        .unwrap_or(value);
    serde_json::from_value::<Vec<PluginManifest>>(items).map_err(|e| e.to_string())
}

#[tauri::command]
pub fn plugin_marketplace_catalog(
    state: State<'_, AppState>,
    input: PluginCatalogInput,
) -> Result<PluginCatalogResponse, String> {
    state.log("INFO", "plugin_marketplace_catalog");
    let mut warnings = Vec::new();
    let mut items = built_in_catalog();
    if let Some(url) = input.catalog_url.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        match load_remote_catalog(url) {
            Ok(remote) => items = merge_catalog(items, remote),
            Err(error) => warnings.push(error),
        }
    }
    items.retain(|item| validate_manifest(item).is_ok());
    Ok(PluginCatalogResponse {
        schema: CATALOG_SCHEMA.to_string(),
        items,
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
    validate_manifest(&input.manifest)?;
    state.log("INFO", &format!("plugin_install: {}", input.manifest.id));
    let mut plugins = read_registry(&state.runtime_root)?;
    plugins.retain(|item| item.manifest.id != input.manifest.id);
    let installed = InstalledPlugin {
        manifest: input.manifest,
        enabled: true,
        installed_at: storage::now_iso(),
        source: "catalog".to_string(),
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
