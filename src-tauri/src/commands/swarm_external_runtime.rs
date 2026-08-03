use crate::logging::sanitize_log_message_with_limit;
use crate::models::{AgentProfile, ExternalAgentFailure};
use crate::storage;
use serde_json::Value;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{mpsc, Arc};
use std::thread;
use std::time::{Duration, Instant};

use crate::commands::agent_runtime::ready_runtime;
use crate::commands::agent_runtime_launch::{
    claude_managed_args, claude_mcp_config, codex_managed_args, write_runtime_config,
};

const OUTPUT_LIMIT: usize = 4 * 1024 * 1024;
const LINE_LIMIT: usize = 256 * 1024;

#[derive(Debug)]
pub(super) struct ExternalRunError {
    pub(super) failure: ExternalAgentFailure,
    pub(super) output_started: bool,
}

enum ProcessMessage {
    Stdout(String),
    Stderr(String),
    StreamClosed,
}

fn external_failure(
    code: &str,
    stage: &str,
    retryable: bool,
    diagnostics: impl IntoIterator<Item = String>,
) -> ExternalAgentFailure {
    ExternalAgentFailure {
        code: code.to_string(),
        stage: stage.to_string(),
        retryable,
        diagnostics: diagnostics
            .into_iter()
            .map(|value| sanitize_log_message_with_limit(&value, 512))
            .filter(|value| !value.is_empty())
            .take(4)
            .collect(),
    }
}

fn allowed_mcp_tools(profile: &AgentProfile) -> Vec<String> {
    let mut tools = Vec::new();
    let workspace_allowed = profile
        .tool_ids
        .iter()
        .any(|tool| matches!(tool.as_str(), "workspace" | "mcp"));
    let web_allowed = profile
        .tool_ids
        .iter()
        .any(|tool| matches!(tool.as_str(), "web" | "mcp"));
    if workspace_allowed {
        tools.extend([
            "knowledge_search".to_string(),
            "knowledge_fetch".to_string(),
            "workspace_read".to_string(),
            "citation_audit".to_string(),
            "submission_check".to_string(),
        ]);
    }
    if web_allowed {
        tools.push("academic_search".to_string());
    }
    if profile.tool_ids.iter().any(|tool| tool == "python") {
        tools.push("data_analysis".to_string());
    }
    tools
}

#[cfg(windows)]
fn configure_process_group(command: &mut Command) {
    use std::os::windows::process::CommandExt;
    command.creation_flags(0x0000_0200 | 0x0800_0000);
}

#[cfg(not(windows))]
fn configure_process_group(_command: &mut Command) {}

fn terminate_process_tree(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
    let _ = child.wait();
}

fn spawn_reader<R: Read + Send + 'static>(
    reader: R,
    stderr: bool,
    tx: mpsc::Sender<ProcessMessage>,
) {
    thread::spawn(move || {
        let mut reader = BufReader::new(reader);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    if line.len() > LINE_LIMIT {
                        let boundary = line
                            .char_indices()
                            .take_while(|(index, _)| *index <= LINE_LIMIT)
                            .map(|(index, _)| index)
                            .last()
                            .unwrap_or(0);
                        line.truncate(boundary);
                    }
                    let message = if stderr {
                        ProcessMessage::Stderr(line)
                    } else {
                        ProcessMessage::Stdout(line)
                    };
                    if tx.send(message).is_err() {
                        return;
                    }
                }
            }
        }
        let _ = tx.send(ProcessMessage::StreamClosed);
    });
}

