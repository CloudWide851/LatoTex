use super::{public_failure_code, TerminalShellSpec};
use crate::commands::agent_runtime::ready_runtime;
use crate::commands::agent_runtime_launch::{
    claude_interactive_args, claude_mcp_config, codex_interactive_args, write_runtime_config,
};
use crate::models::{TerminalLaunchKind, TerminalStartInput};
use crate::state::{AppState, TerminalResourceLease};
use crate::storage;
use std::path::Path;

fn runtime_id(kind: TerminalLaunchKind) -> Result<&'static str, String> {
    match kind {
        TerminalLaunchKind::CodexCli => Ok("codex-cli"),
        TerminalLaunchKind::ClaudeCodeCli => Ok("claude-code-cli"),
        TerminalLaunchKind::Shell => Err(public_failure_code(
            "terminal.failure.launch_kind_invalid",
            "resolve",
            false,
        )),
    }
}

pub(super) fn external_terminal_spec(
    state: &AppState,
    input: &TerminalStartInput,
    _project_root: &Path,
) -> Result<TerminalShellSpec, String> {
    let runtime_id = runtime_id(input.launch_kind)?;
    let runtime = ready_runtime(&state.db_path, runtime_id)
        .map_err(|failure| public_failure_code(&failure.code, &failure.stage, failure.retryable))?;
    let executable = runtime
        .executable_path
        .ok_or_else(|| public_failure_code("agent.runtime.not_found", "resolve", true))?;
    let profile = storage::get_agent_profile(&state.db_path, "builtin-researcher")?
        .or_else(|| {
            storage::list_agent_profiles(&state.db_path)
                .ok()?
                .into_iter()
                .next()
        })
        .ok_or_else(|| public_failure_code("agent.profile.not_found", "mcp", false))?;
    let tools = vec![
        "knowledge_search".to_string(),
        "knowledge_fetch".to_string(),
        "workspace_read".to_string(),
        "academic_search".to_string(),
        "citation_audit".to_string(),
        "submission_check".to_string(),
    ];
    let broker_address = crate::commands::agent_mcp_broker::ensure_running(
        &state.db_path,
        &state.runtime_root,
        &state.app_data_dir,
        &state.session_log_path,
    )
    .map_err(|_| public_failure_code("agent.runtime.mcp_failed", "mcp", true))?;
    let run_id = format!("terminal:{}", input.request_id);
    let (session, token) = storage::create_agent_mcp_terminal_session(
        &state.db_path,
        &run_id,
        &input.project_id,
        &profile,
        &tools,
    )
    .map_err(|_| public_failure_code("agent.runtime.mcp_failed", "mcp", true))?;
    let temp_dir = state
        .runtime_root
        .join("agent-mcp")
        .join("terminal")
        .join(&session.session_id);
    let lease = TerminalResourceLease {
        db_path: state.db_path.clone(),
        mcp_session_id: session.session_id,
        temp_dir: temp_dir.clone(),
    };
    let proxy_exe = std::env::current_exe()
        .map_err(|_| public_failure_code("agent.runtime.proxy_missing", "config", false))?;
    let args = match input.launch_kind {
        TerminalLaunchKind::CodexCli => codex_interactive_args(&proxy_exe),
        TerminalLaunchKind::ClaudeCodeCli => {
            let config_path = temp_dir.join("mcp.json");
            let payload = claude_mcp_config(&proxy_exe)
                .map_err(|_| public_failure_code("agent.runtime.config_failed", "config", false))?;
            write_runtime_config(&config_path, &payload)
                .map_err(|_| public_failure_code("agent.runtime.config_failed", "config", true))?;
            claude_interactive_args(&config_path)
        }
        TerminalLaunchKind::Shell => unreachable!("shell launch is handled by the terminal owner"),
    };
    Ok(TerminalShellSpec {
        shell: executable,
        args,
        env: vec![
            ("LATOTEX_MCP_BROKER_ADDR".to_string(), broker_address),
            ("LATOTEX_MCP_SESSION_TOKEN".to_string(), token),
        ],
        launch_kind: input.launch_kind,
        resource_lease: Some(lease),
    })
}
