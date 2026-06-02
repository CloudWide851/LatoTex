use super::downloads::{
    download_verified, ordered_download_urls, replace_dir_atomically, resolve_installed_file,
    safe_segment,
};
use super::plugins::read_registry;
use super::plugins_builtin::built_in_catalog;
use super::toolchains_local::{verify_local_toolchain, version_of};
use super::toolchains_register::register_local_blocking;
use crate::models::{
    PluginContribution, PluginManifest, PluginToolchainInstaller, PluginToolchainProbe,
    ToolchainActionInput, ToolchainInstallRecord, ToolchainLocalRegisterInput, ToolchainStatus,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use std::fs;
use std::io::Cursor;
use std::path::{Path, PathBuf};
use tauri::{async_runtime::spawn_blocking, State};
use zip::ZipArchive;

fn toolchain_root(runtime_root: &Path) -> PathBuf {
    runtime_root.join("toolchains")
}

fn registry_path(runtime_root: &Path) -> PathBuf {
    toolchain_root(runtime_root).join("registry.json")
}

pub(crate) fn read_toolchain_registry(
    runtime_root: &Path,
) -> Result<Vec<ToolchainInstallRecord>, String> {
    let path = registry_path(runtime_root);
    if !path.is_file() {
        return Ok(Vec::new());
    }
    let content = fs::read_to_string(path).map_err(|e| e.to_string())?;
    serde_json::from_str::<Vec<ToolchainInstallRecord>>(&content).map_err(|e| e.to_string())
}

pub(crate) fn write_toolchain_registry(
    runtime_root: &Path,
    records: &[ToolchainInstallRecord],
) -> Result<(), String> {
    let path = registry_path(runtime_root);
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        path,
        serde_json::to_string_pretty(records).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn status_from_record(record: &ToolchainInstallRecord) -> ToolchainStatus {
    let executable = PathBuf::from(&record.executable_path);
    let source = record
        .source
        .clone()
        .unwrap_or_else(|| "managed".to_string());
    ToolchainStatus {
        plugin_id: record.plugin_id.clone(),
        contribution_id: record.contribution_id.clone(),
        kind: record.installer.kind.clone(),
        installed: executable.is_file(),
        install_path: Some(record.root_dir.clone()),
        executable_path: Some(record.executable_path.clone()),
        version: record.version.clone(),
        message: if executable.is_file() {
            "toolchain.ready".to_string()
        } else {
            "toolchain.missing".to_string()
        },
        source: if executable.is_file() {
            source
        } else {
            "missing".to_string()
        },
    }
}

fn manifest_contributions(
    manifest: &PluginManifest,
) -> impl Iterator<Item = (&PluginManifest, &PluginContribution)> {
    manifest
        .contributions
        .iter()
        .map(move |item| (manifest, item))
}

pub(crate) fn toolchain_catalog(
    runtime_root: &Path,
) -> Result<Vec<(PluginManifest, PluginContribution)>, String> {
    let mut items = Vec::new();
    for entry in built_in_catalog() {
        for (_, contribution) in manifest_contributions(&entry.manifest) {
            if contribution.kind == "toolchainInstaller" {
                items.push((entry.manifest.clone(), contribution.clone()));
            } else if contribution.kind == "toolchainProbe" {
                items.push((entry.manifest.clone(), contribution.clone()));
            }
        }
    }
    for installed in read_registry(runtime_root)?
        .into_iter()
        .filter(|item| item.enabled)
    {
        for contribution in installed.manifest.contributions.iter() {
            if contribution.kind == "toolchainInstaller" {
                items.push((installed.manifest.clone(), contribution.clone()));
            } else if contribution.kind == "toolchainProbe" {
                items.push((installed.manifest.clone(), contribution.clone()));
            }
        }
    }
    Ok(items)
}

fn find_probe(
    runtime_root: &Path,
    plugin_id: &str,
    contribution_id: &str,
) -> Result<(PluginManifest, PluginContribution, PluginToolchainProbe), String> {
    for (manifest, contribution) in toolchain_catalog(runtime_root)? {
        if manifest.id == plugin_id && contribution.id == contribution_id {
            let probe = contribution
                .toolchain_probe
                .clone()
                .ok_or_else(|| "toolchain.probe_missing".to_string())?;
            if probe.platform != "windows-x64"
                || probe.executables.is_empty()
                || probe.executables.iter().any(|item| {
                    let trimmed = item.trim();
                    trimmed.is_empty()
                        || !trimmed.ends_with(".exe")
                        || !trimmed
                            .chars()
                            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
                })
            {
                return Err("toolchain.probe_unsafe".to_string());
            }
            return Ok((manifest, contribution, probe));
        }
    }
    Err("toolchain.not_found".to_string())
}

fn find_installer(
    runtime_root: &Path,
    plugin_id: &str,
    contribution_id: &str,
) -> Result<(PluginManifest, PluginContribution, PluginToolchainInstaller), String> {
    for (manifest, contribution) in toolchain_catalog(runtime_root)? {
        if manifest.id == plugin_id && contribution.id == contribution_id {
            let installer = contribution
                .toolchain_installer
                .clone()
                .ok_or_else(|| "toolchain.installer_missing".to_string())?;
            if installer.platform != "windows-x64"
                || installer.archive_format != "zip"
                || !installer.download_url.starts_with("https://")
                || installer.sha256.len() != 64
                || !installer.sha256.chars().all(|ch| ch.is_ascii_hexdigit())
            {
                return Err("toolchain.installer_unsafe".to_string());
            }
            return Ok((manifest, contribution, installer));
        }
    }
    Err("toolchain.not_found".to_string())
}

pub(crate) fn find_local_toolchain_executable(kind: &str) -> Option<PathBuf> {
    super::toolchains_local::find_local_toolchain_executable(kind)
}

pub(crate) fn find_local_toolchain_executable_from_names(names: &[&str]) -> Option<PathBuf> {
    super::toolchains_local::find_local_toolchain_executable_from_names(names)
}

fn verify_probe_blocking(
    runtime_root: &Path,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    let (_manifest, contribution, probe) =
        find_probe(runtime_root, &input.plugin_id, &input.contribution_id)?;
    let resolved: Vec<PathBuf> = probe
        .executables
        .iter()
        .filter_map(|name| {
            super::toolchains_local::find_local_toolchain_executable_from_names(&[name.as_str()])
        })
        .collect();
    let installed = resolved.len() == probe.executables.len();
    let version = resolved
        .first()
        .and_then(|path| version_of(path, probe.version_arg.as_deref()));
    Ok(ToolchainStatus {
        plugin_id: input.plugin_id,
        contribution_id: contribution.id,
        kind: probe.kind,
        installed,
        install_path: None,
        executable_path: resolved
            .first()
            .map(|path| path.to_string_lossy().to_string()),
        version,
        message: if installed {
            "toolchain.detected".to_string()
        } else {
            "toolchain.not_found_on_path".to_string()
        },
        source: if installed { "local" } else { "missing" }.to_string(),
    })
}

fn download_archive(
    runtime_root: &Path,
    installer: &PluginToolchainInstaller,
) -> Result<Vec<u8>, String> {
    download_verified(
        runtime_root,
        "toolchain",
        ordered_download_urls(
            &installer.download_url,
            installer.download_url_cn.as_deref(),
        ),
        &installer.sha256,
        180,
    )
}

fn extract_zip(bytes: &[u8], target_root: &Path) -> Result<(), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    fs::create_dir_all(target_root).map_err(|e| e.to_string())?;
    let canonical_root = target_root.canonicalize().map_err(|e| e.to_string())?;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let Some(enclosed) = file.enclosed_name().map(|path| path.to_path_buf()) else {
            return Err("toolchain.archive_path_unsafe".to_string());
        };
        let out_path = canonical_root.join(enclosed);
        if !out_path.starts_with(&canonical_root) {
            return Err("toolchain.archive_path_unsafe".to_string());
        }
        if file.is_dir() {
            fs::create_dir_all(&out_path).map_err(|e| e.to_string())?;
            continue;
        }
        if let Some(parent) = out_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        let mut out = fs::File::create(&out_path).map_err(|e| e.to_string())?;
        std::io::copy(&mut file, &mut out).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn install_blocking(
    runtime_root: &Path,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    let (_manifest, contribution, installer) =
        find_installer(runtime_root, &input.plugin_id, &input.contribution_id)?;
    let root = toolchain_root(runtime_root).join(safe_segment(&format!(
        "{}-{}",
        input.plugin_id, contribution.id
    )));
    let staging = root.with_file_name(format!(
        "{}.staging-{}",
        root.file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("toolchain"),
        storage::now_iso().replace([':', '.'], "-")
    ));
    if staging.exists() {
        fs::remove_dir_all(&staging).map_err(|e| e.to_string())?;
    }
    let bytes = download_archive(runtime_root, &installer)?;
    extract_zip(&bytes, &staging)?;
    let executable = resolve_installed_file(
        &staging,
        &installer.executable,
        "toolchain.executable_missing",
    )?;
    let version = version_of(&executable, installer.version_arg.as_deref());
    replace_dir_atomically(&staging, &root)?;
    let final_executable =
        resolve_installed_file(&root, &installer.executable, "toolchain.executable_missing")?;
    let mut records = read_toolchain_registry(runtime_root)?;
    records.retain(|item| {
        item.plugin_id != input.plugin_id || item.contribution_id != input.contribution_id
    });
    let record = ToolchainInstallRecord {
        plugin_id: input.plugin_id,
        contribution_id: contribution.id,
        installer,
        installed_at: storage::now_iso(),
        root_dir: root.to_string_lossy().to_string(),
        executable_path: final_executable.to_string_lossy().to_string(),
        version,
        source: Some("managed".to_string()),
    };
    records.push(record.clone());
    write_toolchain_registry(runtime_root, &records)?;
    Ok(status_from_record(&record))
}

fn verify_blocking(
    runtime_root: &Path,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    let records = read_toolchain_registry(runtime_root)?;
    let Some(record) = records.iter().find(|item| {
        item.plugin_id == input.plugin_id && item.contribution_id == input.contribution_id
    }) else {
        if let Ok(status) = verify_probe_blocking(
            runtime_root,
            ToolchainActionInput {
                plugin_id: input.plugin_id.clone(),
                contribution_id: input.contribution_id.clone(),
            },
        ) {
            return Ok(status);
        }
        let (_manifest, contribution, installer) =
            find_installer(runtime_root, &input.plugin_id, &input.contribution_id)?;
        if let Some(status) = verify_local_toolchain(
            input.plugin_id.clone(),
            contribution.id.clone(),
            installer.kind.clone(),
            installer.version_arg.as_deref(),
        ) {
            return Ok(status);
        }
        return Ok(ToolchainStatus {
            plugin_id: input.plugin_id,
            contribution_id: contribution.id,
            kind: installer.kind,
            installed: false,
            install_path: None,
            executable_path: None,
            version: None,
            message: "toolchain.not_installed".to_string(),
            source: "missing".to_string(),
        });
    };
    Ok(status_from_record(record))
}

fn remove_blocking(
    runtime_root: &Path,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    let mut records = read_toolchain_registry(runtime_root)?;
    let Some(index) = records.iter().position(|item| {
        item.plugin_id == input.plugin_id && item.contribution_id == input.contribution_id
    }) else {
        return verify_blocking(runtime_root, input);
    };
    let record = records.remove(index);
    let root = PathBuf::from(&record.root_dir);
    let source = record.source.as_deref().unwrap_or("managed");
    if source == "managed" && root.starts_with(toolchain_root(runtime_root)) && root.exists() {
        fs::remove_dir_all(root).map_err(|e| e.to_string())?;
    }
    write_toolchain_registry(runtime_root, &records)?;
    Ok(ToolchainStatus {
        plugin_id: record.plugin_id,
        contribution_id: record.contribution_id,
        kind: record.installer.kind,
        installed: false,
        install_path: None,
        executable_path: None,
        version: None,
        message: "toolchain.removed".to_string(),
        source: "missing".to_string(),
    })
}

pub(crate) fn find_managed_toolchain_executable(
    kinds: &[&str],
    names: &[&str],
    runtime_root: &Path,
) -> Option<PathBuf> {
    let records = read_toolchain_registry(runtime_root).ok()?;
    for record in records {
        if !kinds.iter().any(|kind| *kind == record.installer.kind) {
            continue;
        }
        let executable = PathBuf::from(&record.executable_path);
        if executable.is_file() {
            return Some(executable);
        }
        let root = PathBuf::from(&record.root_dir);
        for name in names {
            let candidate = root.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

#[tauri::command]
pub async fn toolchain_list(state: State<'_, AppState>) -> Result<Vec<ToolchainStatus>, String> {
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || {
        let records = read_toolchain_registry(&runtime_root)?;
        let mut output = Vec::new();
        for record in &records {
            output.push(status_from_record(record));
        }
        for (manifest, contribution) in toolchain_catalog(&runtime_root)? {
            if output.iter().any(|item: &ToolchainStatus| {
                item.plugin_id == manifest.id && item.contribution_id == contribution.id
            }) {
                continue;
            }
            let input = ToolchainActionInput {
                plugin_id: manifest.id,
                contribution_id: contribution.id,
            };
            if let Ok(status) = verify_blocking(&runtime_root, input) {
                output.push(status);
            }
        }
        Ok(output)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn toolchain_pick_directory(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.log("INFO", "toolchain_pick_directory");
    Ok(FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn toolchain_register_local(
    state: State<'_, AppState>,
    input: ToolchainLocalRegisterInput,
) -> Result<ToolchainStatus, String> {
    state.log(
        "INFO",
        &format!(
            "toolchain_register_local: {}:{}",
            input.plugin_id, input.contribution_id
        ),
    );
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || register_local_blocking(&runtime_root, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toolchain_install(
    state: State<'_, AppState>,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    state.log(
        "INFO",
        &format!(
            "toolchain_install: {}:{}",
            input.plugin_id, input.contribution_id
        ),
    );
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || install_blocking(&runtime_root, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toolchain_verify(
    state: State<'_, AppState>,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || verify_blocking(&runtime_root, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn toolchain_remove(
    state: State<'_, AppState>,
    input: ToolchainActionInput,
) -> Result<ToolchainStatus, String> {
    state.log(
        "INFO",
        &format!(
            "toolchain_remove: {}:{}",
            input.plugin_id, input.contribution_id
        ),
    );
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || remove_blocking(&runtime_root, input))
        .await
        .map_err(|e| e.to_string())?
}
