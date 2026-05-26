use crate::models::{McpServerConfig, McpValidationResult};
use crate::storage;
use serde_json::json;
use serde_json::Value;
use std::io::{BufRead, BufReader, Write};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::mpsc;
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::swarm_events::{emit_stage_event, emit_tool_event, EventMetadata};
use crate::commands::native_runtime::configure_hidden_process;

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn parse_server_id(source: &str) -> String {
    source
        .split(':')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("stitch")
        .to_string()
}

fn configured_server(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    server_id: &str,
) -> Result<McpServerConfig, String> {
    let settings = storage::load_settings(db_path, runtime_root)?;
    let prefs = settings.ui_prefs.as_ref().and_then(|prefs| prefs.agent_tool_prefs.as_ref());
    if prefs.and_then(|prefs| prefs.mcp_enabled).unwrap_or(true) == false {
        return Err("mcp.disabled_by_settings".to_string());
    }
    let permission_prefs = settings
        .ui_prefs
        .as_ref()
        .and_then(|prefs| prefs.agent_permission_prefs.as_ref());
    if permission_prefs
        .and_then(|prefs| prefs.mcp.as_deref())
        .is_some_and(|mode| mode == "deny")
        || permission_prefs
            .and_then(|prefs| prefs.mcp_server_modes.as_ref())
            .and_then(|modes| modes.get(server_id))
            .is_some_and(|mode| mode == "deny")
    {
        return Err("mcp.disabled_by_settings".to_string());
    }
    let servers = settings
        .ui_prefs
        .and_then(|prefs| prefs.mcp_servers)
        .unwrap_or_default();
    servers
        .into_iter()
        .find(|server| {
            server.id == server_id
                && server.enabled.unwrap_or(true)
                && !server.command.trim().is_empty()
        })
        .ok_or_else(|| format!("mcp.server.not_configured:{server_id}"))
}

fn run_json_rpc_probe(server: &McpServerConfig) -> Result<String, String> {
    let mut command = Command::new(server.command.trim());
    configure_hidden_process(&mut command);
    for arg in server.args.clone().unwrap_or_default() {
        command.arg(arg);
    }
    for (key, value) in server.env.clone().unwrap_or_default() {
        command.env(key, value);
    }
    command.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
    let mut child = command.spawn().map_err(|e| format!("mcp.spawn_failed:{e}"))?;
    let mut stdin = child.stdin.take().ok_or_else(|| "mcp.stdin_unavailable".to_string())?;
    let stdout = child.stdout.take().ok_or_else(|| "mcp.stdout_unavailable".to_string())?;
    let (tx, rx) = mpsc::channel::<String>();
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        for _ in 0..3 {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) | Err(_) => break,
                Ok(_) => {
                    let _ = tx.send(line.trim().to_string());
                }
            }
        }
    });
    let init = json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "LatoTex", "version": "0.1.0"}
        }
    });
    let tools = json!({"jsonrpc": "2.0", "id": 2, "method": "tools/list", "params": {}});
    writeln!(stdin, "{init}").map_err(|e| format!("mcp.write_failed:{e}"))?;
    writeln!(stdin, "{tools}").map_err(|e| format!("mcp.write_failed:{e}"))?;
    let deadline = Instant::now() + Duration::from_secs(8);
    let mut lines = Vec::<String>::new();
    while Instant::now() < deadline && lines.len() < 2 {
        match rx.recv_timeout(Duration::from_millis(250)) {
            Ok(line) if !line.is_empty() => lines.push(line),
            Ok(_) => {}
            Err(mpsc::RecvTimeoutError::Timeout) => {}
            Err(_) => break,
        }
    }
    let _ = child.kill();
    let _ = child.wait();
    if lines.is_empty() {
        return Err("mcp.no_response".to_string());
    }
    Ok(lines.join("\n"))
}

fn parse_tool_names(output: &str) -> Vec<String> {
    output
        .lines()
        .filter_map(|line| serde_json::from_str::<Value>(line).ok())
        .filter_map(|payload| payload.get("result").cloned())
        .filter_map(|result| result.get("tools").and_then(Value::as_array).cloned())
        .flat_map(|tools| tools.into_iter())
        .filter_map(|tool| tool.get("name").and_then(Value::as_str).map(str::to_string))
        .collect()
}

