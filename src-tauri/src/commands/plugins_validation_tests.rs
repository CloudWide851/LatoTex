use super::plugins::validate_manifest;
use crate::models::{PluginCommandRef, PluginContribution, PluginManifest, PluginToolchainInstaller, PluginToolchainProbe};

fn manifest_with_contribution(contribution: PluginContribution) -> PluginManifest {
    PluginManifest {
        schema: "latotex.plugin.v1".to_string(),
        id: "publisher.safe-plugin".to_string(),
        name: "Safe Plugin".to_string(),
        display_name: None,
        publisher: "Publisher".to_string(),
        version: "1.0.0".to_string(),
        description: "Safe plugin".to_string(),
        categories: vec!["Editor".to_string()],
        icon: None,
        download_url: None,
        sha256: None,
        homepage: None,
        repository: Some("https://example.com/repo".to_string()),
        license: Some("MIT".to_string()),
        keywords: Vec::new(),
        engines: None,
        activation_events: Vec::new(),
        capabilities: None,
        permissions: Vec::new(),
        contributions: vec![contribution],
    }
}

fn base_contribution(kind: &str) -> PluginContribution {
    PluginContribution {
        kind: kind.to_string(),
        id: "publisher.safe-plugin.action".to_string(),
        title: "Action".to_string(),
        description: None,
        command_ref: None,
        location: None,
        group: None,
        when: None,
        mcp_server: None,
        command: None,
        skill_id: None,
        toolchain_installer: None,
        toolchain_probe: None,
    }
}

#[test]
fn declarative_plugin_command_requires_safe_command_ref() {
    let mut contribution = base_contribution("toolbarButton");
    contribution.location = Some("docx.ribbon.file".to_string());
    contribution.command_ref = Some(PluginCommandRef {
        id: "shell.exec".to_string(),
        title: None,
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.command_ref_unsafe"));
}

#[test]
fn markdown_plugin_command_accepts_allowlisted_runner() {
    let mut contribution = base_contribution("markdownCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "markdown.runFence".to_string(),
        title: Some("Run code block".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn toolchain_installer_requires_https_and_hash() {
    let mut contribution = base_contribution("toolchainInstaller");
    contribution.toolchain_installer = Some(PluginToolchainInstaller {
        id: "cpp".to_string(),
        kind: "cpp".to_string(),
        platform: "windows-x64".to_string(),
        download_url: "http://example.com/compiler.zip".to_string(),
        sha256: "missing".to_string(),
        archive_format: "zip".to_string(),
        executable: "bin/clang++.exe".to_string(),
        version_arg: Some("--version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.toolchain_integrity"));
}

#[test]
fn go_toolchain_installer_is_allowed_when_integrity_is_declared() {
    let mut contribution = base_contribution("toolchainInstaller");
    contribution.toolchain_installer = Some(PluginToolchainInstaller {
        id: "go".to_string(),
        kind: "go".to_string(),
        platform: "windows-x64".to_string(),
        download_url: "https://example.com/go.zip".to_string(),
        sha256: "a".repeat(64),
        archive_format: "zip".to_string(),
        executable: "go/bin/go.exe".to_string(),
        version_arg: Some("version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn rust_toolchain_probe_is_allowed_without_installer() {
    let mut contribution = base_contribution("toolchainProbe");
    contribution.toolchain_probe = Some(PluginToolchainProbe {
        id: "rust".to_string(),
        kind: "rust".to_string(),
        platform: "windows-x64".to_string(),
        executables: vec!["rustc.exe".to_string(), "cargo.exe".to_string()],
        version_arg: Some("--version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn toolchain_probe_rejects_paths() {
    let mut contribution = base_contribution("toolchainProbe");
    contribution.toolchain_probe = Some(PluginToolchainProbe {
        id: "rust".to_string(),
        kind: "rust".to_string(),
        platform: "windows-x64".to_string(),
        executables: vec!["bin/rustc.exe".to_string()],
        version_arg: Some("--version".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.toolchain_probe_invalid"));
}

#[test]
fn declarative_plugin_command_accepts_allowlisted_command_ref() {
    let mut contribution = base_contribution("docxCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "docx.save".to_string(),
        title: Some("Save".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn analysis_plugin_command_accepts_allowlisted_command_ref() {
    let mut contribution = base_contribution("analysisCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "analysis.run".to_string(),
        title: Some("Run analysis".to_string()),
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(validation.ok, "{:?}", validation.issues);
}

#[test]
fn library_plugin_command_rejects_unsafe_command_ref() {
    let mut contribution = base_contribution("libraryCommand");
    contribution.command_ref = Some(PluginCommandRef {
        id: "network.fetch".to_string(),
        title: None,
    });
    let validation = validate_manifest(&manifest_with_contribution(contribution));
    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.command_ref_unsafe"));
}
