use super::plugins_builtin::{empty_contribution, entry};
use super::plugins_builtin_science::{localize_contribution, science_manifest};
use crate::models::{
    PluginAgentRuntimeDetector, PluginCatalogEntry, PluginContribution, PluginManifest,
};

fn runtime_contribution(
    kind: &str,
    contribution_id: &str,
    runtime_id: &str,
    executable: &str,
    version_args: &[&str],
    auth_args: &[&str],
    names: [(&str, &str); 4],
) -> PluginContribution {
    let mut contribution = empty_contribution(kind, contribution_id, names[0].0);
    contribution.agent_runtime_detector = Some(PluginAgentRuntimeDetector {
        runtime_id: runtime_id.to_string(),
        executable: executable.to_string(),
        version_args: version_args
            .iter()
            .map(|value| (*value).to_string())
            .collect(),
        auth_args: auth_args.iter().map(|value| (*value).to_string()).collect(),
    });
    localize_contribution(contribution, names[0], names[1], names[2], names[3])
}

#[allow(clippy::too_many_arguments)]
fn runtime_manifest(
    id: &str,
    runtime_id: &str,
    executable: &str,
    version_args: &[&str],
    auth_args: &[&str],
    en: (&str, &str, &[&str]),
    zh: (&str, &str, &[&str]),
    es: (&str, &str, &[&str]),
    ja: (&str, &str, &[&str]),
) -> PluginManifest {
    let names = [
        (
            "Agent runtime",
            "Use the detected official CLI as a managed LatoTex Agent executor.",
        ),
        (
            "Agent 执行器",
            "将检测到的官方 CLI 用作受控的 LatoTex Agent 执行器。",
        ),
        (
            "Runtime de Agent",
            "Usa el CLI oficial detectado como ejecutor administrado de LatoTex.",
        ),
        (
            "Agent ランタイム",
            "検出済み公式 CLI を管理対象 LatoTex Agent として使用します。",
        ),
    ];
    science_manifest(
        id,
        en,
        zh,
        es,
        ja,
        "full",
        "local",
        "local-probe",
        "vendor-controlled",
        "Vendor CLI; user-installed",
        &["workspace.read", "process.spawn", "mcp"],
        &["agent", "research", "cli", runtime_id],
        vec![
            runtime_contribution(
                "agentRuntime",
                &format!("{runtime_id}.runtime"),
                runtime_id,
                executable,
                version_args,
                auth_args,
                names,
            ),
            runtime_contribution(
                "agentRuntimeDetector",
                &format!("{runtime_id}.detector"),
                runtime_id,
                executable,
                version_args,
                auth_args,
                [
                    (
                        "Detect official CLI",
                        "Verify the canonical executable, version, and current login state.",
                    ),
                    ("检测官方 CLI", "验证规范可执行文件、版本和当前登录状态。"),
                    (
                        "Detectar CLI oficial",
                        "Verifica el ejecutable canónico, versión y sesión actual.",
                    ),
                    (
                        "公式 CLI を検出",
                        "正規実行ファイル、バージョン、ログイン状態を検証します。",
                    ),
                ],
            ),
        ],
    )
}

fn agent_runtime_manifests() -> Vec<PluginManifest> {
    vec![
        runtime_manifest(
            "latotex.agent.codex-cli",
            "codex-cli",
            "codex.exe",
            &["--version"],
            &["login", "status"],
            (
                "Codex CLI Agent",
                "Run research workflows through an existing signed-in Codex CLI with LatoTex MCP tools.",
                &["Research", "Agent"],
            ),
            (
                "Codex CLI Agent",
                "通过已登录的 Codex CLI 和 LatoTex MCP 工具运行科研工作流。",
                &["科研", "Agent"],
            ),
            (
                "Agent Codex CLI",
                "Ejecuta flujos científicos con Codex CLI y herramientas MCP de LatoTex.",
                &["Investigación", "Agent"],
            ),
            (
                "Codex CLI Agent",
                "ログイン済み Codex CLI と LatoTex MCP で研究ワークフローを実行します。",
                &["研究", "Agent"],
            ),
        ),
        runtime_manifest(
            "latotex.agent.claude-code-cli",
            "claude-code-cli",
            "claude.exe",
            &["--version"],
            &["auth", "status"],
            (
                "Claude Code Agent",
                "Run research workflows through an existing signed-in Claude Code CLI with LatoTex MCP tools.",
                &["Research", "Agent"],
            ),
            (
                "Claude Code Agent",
                "通过已登录的 Claude Code CLI 和 LatoTex MCP 工具运行科研工作流。",
                &["科研", "Agent"],
            ),
            (
                "Agent Claude Code",
                "Ejecuta flujos científicos con Claude Code y herramientas MCP de LatoTex.",
                &["Investigación", "Agent"],
            ),
            (
                "Claude Code Agent",
                "ログイン済み Claude Code CLI と LatoTex MCP で研究ワークフローを実行します。",
                &["研究", "Agent"],
            ),
        ),
    ]
}

pub(super) fn agent_runtime_catalog() -> Vec<PluginCatalogEntry> {
    agent_runtime_manifests().into_iter().map(entry).collect()
}

pub(super) fn is_trusted_agent_runtime_manifest(manifest: &PluginManifest) -> bool {
    let Ok(candidate) = serde_json::to_value(manifest) else {
        return false;
    };
    agent_runtime_manifests().into_iter().any(|manifest| {
        serde_json::to_value(manifest)
            .map(|trusted| trusted == candidate)
            .unwrap_or(false)
    })
}