pub(super) fn validate_mcp_server(server: McpServerConfig) -> Result<McpValidationResult, String> {
    let id = server.id.trim();
    if id.is_empty() {
        return Ok(McpValidationResult {
            ok: false,
            message: "mcp.validation.id_missing".to_string(),
            tools: Vec::new(),
        });
    }
    if server.command.trim().is_empty() {
        return Ok(McpValidationResult {
            ok: false,
            message: "mcp.validation.command_missing".to_string(),
            tools: Vec::new(),
        });
    }
    match run_json_rpc_probe(&server) {
        Ok(output) => {
            let tools = parse_tool_names(&output);
            Ok(McpValidationResult {
                ok: true,
                message: if tools.is_empty() {
                    "mcp.validation.connected".to_string()
                } else {
                    format!("mcp.validation.tools:{}", tools.len())
                },
                tools,
            })
        }
        Err(error) => Ok(McpValidationResult {
            ok: false,
            message: error,
            tools: Vec::new(),
        }),
    }
}

pub(super) fn run_stage_mcp_call(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    stage: &str,
    source: &str,
    title: &str,
    cancel_flag: &Arc<AtomicBool>,
    metadata: EventMetadata<'_>,
) -> Result<String, String> {
    ensure_not_cancelled(cancel_flag)?;
    let server_id = parse_server_id(source);
    let server = configured_server(db_path, runtime_root, &server_id)?;
    emit_stage_event(db_path, run_id, project_id, event_scope, source, stage, "running", title, "", metadata)?;
    let running_actions = json!([{"type":"call","tool":"mcp","status":"running","serverId":server_id.clone()}]);
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "mcp_call",
        "running",
        &server_id,
        EventMetadata { actions: Some(&running_actions), ..metadata },
    )?;
    let output = run_json_rpc_probe(&server)?;
    ensure_not_cancelled(cancel_flag)?;
    let success_actions = json!([{"type":"call","tool":"mcp","status":"success","serverId":server_id.clone()}]);
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "mcp_call",
        "success",
        "mcp server responded",
        EventMetadata { actions: Some(&success_actions), ..metadata },
    )?;
    emit_stage_event(db_path, run_id, project_id, event_scope, source, stage, "success", title, "", metadata)?;
    Ok(format!("[mcp.response.v1]\nserver={server_id}\n{output}"))
}

#[cfg(test)]
mod tests {
    use super::run_stage_mcp_call;
    use super::EventMetadata;
    use crate::storage;
    use rusqlite::{params, Connection};
    use serde_json::json;
    use std::fs;
    use std::path::PathBuf;
    use std::sync::atomic::AtomicBool;
    use std::sync::Arc;
    use uuid::Uuid;

    fn disabled_settings_fixture() -> (PathBuf, PathBuf) {
        let root = std::env::temp_dir().join(format!("latotex-mcp-tool-{}", Uuid::new_v4()));
        let runtime_root = root.join("runtime");
        let db_path = runtime_root.join("latotex.db");
        fs::create_dir_all(&runtime_root).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "UPDATE app_settings SET ui_prefs_json = ?1 WHERE id = 1",
            params![json!({"agentToolPrefs":{"mcpEnabled":false}}).to_string()],
        )
        .unwrap();
        (db_path, runtime_root)
    }

    #[test]
    fn mcp_disabled_returns_before_events_or_process_probe() {
        let (db_path, runtime_root) = disabled_settings_fixture();
        let cancel_flag = Arc::new(AtomicBool::new(false));
        let error = run_stage_mcp_call(
            &db_path,
            &runtime_root,
            "run-disabled-mcp",
            "missing-project",
            "unit",
            "mcp",
            "stitch",
            "MCP",
            &cancel_flag,
            EventMetadata::base("wf", "step", "test"),
        )
        .unwrap_err();

        assert_eq!(error, "mcp.disabled_by_settings");
        let conn = Connection::open(&db_path).unwrap();
        let count: i64 = conn
            .query_row("SELECT COUNT(*) FROM swarm_events", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 0);
    }
}
