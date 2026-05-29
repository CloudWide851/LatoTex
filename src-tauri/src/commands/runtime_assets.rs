use super::plugins::read_registry;
use super::plugins_builtin::built_in_catalog;
use crate::models::{
    PluginContribution, PluginManifest, PluginRuntimeAsset, RuntimeAssetActionInput,
    RuntimeAssetInstallRecord, RuntimeAssetStatus,
};
use crate::state::AppState;
use crate::storage;
use ring::digest::{digest, SHA256};
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{async_runtime::spawn_blocking, State};
use zip::ZipArchive;

fn asset_root(runtime_root: &Path) -> PathBuf {
    runtime_root.join("runtime-assets")
}

fn registry_path(runtime_root: &Path) -> PathBuf {
    asset_root(runtime_root).join("registry.json")
}

fn safe_segment(value: &str) -> String {
    value.chars().map(|ch| {
        if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') { ch } else { '-' }
    }).collect()
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

fn read_runtime_asset_registry(runtime_root: &Path) -> Result<Vec<RuntimeAssetInstallRecord>, String> {
    let path = registry_path(runtime_root);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Vec<RuntimeAssetInstallRecord>>(&content).map_err(|e| e.to_string())
}

fn write_runtime_asset_registry(runtime_root: &Path, records: &[RuntimeAssetInstallRecord]) -> Result<(), String> {
    let path = registry_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(path, serde_json::to_string_pretty(records).map_err(|e| e.to_string())?).map_err(|e| e.to_string())
}

fn status_from_record(record: &RuntimeAssetInstallRecord) -> RuntimeAssetStatus {
    let entry = PathBuf::from(&record.entry_path);
    RuntimeAssetStatus {
        plugin_id: record.plugin_id.clone(),
        contribution_id: record.contribution_id.clone(),
        kind: record.asset.kind.clone(),
        installed: entry.is_file(),
        install_path: Some(record.root_dir.clone()),
        entry_path: Some(record.entry_path.clone()),
        message: if entry.is_file() { "runtimeAsset.ready" } else { "runtimeAsset.missing" }.to_string(),
    }
}

fn asset_catalog(runtime_root: &Path) -> Result<Vec<(PluginManifest, PluginContribution)>, String> {
    let mut items = Vec::new();
    for entry in built_in_catalog() {
        for contribution in entry.manifest.contributions.iter().filter(|item| item.kind == "runtimeAsset") {
            items.push((entry.manifest.clone(), contribution.clone()));
        }
    }
    for installed in read_registry(runtime_root)?.into_iter().filter(|item| item.enabled) {
        for contribution in installed.manifest.contributions.iter().filter(|item| item.kind == "runtimeAsset") {
            items.push((installed.manifest.clone(), contribution.clone()));
        }
    }
    Ok(items)
}

fn find_asset(runtime_root: &Path, plugin_id: &str, contribution_id: &str) -> Result<(PluginContribution, PluginRuntimeAsset), String> {
    for (manifest, contribution) in asset_catalog(runtime_root)? {
        if manifest.id == plugin_id && contribution.id == contribution_id {
            let asset = contribution.runtime_asset.clone().ok_or_else(|| "runtimeAsset.asset_missing".to_string())?;
            if asset.platform != "windows-x64"
                || !matches!(asset.archive_format.as_str(), "zip" | "exe")
                || !asset.download_url.starts_with("https://")
                || asset.sha256.len() != 64
                || !asset.sha256.chars().all(|ch| ch.is_ascii_hexdigit())
            {
                return Err("runtimeAsset.asset_unsafe".to_string());
            }
            return Ok((contribution, asset));
        }
    }
    Err("runtimeAsset.not_found".to_string())
}

fn prefer_cn_source() -> bool {
    std::env::var("LANG").or_else(|_| std::env::var("LC_ALL")).unwrap_or_default().to_ascii_lowercase().starts_with("zh")
}

fn download_url(asset: &PluginRuntimeAsset) -> String {
    if prefer_cn_source() {
        if let Some(url) = asset.download_url_cn.as_deref().map(str::trim).filter(|item| !item.is_empty()) {
            return url.to_string();
        }
    }
    asset.download_url.trim().to_string()
}

fn download_asset(asset: &PluginRuntimeAsset) -> Result<Vec<u8>, String> {
    let response = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(180))
        .build()
        .map_err(|e| e.to_string())?
        .get(download_url(asset))
        .send()
        .map_err(|e| format!("runtimeAsset.download_failed: {e}"))?;
    if !response.status().is_success() {
        return Err(format!("runtimeAsset.download_http: {}", response.status()));
    }
    let bytes = response.bytes().map_err(|e| e.to_string())?.to_vec();
    let actual = hex_digest(digest(&SHA256, &bytes).as_ref());
    if !actual.eq_ignore_ascii_case(&asset.sha256) {
        return Err("runtimeAsset.sha256_mismatch".to_string());
    }
    Ok(bytes)
}

fn extract_zip(bytes: &[u8], target_root: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    fs::create_dir_all(target_root).map_err(|e| e.to_string())?;
    let canonical_root = target_root.canonicalize().map_err(|e| e.to_string())?;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            return Err("runtimeAsset.archive_path_unsafe".to_string());
        };
        let out_path = canonical_root.join(enclosed);
        if !out_path.starts_with(&canonical_root) {
            return Err("runtimeAsset.archive_path_unsafe".to_string());
        }
        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
        } else {
            if let Some(parent) = out_path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
            std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
        }
    }
    Ok(())
}

