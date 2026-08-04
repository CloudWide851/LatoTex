use super::plugins::validate_manifest;
use super::plugins_validation_tests::{base_contribution, manifest_with_contribution};
use crate::models::PluginAgentRuntimeDetector;

#[test]
fn custom_manifest_cannot_impersonate_a_trusted_agent_runtime() {
    let mut contribution = base_contribution("agentRuntime");
    contribution.agent_runtime_detector = Some(PluginAgentRuntimeDetector {
        runtime_id: "codex-cli".to_string(),
        executable: "codex.exe".to_string(),
        version_args: vec!["--version".to_string()],
        auth_args: vec!["login".to_string(), "status".to_string()],
    });
    let mut manifest = manifest_with_contribution(contribution);
    manifest.id = "latotex.agent.codex-cli".to_string();

    let validation = validate_manifest(&manifest);

    assert!(!validation.ok);
    assert!(validation
        .issues
        .iter()
        .any(|issue| issue.code == "plugin.contribution.agent_runtime_untrusted"));
}
