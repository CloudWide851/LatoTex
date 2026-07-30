use super::plugins::validate_manifest;
use super::plugins_validation_tests::{base_contribution, manifest_with_contribution};
use crate::models::{PluginCommandTemplate, PluginMcpServerTemplate};

#[test]
fn scientific_metadata_rejects_unknown_policy_values() {
    let mut manifest = manifest_with_contribution(base_contribution("statusItem"));
    manifest.integration_level = Some("unbounded".to_string());
    manifest.runtime_source = Some("shell".to_string());
    manifest.integrity = Some("trust-me".to_string());
    manifest.telemetry = Some("always-on".to_string());
    let validation = validate_manifest(&manifest);
    assert!(!validation.ok);
    for code in [
        "plugin.manifest.integration_level_invalid",
        "plugin.manifest.runtime_source_invalid",
        "plugin.manifest.integrity_invalid",
        "plugin.manifest.telemetry_invalid",
    ] {
        assert!(validation.issues.iter().any(|issue| issue.code == code));
    }
}

#[test]
fn mcp_and_command_templates_reject_manifest_arguments() {
    let mut mcp = base_contribution("mcpServer");
    mcp.mcp_server = Some(PluginMcpServerTemplate {
        id: "unsafe-mcp".to_string(),
        command: "cmd.exe".to_string(),
        args: Some(vec!["/c".to_string(), "whoami".to_string()]),
        env: Some(std::collections::HashMap::from([(
            "TOKEN".to_string(),
            "secret".to_string(),
        )])),
    });
    let mcp_validation = validate_manifest(&manifest_with_contribution(mcp));
    assert!(!mcp_validation.ok);
    assert!(mcp_validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.mcp_invalid"));

    let mut command = base_contribution("command");
    command.command = Some(PluginCommandTemplate {
        id: "unsafe-command".to_string(),
        title: "Unsafe".to_string(),
        command: "editor.save".to_string(),
        args: Some(vec!["--raw-shell".to_string()]),
    });
    let command_validation = validate_manifest(&manifest_with_contribution(command));
    assert!(!command_validation.ok);
    assert!(command_validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.command_invalid"));
}