fn codex_text(value: &Value) -> Option<String> {
    let event_type = value.get("type").and_then(Value::as_str).unwrap_or("");
    if matches!(event_type, "item.completed" | "item.updated")
        && value.pointer("/item/type").and_then(Value::as_str) == Some("agent_message")
    {
        return value
            .pointer("/item/text")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    value
        .get("delta")
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn claude_text(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) == Some("stream_event")
        && value.pointer("/event/type").and_then(Value::as_str) == Some("content_block_delta")
    {
        return value
            .pointer("/event/delta/text")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    if value.get("type").and_then(Value::as_str) == Some("result") {
        return value
            .get("result")
            .and_then(Value::as_str)
            .map(str::to_string);
    }
    None
}

fn parse_stream_text(runtime_id: &str, line: &str) -> Option<String> {
    let value = serde_json::from_str::<Value>(line).ok()?;
    match runtime_id {
        "codex-cli" => codex_text(&value),
        "claude-code-cli" => claude_text(&value),
        _ => None,
    }
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_external_process<F>(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    session_log_path: &Path,
    run_id: &str,
    project_id: &str,
    project_root: &Path,
    profile: &AgentProfile,
    prompt: &str,
    cancel_flag: &Arc<AtomicBool>,
    mut on_delta: F,
) -> Result<String, ExternalRunError>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let runtime =
        ready_runtime(db_path, &profile.runtime_id).map_err(|failure| ExternalRunError {
            failure,
            output_started: false,
        })?;
    let executable = runtime
        .executable_path
        .as_deref()
        .map(PathBuf::from)
        .ok_or_else(|| ExternalRunError {
            failure: external_failure(
                "agent.runtime.not_found",
                "resolve",
                true,
                [profile.runtime_id.clone()],
            ),
            output_started: false,
        })?;
    let tools = allowed_mcp_tools(profile);
    let broker_address = crate::commands::agent_mcp_broker::ensure_running(
        db_path,
        runtime_root,
        app_data_dir,
        session_log_path,
    )
    .map_err(|error| ExternalRunError {
        failure: external_failure("agent.runtime.mcp_failed", "mcp", true, [error]),
        output_started: false,
    })?;
    let (session, token) = storage::create_agent_mcp_session(
        db_path, run_id, project_id, profile, &tools,
    )
    .map_err(|error| ExternalRunError {
        failure: external_failure("agent.runtime.mcp_failed", "mcp", true, [error]),
        output_started: false,
    })?;
    let config_dir = runtime_root.join("agent-mcp").join(run_id);
    let config_path = config_dir.join("mcp.json");
    let proxy_exe = std::env::current_exe().map_err(|error| ExternalRunError {
        failure: external_failure(
            "agent.runtime.proxy_missing",
            "config",
            false,
            [error.to_string()],
        ),
        output_started: false,
    })?;
    let args = if profile.runtime_id == "codex-cli" {
        codex_managed_args(&proxy_exe, project_root)
    } else {
        let payload = claude_mcp_config(&proxy_exe).map_err(|error| ExternalRunError {
            failure: external_failure("agent.runtime.config_failed", "config", false, [error]),
            output_started: false,
        })?;
        write_runtime_config(&config_path, &payload).map_err(|error| ExternalRunError {
            failure: external_failure("agent.runtime.config_failed", "config", true, [error]),
            output_started: false,
        })?;
        claude_managed_args(&config_path)
    };
    let mut command = Command::new(&executable);
    command
        .args(args)
        .current_dir(project_root)
        .env("LATOTEX_MCP_BROKER_ADDR", broker_address)
        .env("LATOTEX_MCP_SESSION_TOKEN", &token)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    configure_process_group(&mut command);
    let mut child = command.spawn().map_err(|error| ExternalRunError {
        failure: external_failure(
            "agent.runtime.spawn_failed",
            "spawn",
            true,
            [error.to_string()],
        ),
        output_started: false,
    })?;
    if let Some(mut stdin) = child.stdin.take() {
        stdin
            .write_all(prompt.as_bytes())
            .and_then(|_| stdin.flush())
            .map_err(|error| {
                terminate_process_tree(&mut child);
                ExternalRunError {
                    failure: external_failure(
                        "agent.runtime.stdin_failed",
                        "stdin",
                        true,
                        [error.to_string()],
                    ),
                    output_started: false,
                }
            })?;
    }
    let (tx, rx) = mpsc::channel();
    if let Some(stdout) = child.stdout.take() {
        spawn_reader(stdout, false, tx.clone());
    }
    if let Some(stderr) = child.stderr.take() {
        spawn_reader(stderr, true, tx.clone());
    }
    drop(tx);
    let deadline = Instant::now() + Duration::from_millis(profile.timeout_ms.min(600_000));
    let mut output = String::new();
    let mut stderr_lines = Vec::new();
    let mut total_bytes = 0usize;
    let mut closed = 0usize;
    loop {
        if cancel_flag.load(Ordering::Relaxed) {
            terminate_process_tree(&mut child);
            storage::delete_agent_mcp_session(db_path, &session.session_id);
            let _ = fs::remove_dir_all(&config_dir);
            return Err(ExternalRunError {
                failure: external_failure("agent.run.cancelled", "cancel", false, Vec::new()),
                output_started: !output.is_empty(),
            });
        }
        if Instant::now() >= deadline {
            terminate_process_tree(&mut child);
            storage::delete_agent_mcp_session(db_path, &session.session_id);
            let _ = fs::remove_dir_all(&config_dir);
            return Err(ExternalRunError {
                failure: external_failure("agent.runtime.timeout", "execute", true, stderr_lines),
                output_started: !output.is_empty(),
            });
        }
        match rx.recv_timeout(Duration::from_millis(50)) {
            Ok(ProcessMessage::Stdout(line)) => {
                total_bytes = total_bytes.saturating_add(line.len());
                if total_bytes > OUTPUT_LIMIT {
                    terminate_process_tree(&mut child);
                    storage::delete_agent_mcp_session(db_path, &session.session_id);
                    let _ = fs::remove_dir_all(&config_dir);
                    return Err(ExternalRunError {
                        failure: external_failure(
                            "agent.runtime.output_too_large",
                            "parse",
                            false,
                            Vec::new(),
                        ),
                        output_started: !output.is_empty(),
                    });
                }
                if let Some(text) = parse_stream_text(&profile.runtime_id, &line) {
                    if !text.is_empty() && !output.ends_with(&text) {
                        if let Err(error) = on_delta(&text) {
                            terminate_process_tree(&mut child);
                            storage::delete_agent_mcp_session(db_path, &session.session_id);
                            let _ = fs::remove_dir_all(&config_dir);
                            return Err(ExternalRunError {
                                failure: external_failure(
                                    "agent.runtime.event_failed",
                                    "event",
                                    false,
                                    [error],
                                ),
                                output_started: !output.is_empty(),
                            });
                        }
                        output.push_str(&text);
                    }
                }
            }
            Ok(ProcessMessage::Stderr(line)) => {
                total_bytes = total_bytes.saturating_add(line.len());
                if total_bytes > OUTPUT_LIMIT {
                    terminate_process_tree(&mut child);
                    storage::delete_agent_mcp_session(db_path, &session.session_id);
                    let _ = fs::remove_dir_all(&config_dir);
                    return Err(ExternalRunError {
                        failure: external_failure(
                            "agent.runtime.output_too_large",
                            "parse",
                            false,
                            Vec::new(),
                        ),
                        output_started: !output.is_empty(),
                    });
                }
                if stderr_lines.len() < 8 {
                    stderr_lines.push(line);
                }
            }
            Ok(ProcessMessage::StreamClosed) => closed += 1,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(mpsc::RecvTimeoutError::Disconnected) => closed = 2,
        }
        match child.try_wait() {
            Ok(Some(status)) if closed >= 2 => {
                storage::delete_agent_mcp_session(db_path, &session.session_id);
                let _ = fs::remove_dir_all(&config_dir);
                if status.success() && !output.trim().is_empty() {
                    return Ok(output);
                }
                return Err(ExternalRunError {
                    failure: external_failure(
                        if output.trim().is_empty() {
                            "agent.runtime.empty_output"
                        } else {
                            "agent.runtime.exit_failed"
                        },
                        "execute",
                        true,
                        stderr_lines,
                    ),
                    output_started: !output.is_empty(),
                });
            }
            Ok(_) => {}
            Err(error) => {
                terminate_process_tree(&mut child);
                return Err(ExternalRunError {
                    failure: external_failure(
                        "agent.runtime.wait_failed",
                        "execute",
                        true,
                        [error.to_string()],
                    ),
                    output_started: !output.is_empty(),
                });
            }
        }
    }
}

#[cfg(test)]
#[path = "swarm_external_runtime_tests.rs"]
mod tests;
