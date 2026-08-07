use super::agent_runtime::{refresh_runtime, resolve_runtime_path, runtime_spec};
use super::native_runtime::configure_hidden_process;
use crate::logging::sanitize_log_message_with_limit;
use crate::models::{Ack, AgentRuntimeDescriptor, AgentRuntimeInput, ExternalAgentFailure};
use crate::state::AppState;
use std::collections::HashMap;
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

const UPDATE_TIMEOUT: Duration = Duration::from_secs(20 * 60);

fn updates() -> &'static Mutex<HashMap<String, Arc<AtomicBool>>> {
    static UPDATES: OnceLock<Mutex<HashMap<String, Arc<AtomicBool>>>> = OnceLock::new();
    UPDATES.get_or_init(|| Mutex::new(HashMap::new()))
}

fn failure(code: &str, stage: &str, retryable: bool, detail: &str) -> ExternalAgentFailure {
    ExternalAgentFailure {
        code: code.to_string(),
        stage: stage.to_string(),
        retryable,
        diagnostics: if detail.trim().is_empty() {
            Vec::new()
        } else {
            vec![sanitize_log_message_with_limit(detail, 512)]
        },
    }
}

fn terminate(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let mut command = Command::new("taskkill.exe");
        configure_hidden_process(&mut command);
        let _ = command
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn run_update(
    path: &std::path::Path,
    args: &[&str],
    cancelled: &AtomicBool,
) -> Result<(), ExternalAgentFailure> {
    let mut command = Command::new(path);
    configure_hidden_process(&mut command);
    let mut child = command
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|error| {
            failure(
                "agent.runtime.update_spawn_failed",
                "update",
                true,
                &error.to_string(),
            )
        })?;
    let started = Instant::now();
    loop {
        if cancelled.load(Ordering::Relaxed) {
            terminate(&mut child);
            return Err(failure(
                "agent.runtime.update_cancelled",
                "update",
                true,
                "",
            ));
        }
        match child.try_wait() {
            Ok(Some(status)) if status.success() => return Ok(()),
            Ok(Some(_)) => return Err(failure("agent.runtime.update_failed", "update", true, "")),
            Ok(None) if started.elapsed() < UPDATE_TIMEOUT => {
                thread::sleep(Duration::from_millis(80))
            }
            Ok(None) => {
                terminate(&mut child);
                return Err(failure("agent.runtime.update_timeout", "update", true, ""));
            }
            Err(error) => {
                terminate(&mut child);
                return Err(failure(
                    "agent.runtime.update_failed",
                    "update",
                    true,
                    &error.to_string(),
                ));
            }
        }
    }
}

fn register_update(runtime_id: &str) -> Result<Arc<AtomicBool>, String> {
    let mut guard = updates()
        .lock()
        .map_err(|_| "agent.runtime.update_state_failed".to_string())?;
    if guard.contains_key(runtime_id) {
        return Err("agent.runtime.update_busy".to_string());
    }
    let token = Arc::new(AtomicBool::new(false));
    guard.insert(runtime_id.to_string(), token.clone());
    Ok(token)
}

fn unregister_update(runtime_id: &str) {
    if let Ok(mut guard) = updates().lock() {
        guard.remove(runtime_id);
    }
}

#[tauri::command]
pub async fn agent_runtime_update(
    state: State<'_, AppState>,
    input: AgentRuntimeInput,
) -> Result<AgentRuntimeDescriptor, String> {
    let spec = runtime_spec(&input.runtime_id)?;
    let runtime_id = spec.id.to_string();
    let db_path = state.db_path.clone();
    let cancelled = register_update(&runtime_id)?;
    let task = tauri::async_runtime::spawn_blocking(move || {
        let (path, _) = resolve_runtime_path(&db_path, spec).map_err(|item| item.code)?;
        run_update(&path, spec.update_args, &cancelled).map_err(|item| item.code)?;
        refresh_runtime(&db_path, spec)
    });
    let result = match task.await {
        Ok(result) => result,
        Err(_) => Err("agent.runtime.update_join_failed".to_string()),
    };
    unregister_update(&runtime_id);
    result
}

#[tauri::command]
pub fn agent_runtime_update_cancel(input: AgentRuntimeInput) -> Result<Ack, String> {
    runtime_spec(&input.runtime_id)?;
    let cancelled = updates()
        .lock()
        .map_err(|_| "agent.runtime.update_state_failed".to_string())?
        .get(&input.runtime_id)
        .cloned();
    if let Some(token) = cancelled {
        token.store(true, Ordering::Relaxed);
        return Ok(Ack {
            ok: true,
            message: "agent.runtime.update_cancel_requested".to_string(),
        });
    }
    Ok(Ack {
        ok: false,
        message: "agent.runtime.update_not_running".to_string(),
    })
}
