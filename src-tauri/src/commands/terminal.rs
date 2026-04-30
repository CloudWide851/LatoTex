use crate::commands::native_runtime::ensure_analysis_env_blocking;
use crate::models::{
    Ack, TerminalOutputChunk as TerminalOutputChunkModel, TerminalReadInput, TerminalReadResponse,
    TerminalResizeInput, TerminalStartInput, TerminalStartResponse, TerminalStopInput,
    TerminalWriteInput,
};
use crate::state::{AppState, TerminalOutputChunk, TerminalSession};
use crate::storage;
use latotex_workspace::resolve_workspace_target_path;
use portable_pty::{native_pty_system, CommandBuilder, PtySize};
use std::env;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

const MAX_TERMINAL_CHUNKS: usize = 2_000;

struct TerminalEnv {
    venv_path: PathBuf,
    env_source: String,
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
                Err(error) => {
                    append_output(
                        &session,
                        "stderr",
                        format!("\r\nterminal.read_failed: {error}\r\n"),
                    );
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

fn venv_env_pairs(venv_path: &Path) -> Vec<(String, String)> {
    let bin_dir = venv_bin_dir(venv_path);
    let current_path = env::var_os("PATH").unwrap_or_default();
    let mut path_entries = vec![bin_dir];
    path_entries.extend(env::split_paths(&current_path));
    let next_path = env::join_paths(path_entries)
        .unwrap_or(current_path)
        .to_string_lossy()
        .to_string();
    let prompt = venv_path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("venv");
    vec![
        ("VIRTUAL_ENV".to_string(), venv_path.to_string_lossy().to_string()),
        ("VIRTUAL_ENV_PROMPT".to_string(), format!("({prompt}) ")),
        ("PATH".to_string(), next_path),
        ("TERM".to_string(), "xterm-256color".to_string()),
        ("COLORTERM".to_string(), "truecolor".to_string()),
    ]
}

fn terminal_shell_command() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        return (
            "powershell.exe".to_string(),
            vec!["-NoLogo".to_string(), "-NoExit".to_string()],
        );
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
        (shell, vec!["-il".to_string()])
    } else {
        (shell, vec!["-l".to_string(), "-i".to_string()])
    }
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

fn resolve_terminal_env(
    state: &AppState,
    project_id: &str,
    project_root: &Path,
) -> Result<TerminalEnv, String> {
    let status = ensure_analysis_env_blocking(
        &state.db_path,
        &state.runtime_root,
        &state.app_data_dir,
        project_id,
        project_root,
    )?;
    let venv_path = PathBuf::from(status.venv_path);
    if !venv_path.exists() {
        return Err("terminal.env.not_ready".to_string());
    }
    Ok(TerminalEnv {
        venv_path,
        env_source: "analysis".to_string(),
    })
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
pub async fn terminal_start(
    state: State<'_, AppState>,
    input: TerminalStartInput,
) -> Result<TerminalStartResponse, String> {
    let state_snapshot = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let (project_root, directory) = resolve_terminal_directory(
            &state_snapshot,
            &input.project_id,
            input.relative_path.as_deref(),
        )?;
        let terminal_env = resolve_terminal_env(&state_snapshot, &input.project_id, &project_root)?;
        let (shell, args) = terminal_shell_command();
        let session_id = Uuid::new_v4().to_string();
        let size = clamp_pty_size(input.cols, input.rows);

        let pty_system = native_pty_system();
        let pair = pty_system
            .openpty(size)
            .map_err(|e| format!("terminal.pty_open_failed: {e}"))?;
        let reader = pair
            .master
            .try_clone_reader()
            .map_err(|e| format!("terminal.reader_unavailable: {e}"))?;
        let writer = pair
            .master
            .take_writer()
            .map_err(|e| format!("terminal.writer_unavailable: {e}"))?;

        let mut command = CommandBuilder::new(&shell);
        command.args(&args);
        command.cwd(&directory);
        for (key, value) in venv_env_pairs(&terminal_env.venv_path) {
            command.env(key, value);
        }
        let child = pair
            .slave
            .spawn_command(command)
            .map_err(|e| format!("terminal.spawn_failed: {e}"))?;
        drop(pair.slave);

        let session = Arc::new(TerminalSession {
            cwd: directory.to_string_lossy().to_string(),
            venv_path: Some(terminal_env.venv_path.to_string_lossy().to_string()),
            env_source: Some(terminal_env.env_source.clone()),
            master: Mutex::new(pair.master),
            child: Mutex::new(child),
            writer: Mutex::new(writer),
            output: Mutex::new(Vec::new()),
            next_seq: AtomicU64::new(0),
            status: Mutex::new("running".to_string()),
            exit_code: Mutex::new(None),
        });

        append_output(
            &session,
            "stdout",
            format!(
                "LatoTex terminal started: cwd={}, venv={}, source={}\r\n",
                session.cwd,
                session.venv_path.as_deref().unwrap_or("-"),
                terminal_env.env_source,
            ),
        );
        spawn_pty_reader(session.clone(), reader);

        state_snapshot.log(
            "INFO",
            &format!(
                "terminal_start: project={}, session={}, cwd={}, shell={}, venv={}, cols={}, rows={}",
                input.project_id,
                session_id,
                session.cwd,
                shell,
                session.venv_path.as_deref().unwrap_or("-"),
                size.cols,
                size.rows,
            ),
        );
        state_snapshot
            .terminal_sessions
            .lock()
            .map_err(|_| "terminal.sessions.lock_failed".to_string())?
            .insert(session_id.clone(), session.clone());

        Ok(TerminalStartResponse {
            session_id,
            cwd: session.cwd.clone(),
            shell,
            venv_path: session.venv_path.clone(),
            env_source: session.env_source.clone(),
            status: "running".to_string(),
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn terminal_write(
    state: State<'_, AppState>,
    input: TerminalWriteInput,
) -> Result<Ack, String> {
    let session = state
        .terminal_sessions
        .lock()
        .map_err(|_| "terminal.sessions.lock_failed".to_string())?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| "terminal.session.not_found".to_string())?;
    let mut writer = session
        .writer
        .lock()
        .map_err(|_| "terminal.writer.lock_failed".to_string())?;
    writer
        .write_all(input.data.as_bytes())
        .map_err(|e| format!("terminal.write_failed: {e}"))?;
    writer
        .flush()
        .map_err(|e| format!("terminal.flush_failed: {e}"))?;
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
        .map_err(|_| "terminal.sessions.lock_failed".to_string())?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| "terminal.session.not_found".to_string())?;

    if let Ok(mut child) = session.child.lock() {
        match child.try_wait() {
            Ok(Some(status)) => {
                if let Ok(mut session_status) = session.status.lock() {
                    *session_status = "exited".to_string();
                }
                if let Ok(mut exit_code) = session.exit_code.lock() {
                    *exit_code = Some(status.exit_code() as i32);
                }
            }
            Ok(None) => {}
            Err(error) => append_output(
                &session,
                "stderr",
                format!("\r\nterminal.poll_failed: {error}\r\n"),
            ),
        }
    }

    let cursor = input.cursor.unwrap_or(0);
    let chunks = session
        .output
        .lock()
        .map_err(|_| "terminal.output.lock_failed".to_string())?
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
        .map_err(|_| "terminal.status.lock_failed".to_string())?
        .clone();
    let exit_code = *session
        .exit_code
        .lock()
        .map_err(|_| "terminal.exit_code.lock_failed".to_string())?;

    Ok(TerminalReadResponse {
        cursor: next_cursor,
        chunks,
        exit_code,
        status,
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
        .map_err(|_| "terminal.sessions.lock_failed".to_string())?
        .get(&input.session_id)
        .cloned()
        .ok_or_else(|| "terminal.session.not_found".to_string())?;
    let size = clamp_pty_size(Some(input.cols), Some(input.rows));
    session
        .master
        .lock()
        .map_err(|_| "terminal.master.lock_failed".to_string())?
        .resize(size)
        .map_err(|e| format!("terminal.resize_failed: {e}"))?;
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
        .map_err(|_| "terminal.sessions.lock_failed".to_string())?
        .remove(&input.session_id);
    if let Some(session) = session {
        if let Ok(mut child) = session.child.lock() {
            let _ = child.kill();
            let _ = child.wait();
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
mod tests {
    use super::{clamp_pty_size, venv_bin_dir};
    use std::path::PathBuf;

    #[test]
    fn clamps_terminal_size() {
        let small = clamp_pty_size(Some(1), Some(1));
        assert_eq!(small.cols, 40);
        assert_eq!(small.rows, 8);
        let large = clamp_pty_size(Some(999), Some(999));
        assert_eq!(large.cols, 240);
        assert_eq!(large.rows, 120);
    }

    #[test]
    fn resolves_platform_venv_bin_dir() {
        let root = PathBuf::from("demo-venv");
        let rendered = venv_bin_dir(&root).to_string_lossy().replace('\\', "/");
        if cfg!(target_os = "windows") {
            assert!(rendered.ends_with("demo-venv/Scripts"));
        } else {
            assert!(rendered.ends_with("demo-venv/bin"));
        }
    }
}
