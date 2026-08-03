use crate::commands::native_runtime::ensure_analysis_env_with_progress_blocking;
use crate::models::{
    Ack, TerminalActivateInput, TerminalActivateResponse, TerminalCancelStartInput,
    TerminalFailure, TerminalLaunchKind, TerminalOutputChunk as TerminalOutputChunkModel,
    TerminalReadInput, TerminalReadResponse, TerminalResizeInput, TerminalStartInput,
    TerminalStartResponse, TerminalStatus, TerminalStopInput, TerminalWriteInput,
};
use crate::state::{AppState, TerminalOutputChunk, TerminalResourceLease, TerminalSession};
use crate::storage;
use latotex_workspace::resolve_workspace_target_path;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::env;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::{mpsc, Arc, Mutex};
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

#[path = "terminal_external_runtime.rs"]
mod external_runtime;
#[path = "terminal_lifecycle.rs"]
mod lifecycle;
pub use lifecycle::{terminal_activate_research_env, terminal_cancel_start, terminal_start};

const MAX_TERMINAL_CHUNKS: usize = 2_000;
const TERMINAL_START_TIMEOUT: Duration = Duration::from_secs(8);

struct TerminalShellSpec {
    shell: String,
    args: Vec<String>,
    env: Vec<(String, String)>,
    launch_kind: TerminalLaunchKind,
    resource_lease: Option<TerminalResourceLease>,
}

struct PreparedTerminal {
    shell: String,
    directory: PathBuf,
    master: Box<dyn portable_pty::MasterPty + Send>,
    child: Box<dyn portable_pty::Child + Send>,
    writer: Box<dyn Write + Send>,
    reader: Box<dyn Read + Send>,
    launch_kind: TerminalLaunchKind,
    resource_lease: Option<TerminalResourceLease>,
}

struct TerminalInternalFailure {
    failure: TerminalFailure,
    diagnostics: String,
}

fn terminal_failure(code: &str, stage: &str, retryable: bool) -> TerminalFailure {
    TerminalFailure {
        code: code.to_string(),
        stage: stage.to_string(),
        retryable,
    }
}

fn internal_failure(
    code: &str,
    stage: &str,
    retryable: bool,
    diagnostics: impl Into<String>,
) -> TerminalInternalFailure {
    TerminalInternalFailure {
        failure: terminal_failure(code, stage, retryable),
        diagnostics: diagnostics.into(),
    }
}

fn public_failure(failure: &TerminalFailure) -> String {
    serde_json::to_string(failure).unwrap_or_else(|_| failure.code.clone())
}

fn public_failure_code(code: &str, stage: &str, retryable: bool) -> String {
    public_failure(&terminal_failure(code, stage, retryable))
}

fn append_output(session: &TerminalSession, stream: &str, text: String) {
    if text.is_empty() {
        return;
    }
    let seq = session.next_seq.fetch_add(1, Ordering::SeqCst) + 1;
    if let Ok(mut output) = session.output.lock() {
        output.push(TerminalOutputChunk {
            seq,
            stream: stream.to_string(),
            text,
        });
        if output.len() > MAX_TERMINAL_CHUNKS {
            let overflow = output.len() - MAX_TERMINAL_CHUNKS;
            output.drain(0..overflow);
        }
    }
}

fn spawn_pty_reader(session: Arc<TerminalSession>, mut reader: Box<dyn Read + Send>) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    append_output(
                        &session,
                        "stdout",
                        String::from_utf8_lossy(&buffer[..count]).to_string(),
                    );
                }
                Err(_error) => {
                    if let Ok(mut status) = session.status.lock() {
                        *status = TerminalStatus::Failed;
                    }
                    if let Ok(mut failure) = session.failure.lock() {
                        *failure = Some(terminal_failure(
                            "terminal.failure.read_failed",
                            "read",
                            true,
                        ));
                    }
                    break;
                }
            }
        }
    });
}

fn venv_bin_dir(venv_path: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_path.join("Scripts")
    } else {
        venv_path.join("bin")
    }
}

fn strip_windows_verbatim_prefix(text: &str) -> String {
    if let Some(stripped) = text.strip_prefix(r"\\?\UNC\") {
        return format!(r"\\{stripped}");
    }
    if let Some(stripped) = text.strip_prefix(r"\\?\") {
        return stripped.to_string();
    }
    text.to_string()
}

fn runtime_path_text(path: &Path) -> String {
    strip_windows_verbatim_prefix(&path.to_string_lossy())
}

