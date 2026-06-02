use super::toolchains::{read_toolchain_registry, toolchain_catalog, write_toolchain_registry};
use super::toolchains_local::{local_toolchain_candidates, resolve_executable_in_root, version_of};
use crate::models::{
    PluginContribution, PluginToolchainInstaller, ToolchainInstallRecord,
    ToolchainLocalRegisterInput, ToolchainStatus,
};
use crate::storage;
use std::path::{Path, PathBuf};

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

fn contribution_toolchain_metadata(
    runtime_root: &Path,
    plugin_id: &str,
    contribution_id: &str,
) -> Result<
    (
        PluginContribution,
        PluginToolchainInstaller,
        Vec<String>,
        Option<String>,
    ),
    String,
> {
    for (manifest, contribution) in toolchain_catalog(runtime_root)? {
        if manifest.id != plugin_id || contribution.id != contribution_id {
            continue;
        }
        if let Some(installer) = contribution.toolchain_installer.clone() {
            let executable = installer
                .executable
                .rsplit(['/', '\\'])
                .next()
                .unwrap_or(&installer.executable)
                .to_string();
            return Ok((
                contribution,
                installer.clone(),
                vec![executable],
                installer.version_arg.clone(),
            ));
        }
        if let Some(probe) = contribution.toolchain_probe.clone() {
            let installer = PluginToolchainInstaller {
                id: probe.id.clone(),
                kind: probe.kind.clone(),
                platform: probe.platform.clone(),
                download_url: String::new(),
                download_url_cn: None,
                sha256: String::new(),
                archive_format: "local".to_string(),
                executable: probe.executables.first().cloned().unwrap_or_default(),
                version_arg: probe.version_arg.clone(),
            };
            return Ok((
                contribution,
                installer,
                probe.executables,
                probe.version_arg,
            ));
        }
    }
    Err(format!("toolchain.not_found:{plugin_id}:{contribution_id}"))
}

pub(crate) fn register_local_blocking(
    runtime_root: &Path,
    input: ToolchainLocalRegisterInput,
) -> Result<ToolchainStatus, String> {
    let root = PathBuf::from(input.root_dir.trim());
    if !root.is_dir() {
        return Err("toolchain.local_root_missing".to_string());
    }
    let (contribution, installer, expected, version_arg) =
        contribution_toolchain_metadata(runtime_root, &input.plugin_id, &input.contribution_id)?;
    let require_all = contribution.kind == "toolchainProbe" && !expected.is_empty();
    let candidate_names = if expected.is_empty() {
        local_toolchain_candidates(&installer.kind)
            .iter()
            .map(|item| item.to_string())
            .collect::<Vec<_>>()
    } else {
        expected
    };
    let executable = if require_all {
        let resolved = candidate_names
            .iter()
            .filter_map(|name| resolve_executable_in_root(&root, &[name.clone()]))
            .collect::<Vec<_>>();
        if resolved.len() != candidate_names.len() {
            return Err("toolchain.local_executable_missing".to_string());
        }
        resolved
            .first()
            .cloned()
            .ok_or_else(|| "toolchain.local_executable_missing".to_string())?
    } else {
        resolve_executable_in_root(&root, &candidate_names)
            .ok_or_else(|| "toolchain.local_executable_missing".to_string())?
    };
    let version = version_of(&executable, version_arg.as_deref());
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
        executable_path: executable.to_string_lossy().to_string(),
        version,
        source: Some("local".to_string()),
    };
    records.push(record.clone());
    write_toolchain_registry(runtime_root, &records)?;
    Ok(status_from_record(&record))
}