fn install_blocking(runtime_root: &Path, input: RuntimeAssetActionInput) -> Result<RuntimeAssetStatus, String> {
    let (contribution, asset) = find_asset(runtime_root, &input.plugin_id, &input.contribution_id)?;
    let root = asset_root(runtime_root).join(safe_segment(&format!("{}-{}", input.plugin_id, contribution.id)));
    let entry = root.join(&asset.entry_path);
    let bytes = download_asset(&asset)?;
    if root.exists() {
        fs::remove_dir_all(&root).map_err(|e| e.to_string())?;
    }
    if asset.archive_format == "exe" {
        if let Some(parent) = entry.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(&entry, bytes).map_err(|e| e.to_string())?;
    } else {
        extract_zip(&bytes, &root)?;
    }
    if !entry.is_file() {
        return Err("runtimeAsset.entry_missing".to_string());
    }
    let mut records = read_runtime_asset_registry(runtime_root)?;
    records.retain(|item| item.plugin_id != input.plugin_id || item.contribution_id != input.contribution_id);
    let record = RuntimeAssetInstallRecord {
        plugin_id: input.plugin_id,
        contribution_id: contribution.id,
        asset,
        installed_at: storage::now_iso(),
        root_dir: root.to_string_lossy().to_string(),
        entry_path: entry.to_string_lossy().to_string(),
    };
    records.push(record.clone());
    write_runtime_asset_registry(runtime_root, &records)?;
    Ok(status_from_record(&record))
}

fn verify_blocking(runtime_root: &Path, input: RuntimeAssetActionInput) -> Result<RuntimeAssetStatus, String> {
    let records = read_runtime_asset_registry(runtime_root)?;
    if let Some(record) = records.iter().find(|item| item.plugin_id == input.plugin_id && item.contribution_id == input.contribution_id) {
        return Ok(status_from_record(record));
    }
    let (contribution, asset) = find_asset(runtime_root, &input.plugin_id, &input.contribution_id)?;
    Ok(RuntimeAssetStatus {
        plugin_id: input.plugin_id,
        contribution_id: contribution.id,
        kind: asset.kind,
        installed: false,
        install_path: None,
        entry_path: None,
        message: "runtimeAsset.not_installed".to_string(),
    })
}

fn remove_blocking(runtime_root: &Path, input: RuntimeAssetActionInput) -> Result<RuntimeAssetStatus, String> {
    let mut records = read_runtime_asset_registry(runtime_root)?;
    let Some(index) = records.iter().position(|item| item.plugin_id == input.plugin_id && item.contribution_id == input.contribution_id) else {
        return verify_blocking(runtime_root, input);
    };
    let record = records.remove(index);
    let root = PathBuf::from(&record.root_dir);
    if root.starts_with(asset_root(runtime_root)) && root.exists() {
        fs::remove_dir_all(root).map_err(|e| e.to_string())?;
    }
    write_runtime_asset_registry(runtime_root, &records)?;
    Ok(RuntimeAssetStatus {
        plugin_id: record.plugin_id,
        contribution_id: record.contribution_id,
        kind: record.asset.kind,
        installed: false,
        install_path: None,
        entry_path: None,
        message: "runtimeAsset.removed".to_string(),
    })
}

pub(crate) fn find_runtime_asset_entry(runtime_root: &Path, kind: &str) -> Option<PathBuf> {
    read_runtime_asset_registry(runtime_root).ok()?.into_iter().find_map(|record| {
        if record.asset.kind == kind {
            let path = PathBuf::from(record.entry_path);
            if path.is_file() {
                return Some(path);
            }
        }
        None
    })
}

pub(crate) fn find_runtime_asset_root(runtime_root: &Path, kind: &str) -> Option<PathBuf> {
    read_runtime_asset_registry(runtime_root).ok()?.into_iter().find_map(|record| {
        if record.asset.kind == kind {
            let root = PathBuf::from(record.root_dir);
            let entry = PathBuf::from(record.entry_path);
            if root.is_dir() && entry.is_file() && entry.starts_with(&root) {
                return Some(root);
            }
        }
        None
    })
}

#[tauri::command]
pub async fn runtime_asset_list(state: State<'_, AppState>) -> Result<Vec<RuntimeAssetStatus>, String> {
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || Ok(read_runtime_asset_registry(&runtime_root)?.iter().map(status_from_record).collect()))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn runtime_asset_install(state: State<'_, AppState>, input: RuntimeAssetActionInput) -> Result<RuntimeAssetStatus, String> {
    state.log("INFO", &format!("runtime_asset_install: {}:{}", input.plugin_id, input.contribution_id));
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || install_blocking(&runtime_root, input)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn runtime_asset_verify(state: State<'_, AppState>, input: RuntimeAssetActionInput) -> Result<RuntimeAssetStatus, String> {
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || verify_blocking(&runtime_root, input)).await.map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn runtime_asset_remove(state: State<'_, AppState>, input: RuntimeAssetActionInput) -> Result<RuntimeAssetStatus, String> {
    state.log("INFO", &format!("runtime_asset_remove: {}:{}", input.plugin_id, input.contribution_id));
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || remove_blocking(&runtime_root, input)).await.map_err(|e| e.to_string())?
}
