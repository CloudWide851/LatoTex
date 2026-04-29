use crate::commands::native_runtime::configure_hidden_process;
use crate::models::{
    Ack, TerminalOutputChunk as TerminalOutputChunkModel, TerminalReadInput, TerminalReadResponse,
    TerminalResizeInput, TerminalStartInput, TerminalStartResponse, TerminalStopInput,
    TerminalWriteInput,
};
use crate::state::{AppState, TerminalOutputChunk, TerminalSession};
use crate::storage;
use latotex_workspace::resolve_workspace_target_path;
use std::env;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::process::{ChildStdout, Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::{Arc, Mutex};
use tauri::State;
use uuid::Uuid;

const MAX_TERMINAL_CHUNKS: usize = 2_000;

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

fn spawn_reader(session: Arc<TerminalSession>, stream: &'static str, mut reader: ChildStdout) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    append_output(
                        &session,
                        stream,
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

fn spawn_stderr_reader(session: Arc<TerminalSession>, mut reader: std::process::ChildStderr) {
    std::thread::spawn(move || {
        let mut buffer = [0_u8; 4096];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) => break,
                Ok(count) => {
                    append_output(
                        &session,
                        "stderr",
                        String::from_utf8_lossy(&buffer[..count]).to_string(),
                    );
                }
                Err(error) => {
                    append_output(
                        &session,
                        "stderr",
                        format!("\r\nterminal.stderr_failed: {error}\r\n"),
                    );
                    break;
                }
            }
        }
    });
}

fn looks_like_python_venv_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".venv" | "venv" | "env" | ".env" | "virtualenv"
    )
}

fn is_python_venv_dir(path: &Path) -> bool {
    let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
        return false;
    };
    if !looks_like_python_venv_name(name) {
        return false;
    }
    path.join("pyvenv.cfg").exists()
        || path.join("Scripts").join("python.exe").exists()
        || path.join("Scripts").join("activate").exists()
        || path.join("bin").join("python").exists()
        || path.join("bin").join("activate").exists()
}

fn find_python_venv(project_root: &Path, cwd: &Path) -> Option<PathBuf> {
    let canonical_root = project_root.canonicalize().ok()?;
    let mut current = cwd.canonicalize().ok()?;
    loop {
        for name in [".venv", "venv", "env", ".env", "virtualenv"] {
            let candidate = current.join(name);
            if candidate.starts_with(&canonical_root) && is_python_venv_dir(&candidate) {
                return Some(candidate);
            }
        }
        if current == canonical_root {
            break;
        }
        current = current.parent()?.to_path_buf();
        if !current.starts_with(&canonical_root) {
            break;
        }
    }
    None
}

fn venv_bin_dir(venv_path: &Path) -> PathBuf {
    if cfg!(target_os = "windows") {
        venv_path.join("Scripts")
    } else {
        venv_path.join("bin")
    }
}

fn prepend_venv_env(command: &mut Command, venv_path: Option<&Path>) {
    let Some(venv) = venv_path else {
        return;
    };
    let bin_dir = venv_bin_dir(venv);
    let path_key = "PATH";
    let current_path = env::var_os(path_key).unwrap_or_default();
    let separator = if cfg!(target_os = "windows") {
        ";"
    } else {
        ":"
    };
    let next_path = if current_path.is_empty() {
        bin_dir.to_string_lossy().to_string()
    } else {
        format!(
            "{}{}{}",
            bin_dir.to_string_lossy(),
            separator,
            current_path.to_string_lossy()
        )
    };
    command.env("VIRTUAL_ENV", venv);
    command.env(path_key, next_path);
    if cfg!(target_os = "windows") {
        command.env("PROMPT", "(venv) $P$G");
    } else {
        command.env("PS1", "(venv) \\w $ ");
    }
}

