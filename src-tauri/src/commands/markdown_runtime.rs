use crate::commands::native_runtime::{configure_hidden_process, ensure_analysis_env_blocking};
use crate::models::{MarkdownRunCodeInput, MarkdownRunCodeResponse};
use crate::state::AppState;
use crate::storage;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};
use tauri::{async_runtime::spawn_blocking, State};
use uuid::Uuid;

const MAX_CODE_BYTES: usize = 96 * 1024;
const MAX_OUTPUT_BYTES: usize = 32 * 1024;
const RUN_TIMEOUT: Duration = Duration::from_secs(12);

fn normalize_language(language: &str) -> String {
    match language.trim().to_ascii_lowercase().as_str() {
        "py" | "python3" => "python".to_string(),
        "c++" | "cc" | "cxx" => "cpp".to_string(),
        "c" => "c".to_string(),
        other => other.to_string(),
    }
}

fn clamp_text(value: &[u8]) -> (String, bool) {
    let truncated = value.len() > MAX_OUTPUT_BYTES;
    let slice = if truncated { &value[..MAX_OUTPUT_BYTES] } else { value };
    (String::from_utf8_lossy(slice).to_string(), truncated)
}

fn command_output_with_timeout(mut command: Command) -> Result<(Vec<u8>, Vec<u8>, Option<i32>), String> {
    configure_hidden_process(&mut command);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("markdown.run.spawn_failed: {e}"))?;
    let start = Instant::now();
    loop {
        if let Some(status) = child.try_wait().map_err(|e| e.to_string())? {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut stream) = child.stdout.take() {
                let _ = stream.read_to_end(&mut stdout);
            }
            if let Some(mut stream) = child.stderr.take() {
                let _ = stream.read_to_end(&mut stderr);
            }
            return Ok((stdout, stderr, status.code()));
        }
        if start.elapsed() > RUN_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err("markdown.run.timeout".to_string());
        }
        std::thread::sleep(Duration::from_millis(40));
    }
}

fn find_executable(names: &[&str]) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        for name in names {
            let candidate = dir.join(name);
            if candidate.is_file() {
                return Some(candidate);
            }
        }
    }
    None
}

fn run_python(state: &AppState, input: &MarkdownRunCodeInput, run_dir: &Path) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let env_status = ensure_analysis_env_blocking(
        &state.db_path,
        &state.runtime_root,
        &state.app_data_dir,
        &input.project_id,
        &project_root,
    )?;
    let python_path = PathBuf::from(
        env_status
            .python_path
            .ok_or_else(|| "python.env.python_missing".to_string())?,
    );
    let script = run_dir.join("snippet.py");
    fs::write(&script, &input.code).map_err(|e| e.to_string())?;
    let mut command = Command::new(&python_path);
    command.current_dir(project_root).arg(script);
    let (stdout, stderr, exit_code) = command_output_with_timeout(command)?;
    Ok((stdout, stderr, exit_code, python_path.to_string_lossy().to_string()))
}

fn run_c_family(input: &MarkdownRunCodeInput, language: &str, run_dir: &Path) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let compiler = if language == "c" {
        find_executable(&["clang.exe", "gcc.exe", "cl.exe"])
    } else {
        find_executable(&["clang++.exe", "g++.exe", "cl.exe"])
    }
    .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let source = run_dir.join(if language == "c" { "snippet.c" } else { "snippet.cpp" });
    let binary = run_dir.join("snippet.exe");
    fs::write(&source, &input.code).map_err(|e| e.to_string())?;
    let mut compile = Command::new(&compiler);
    if compiler.file_name().and_then(|value| value.to_str()) == Some("cl.exe") {
        compile.current_dir(run_dir).arg("/nologo").arg(&source).arg(format!("/Fe:{}", binary.to_string_lossy()));
    } else {
        compile.current_dir(run_dir).arg(&source).arg("-O0").arg("-o").arg(&binary);
    }
    let (compile_out, compile_err, compile_code) = command_output_with_timeout(compile)?;
    if compile_code != Some(0) {
        return Ok((compile_out, compile_err, compile_code, compiler.to_string_lossy().to_string()));
    }
    let mut run = Command::new(&binary);
    run.current_dir(run_dir);
    let (stdout, stderr, exit_code) = command_output_with_timeout(run)?;
    Ok((stdout, stderr, exit_code, compiler.to_string_lossy().to_string()))
}

#[tauri::command]
pub async fn markdown_run_code(
    state: State<'_, AppState>,
    input: MarkdownRunCodeInput,
) -> Result<MarkdownRunCodeResponse, String> {
    state.log(
        "INFO",
        &format!(
            "markdown_run_code: project={}, path={}, language={}",
            input.project_id,
            input.relative_path.as_deref().unwrap_or("-"),
            input.language
        ),
    );
    if input.code.len() > MAX_CODE_BYTES {
        return Err("markdown.run.code_too_large".to_string());
    }
    let state_snapshot = state.inner().clone();
    spawn_blocking(move || {
        let language = normalize_language(&input.language);
        if !matches!(language.as_str(), "python" | "c" | "cpp") {
            return Err("markdown.run.language_unsupported".to_string());
        }
        let run_dir = state_snapshot
            .runtime_root
            .join("markdown-runs")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
        let started = Instant::now();
        let result = if language == "python" {
            run_python(&state_snapshot, &input, &run_dir)
        } else {
            run_c_family(&input, &language, &run_dir)
        };
        let _ = fs::remove_dir_all(&run_dir);
        let (stdout_raw, stderr_raw, exit_code, runner) = result?;
        let (stdout, stdout_truncated) = clamp_text(&stdout_raw);
        let (stderr, stderr_truncated) = clamp_text(&stderr_raw);
        Ok(MarkdownRunCodeResponse {
            language,
            status: if exit_code == Some(0) { "completed".to_string() } else { "failed".to_string() },
            stdout,
            stderr,
            exit_code,
            duration_ms: started.elapsed().as_millis(),
            truncated: stdout_truncated || stderr_truncated,
            runner,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
