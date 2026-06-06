use crate::models::{
    PluginRuntimeAsset, PluginToolchainInstaller, PluginToolchainProbe, PluginValidationIssue,
};

use super::plugins_policy::{
    INSTALLER_TOOLCHAIN_KINDS, PROBE_TOOLCHAIN_KINDS, RUNTIME_ASSET_KINDS,
};

fn issue(code: &str, message: &str) -> PluginValidationIssue {
    PluginValidationIssue {
        code: code.to_string(),
        severity: "error".to_string(),
        message: message.to_string(),
        params: None,
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

fn is_https_url(value: &str) -> bool {
    value.trim().starts_with("https://")
}

fn is_sha256(value: &str) -> bool {
    value.len() == 64 && value.chars().all(|ch| ch.is_ascii_hexdigit())
}

pub(crate) fn validate_toolchain_installer(
    installer: Option<&PluginToolchainInstaller>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(installer) = installer else {
        issues.push(issue(
            "plugin.contribution.toolchain_missing",
            "Toolchain installer contributions must declare toolchainInstaller.",
        ));
        return;
    };
    let allowed_archives = std::collections::HashSet::from(["zip"]);
    if !validate_identifier(&installer.id, 96)
        || !INSTALLER_TOOLCHAIN_KINDS.contains(&installer.kind.as_str())
        || installer.platform != "windows-x64"
        || !allowed_archives.contains(installer.archive_format.as_str())
        || installer.executable.trim().is_empty()
    {
        issues.push(issue(
            "plugin.contribution.toolchain_invalid",
            "Toolchain installer must target a supported Windows x64 portable toolchain.",
        ));
    }
    if !is_https_url(&installer.download_url) || !is_sha256(&installer.sha256) {
        issues.push(issue(
            "plugin.contribution.toolchain_integrity",
            "Toolchain installer downloads require HTTPS and a SHA-256 hash.",
        ));
    }
    if let Some(url) = installer
        .download_url_cn
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !is_https_url(url) {
            issues.push(issue(
                "plugin.contribution.toolchain_cn_url",
                "Domestic mirror URL must use HTTPS.",
            ));
        }
    }
}

pub(crate) fn validate_toolchain_probe(
    probe: Option<&PluginToolchainProbe>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(probe) = probe else {
        issues.push(issue(
            "plugin.contribution.toolchain_probe_missing",
            "Toolchain probe contributions must declare toolchainProbe.",
        ));
        return;
    };
    if !validate_identifier(&probe.id, 96)
        || !PROBE_TOOLCHAIN_KINDS.contains(&probe.kind.as_str())
        || probe.platform != "windows-x64"
        || probe.executables.is_empty()
        || probe.executables.len() > 4
        || probe.executables.iter().any(|item| {
            let trimmed = item.trim();
            trimmed.is_empty()
                || !trimmed.ends_with(".exe")
                || !trimmed
                    .chars()
                    .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
        })
    {
        issues.push(issue(
            "plugin.contribution.toolchain_probe_invalid",
            "Toolchain probe must target supported Windows x64 executables by filename only.",
        ));
    }
}

pub(crate) fn validate_runtime_asset(
    asset: Option<&PluginRuntimeAsset>,
    issues: &mut Vec<PluginValidationIssue>,
) {
    let Some(asset) = asset else {
        issues.push(issue(
            "plugin.contribution.runtime_asset_missing",
            "Runtime asset contributions must declare runtimeAsset.",
        ));
        return;
    };
    let allowed_archives = std::collections::HashSet::from(["zip", "exe"]);
    if !validate_identifier(&asset.id, 96)
        || !RUNTIME_ASSET_KINDS.contains(&asset.kind.as_str())
        || asset.platform != "windows-x64"
        || !allowed_archives.contains(asset.archive_format.as_str())
        || asset.entry_path.trim().is_empty()
    {
        issues.push(issue(
            "plugin.contribution.runtime_asset_invalid",
            "Runtime asset must target a supported Windows x64 resource package.",
        ));
    }
    if !is_https_url(&asset.download_url) || !is_sha256(&asset.sha256) {
        issues.push(issue(
            "plugin.contribution.runtime_asset_integrity",
            "Runtime asset downloads require HTTPS and a SHA-256 hash.",
        ));
    }
    if let Some(url) = asset
        .download_url_cn
        .as_deref()
        .map(str::trim)
        .filter(|item| !item.is_empty())
    {
        if !is_https_url(url) {
            issues.push(issue(
                "plugin.contribution.runtime_asset_cn_url",
                "Domestic runtime asset mirror URL must use HTTPS.",
            ));
        }
    }
}