fn terminal_shell_command() -> (String, Vec<String>) {
    if cfg!(target_os = "windows") {
        return (
            "cmd.exe".to_string(),
            vec!["/Q".to_string(), "/K".to_string()],
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

#[tauri::command]
pub fn terminal_start(
    state: State<'_, AppState>,
    input: TerminalStartInput,
) -> Result<TerminalStartResponse, String> {
    let (project_root, directory) =
        resolve_terminal_directory(&state, &input.project_id, input.relative_path.as_deref())?;
    let venv_path = find_python_venv(&project_root, &directory);
    let (shell, args) = terminal_shell_command();
    let session_id = Uuid::new_v4().to_string();

    let mut command = Command::new(&shell);
    command
        .args(&args)
        .current_dir(&directory)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    prepend_venv_env(&mut command, venv_path.as_deref());
    configure_hidden_process(&mut command);

    let mut child = command
        .spawn()
        .map_err(|e| format!("terminal.spawn_failed: {e}"))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "terminal.stdin_unavailable".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "terminal.stdout_unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "terminal.stderr_unavailable".to_string())?;

    let session = Arc::new(TerminalSession {
        cwd: directory.to_string_lossy().to_string(),
        venv_path: venv_path
            .as_ref()
            .map(|path| path.to_string_lossy().to_string()),
        child: Mutex::new(child),
        stdin: Mutex::new(stdin),
        output: Mutex::new(Vec::new()),
        next_seq: AtomicU64::new(0),
        status: Mutex::new("running".to_string()),
        exit_code: Mutex::new(None),
    });

    append_output(
        &session,
        "stdout",
        format!(
            "LatoTex terminal started: cwd={}{}\r\n",
            session.cwd,
            session
                .venv_path
                .as_ref()
                .map(|value| format!(", venv={value}"))
                .unwrap_or_default()
        ),
    );
    spawn_reader(session.clone(), "stdout", stdout);
    spawn_stderr_reader(session.clone(), stderr);

    state.log(
        "INFO",
        &format!(
            "terminal_start: project={}, session={}, cwd={}, shell={}, cols={}, rows={}",
            input.project_id,
            session_id,
            session.cwd,
            shell,
            input.cols.unwrap_or(80),
            input.rows.unwrap_or(24),
        ),
    );
    state
        .terminal_sessions
        .lock()
        .map_err(|_| "terminal.sessions.lock_failed".to_string())?
        .insert(session_id.clone(), session.clone());

    Ok(TerminalStartResponse {
        session_id,
        cwd: session.cwd.clone(),
        shell,
        venv_path: session.venv_path.clone(),
        status: "running".to_string(),
    })
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
    let mut stdin = session
        .stdin
        .lock()
        .map_err(|_| "terminal.stdin.lock_failed".to_string())?;
    stdin
        .write_all(input.data.as_bytes())
        .map_err(|e| format!("terminal.write_failed: {e}"))?;
    stdin
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
                    *exit_code = status.code();
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
    let exists = state
        .terminal_sessions
        .lock()
        .map_err(|_| "terminal.sessions.lock_failed".to_string())?
        .contains_key(&input.session_id);
    if !exists {
        return Err("terminal.session.not_found".to_string());
    }
    state.log(
        "INFO",
        &format!(
            "terminal_resize: session={}, cols={}, rows={}",
            input.session_id, input.cols, input.rows
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
    use super::{find_python_venv, is_python_venv_dir};
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let path = std::env::temp_dir().join(format!("latotex-terminal-{name}-{}", Uuid::new_v4()));
        fs::create_dir_all(&path).unwrap();
        path
    }

    #[test]
    fn venv_detection_requires_real_markers() {
        let root = unique_temp_dir("markers");
        let fake = root.join(".venv");
        fs::create_dir_all(&fake).unwrap();
        assert!(!is_python_venv_dir(&fake));
        fs::write(fake.join("pyvenv.cfg"), "home = python").unwrap();
        assert!(is_python_venv_dir(&fake));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn finds_nearest_project_venv_from_nested_cwd() {
        let root = unique_temp_dir("nearest");
        let nested = root.join("src").join("pkg");
        let venv = root.join(".venv");
        fs::create_dir_all(&nested).unwrap();
        fs::create_dir_all(&venv).unwrap();
        fs::write(venv.join("pyvenv.cfg"), "home = python").unwrap();
        assert_eq!(
            find_python_venv(&root, &nested).unwrap(),
            venv.canonicalize().unwrap()
        );
        let _ = fs::remove_dir_all(root);
    }
}