fn shell_single_quote(value: &str) -> String {
    format!("'{}'", value.replace('\'', "''"))
}

fn cmd_quote(value: &str) -> String {
    format!("\"{}\"", value.replace('"', "\"\""))
}

fn terminal_env_pairs() -> Vec<(String, String)> {
    vec![
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
        ("FORCE_COLOR".to_string(), "1".to_string()),
    ]
}

fn terminal_shell_pref(state: &AppState) -> String {
    storage::load_settings(&state.db_path, &state.runtime_root)
        .ok()
        .and_then(|settings| settings.ui_prefs)
        .and_then(|prefs| prefs.terminal_shell)
        .map(|value| value.trim().to_ascii_lowercase())
        .filter(|value| matches!(value.as_str(), "powershell" | "cmd" | "system"))
        .unwrap_or_else(|| "powershell".to_string())
}

fn powershell_spec() -> TerminalShellSpec {
    TerminalShellSpec {
        shell: "powershell.exe".to_string(),
        args: vec!["-NoProfile".to_string(), "-NoLogo".to_string()],
        env: Vec::new(),
        launch_kind: TerminalLaunchKind::Shell,
        resource_lease: None,
    }
}

fn cmd_spec() -> TerminalShellSpec {
    TerminalShellSpec {
        shell: env::var("COMSPEC")
            .ok()
            .filter(|value| !value.trim().is_empty())
            .unwrap_or_else(|| "cmd.exe".to_string()),
        args: Vec::new(),
        env: Vec::new(),
        launch_kind: TerminalLaunchKind::Shell,
        resource_lease: None,
    }
}

fn terminal_shell_command(setting: &str) -> TerminalShellSpec {
    if cfg!(target_os = "windows") {
        return match setting {
            "cmd" => cmd_spec(),
            "system" if env::var("COMSPEC").is_ok() => cmd_spec(),
            _ => powershell_spec(),
        };
    }
    let shell = env::var("SHELL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            if cfg!(target_os = "macos") {
                "/bin/zsh".to_string()
            } else {
                "/bin/bash".to_string()
            }
        });
    let shell_name = Path::new(&shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if shell_name.contains("zsh") {
        TerminalShellSpec {
            shell,
            args: vec!["-il".to_string()],
            env: Vec::new(),
            launch_kind: TerminalLaunchKind::Shell,
            resource_lease: None,
        }
    } else {
        TerminalShellSpec {
            shell,
            args: vec!["-l".to_string(), "-i".to_string()],
            env: Vec::new(),
            launch_kind: TerminalLaunchKind::Shell,
            resource_lease: None,
        }
    }
}

fn terminal_activation_command(shell: &str, venv_path: &Path) -> String {
    let shell_name = Path::new(shell)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(shell)
        .to_ascii_lowercase();
    if shell_name.contains("powershell") || shell_name.contains("pwsh") {
        let activate = runtime_path_text(&venv_path.join("Scripts").join("Activate.ps1"));
        return format!(". {}\r", shell_single_quote(&activate));
    }
    if shell_name == "cmd" || shell_name == "cmd.exe" {
        let activate = runtime_path_text(&venv_path.join("Scripts").join("activate.bat"));
        return format!("call {}\r", cmd_quote(&activate));
    }
    let activate = runtime_path_text(&venv_bin_dir(venv_path).join("activate"));
    format!(". {}\n", shell_single_quote(&activate))
}

fn resolve_terminal_directory(
    state: &AppState,
    project_id: &str,
    relative_path: Option<&str>,
) -> Result<(PathBuf, PathBuf), String> {
    let project_root = storage::load_project_root(&state.db_path, project_id)?;
    let target = resolve_workspace_target_path(&project_root, relative_path)?;
    let directory = if target.is_file() {
        target
            .parent()
            .ok_or_else(|| "terminal.cwd.parent_missing".to_string())?
            .to_path_buf()
    } else {
        target
    };
    if !directory.is_dir() {
        return Err("terminal.cwd.not_directory".to_string());
    }
    Ok((project_root, directory))
}

fn clamp_pty_size(cols: Option<u16>, rows: Option<u16>) -> PtySize {
    PtySize {
        rows: rows.unwrap_or(24).clamp(8, 120),
        cols: cols.unwrap_or(80).clamp(40, 240),
        pixel_width: 0,
        pixel_height: 0,
    }
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    input: TerminalWriteInput,
) -> Result<Ack, String> {
    let session = state
        .terminal_sessions
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.registry_unavailable", "write", true))?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| public_failure_code("terminal.failure.session_missing", "write", true))?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.write_failed", "write", true))?;
    writer.write_all(input.data.as_bytes()).map_err(|error| {
        state.log(
            "ERROR",
            &format!(
                "terminal_write.failed: session={}, diagnostics={error}",
                input.session_id
            ),
        );
        public_failure_code("terminal.failure.write_failed", "write", true)
    })?;
    writer.flush().map_err(|error| {
        state.log(
            "ERROR",
            &format!(
                "terminal_write.failed: session={}, diagnostics={error}",
                input.session_id
            ),
        );
        public_failure_code("terminal.failure.write_failed", "write", true)
    })?;
    Ok(Ack {
        ok: true,
        message: "terminal.write.ok".to_string(),
    })
}

#[tauri::command]
pub fn terminal_read(
    state: State<'_, AppState>,
    input: TerminalReadInput,
) -> Result<TerminalReadResponse, String> {
    let session = state
        .terminal_sessions
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.registry_unavailable", "read", true))?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| public_failure_code("terminal.failure.session_missing", "read", true))?;
    if let Ok(mut child) = session.child.lock() {
        match child.try_wait() {
            Ok(Some(status)) => {
                if let Ok(mut session_status) = session.status.lock() {
                    *session_status = TerminalStatus::Exited;
                }
                if let Ok(mut exit_code) = session.exit_code.lock() {
                    *exit_code = Some(status.exit_code() as i32);
                }
            }
            Ok(None) => {}
            Err(_error) => {
                if let Ok(mut status) = session.status.lock() {
                    *status = TerminalStatus::Failed;
                }
                if let Ok(mut failure) = session.failure.lock() {
                    *failure = Some(terminal_failure(
                        "terminal.failure.poll_failed",
                        "read",
                        true,
                    ));
                }
            }
        }
    }
    let cursor = input.cursor.unwrap_or(0);
    let chunks = session
        .output
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.read_failed", "read", true))?
        .iter()
        .filter(|chunk| chunk.seq > cursor)
        .map(|chunk| TerminalOutputChunkModel {
            seq: chunk.seq,
            stream: chunk.stream.clone(),
            text: chunk.text.clone(),
        })
        .collect::<Vec<_>>();
    let next_cursor = chunks.last().map(|chunk| chunk.seq).unwrap_or(cursor);
    let status = session
        .status
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.read_failed", "read", true))?
        .to_owned();
    let exit_code = *session
        .exit_code
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.read_failed", "read", true))?;
    let failure = session
        .failure
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.read_failed", "read", true))?
        .clone();
    Ok(TerminalReadResponse {
        cursor: next_cursor,
        chunks,
        exit_code,
        status,
        failure,
    })
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, AppState>,
    input: TerminalResizeInput,
) -> Result<Ack, String> {
    let session = state
        .terminal_sessions
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.registry_unavailable", "resize", true))?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| public_failure_code("terminal.failure.session_missing", "resize", true))?;
    let size = clamp_pty_size(Some(input.cols), Some(input.rows));
    session
        .master
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.resize_failed", "resize", true))?
        .resize(size)
        .map_err(|error| {
            state.log(
                "ERROR",
                &format!(
                    "terminal_resize.failed: session={}, diagnostics={error}",
                    input.session_id
                ),
            );
            public_failure_code("terminal.failure.resize_failed", "resize", true)
        })?;
    state.log(
        "INFO",
        &format!(
            "terminal_resize: session={}, cols={}, rows={}",
            input.session_id, size.cols, size.rows
        ),
    );
    Ok(Ack {
        ok: true,
        message: "terminal.resize.ok".to_string(),
    })
}

#[tauri::command]
pub fn terminal_stop(state: State<'_, AppState>, input: TerminalStopInput) -> Result<Ack, String> {
    let session = state
        .terminal_sessions
        .lock()
        .map_err(|_| public_failure_code("terminal.failure.registry_unavailable", "stop", true))?
        .remove(&input.session_id);
    if let Some(session) = session {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
        }
        if let Ok(mut lease) = session.resource_lease.lock() {
            drop(lease.take());
        }
        state.log(
            "INFO",
            &format!("terminal_stop: session={}", input.session_id),
        );
    }
    Ok(Ack {
        ok: true,
        message: "terminal.stop.ok".to_string(),
    })
}

#[cfg(test)]
#[path = "terminal_tests.rs"]
mod tests;
