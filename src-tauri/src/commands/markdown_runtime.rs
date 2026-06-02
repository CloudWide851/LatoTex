use crate::commands::native_runtime::configure_hidden_process;
use crate::commands::toolchains::{
    find_local_toolchain_executable, find_local_toolchain_executable_from_names,
    find_managed_toolchain_executable,
};
use crate::models::{MarkdownRunCodeCapability, MarkdownRunCodeInput, MarkdownRunCodeResponse};
use crate::state::AppState;
use crate::storage;
use std::fs;
use std::io::Read;
use std::path::Path;
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
        "golang" => "go".to_string(),
        "rs" => "rust".to_string(),
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

fn run_python(state: &AppState, input: &MarkdownRunCodeInput, run_dir: &Path) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let python_path = find_managed_toolchain_executable(&["python"], &["python.exe", "Scripts/python.exe", "bin/python.exe"], &state.runtime_root)
        .or_else(|| find_local_toolchain_executable("python"))
        .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let script = run_dir.join("snippet.py");
    fs::write(&script, &input.code).map_err(|e| e.to_string())?;
    let mut command = Command::new(&python_path);
    command.current_dir(project_root).arg(script);
    let (stdout, stderr, exit_code) = command_output_with_timeout(command)?;
    Ok((stdout, stderr, exit_code, python_path.to_string_lossy().to_string()))
}

fn run_c_family(
    input: &MarkdownRunCodeInput,
    language: &str,
    run_dir: &Path,
    runtime_root: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let compiler = if language == "c" {
        find_managed_toolchain_executable(&["c"], &["llvm-mingw-20260519-ucrt-x86_64/bin/clang.exe", "bin/clang.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable("c"))
    } else {
        find_managed_toolchain_executable(&["cpp"], &["llvm-mingw-20260519-ucrt-x86_64/bin/clang++.exe", "bin/clang++.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable("cpp"))
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

fn run_go(
    input: &MarkdownRunCodeInput,
    run_dir: &Path,
    runtime_root: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let runner = find_managed_toolchain_executable(&["go"], &["go/bin/go.exe", "bin/go.exe", "go.exe"], runtime_root)
        .or_else(|| find_local_toolchain_executable_from_names(&["go.exe"]))
        .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let source = run_dir.join("snippet.go");
    fs::write(&source, &input.code).map_err(|e| e.to_string())?;
    let mut command = Command::new(&runner);
    command.current_dir(run_dir).arg("run").arg(&source);
    let (stdout, stderr, exit_code) = command_output_with_timeout(command)?;
    Ok((stdout, stderr, exit_code, runner.to_string_lossy().to_string()))
}

fn run_rust(
    input: &MarkdownRunCodeInput,
    run_dir: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let compiler = find_local_toolchain_executable_from_names(&["rustc.exe"])
        .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let source = run_dir.join("snippet.rs");
    let binary = run_dir.join("snippet.exe");
    fs::write(&source, &input.code).map_err(|e| e.to_string())?;
    let mut compile = Command::new(&compiler);
    compile.current_dir(run_dir).arg(&source).arg("-o").arg(&binary);
    let (compile_out, compile_err, compile_code) = command_output_with_timeout(compile)?;
    if compile_code != Some(0) {
        return Ok((compile_out, compile_err, compile_code, compiler.to_string_lossy().to_string()));
    }
    let mut run = Command::new(&binary);
    run.current_dir(run_dir);
    let (stdout, stderr, exit_code) = command_output_with_timeout(run)?;
    Ok((stdout, stderr, exit_code, compiler.to_string_lossy().to_string()))
}

fn run_zig(
    input: &MarkdownRunCodeInput,
    run_dir: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let runner = find_local_toolchain_executable_from_names(&["zig.exe"])
        .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let source = run_dir.join("snippet.zig");
    fs::write(&source, &input.code).map_err(|e| e.to_string())?;
    let mut command = Command::new(&runner);
    command.current_dir(run_dir).arg("run").arg(&source);
    let (stdout, stderr, exit_code) = command_output_with_timeout(command)?;
    Ok((stdout, stderr, exit_code, runner.to_string_lossy().to_string()))
}

fn capability_for_language(runtime_root: &Path, language: &str) -> MarkdownRunCodeCapability {
    let executable = match language {
        "python" => find_managed_toolchain_executable(&["python"], &["python.exe", "Scripts/python.exe", "bin/python.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable("python")),
        "c" => find_managed_toolchain_executable(&["c"], &["llvm-mingw-20260519-ucrt-x86_64/bin/clang.exe", "bin/clang.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable("c")),
        "cpp" => find_managed_toolchain_executable(&["cpp"], &["llvm-mingw-20260519-ucrt-x86_64/bin/clang++.exe", "bin/clang++.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable("cpp")),
        "go" => find_managed_toolchain_executable(&["go"], &["go/bin/go.exe", "bin/go.exe", "go.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable_from_names(&["go.exe"])),
        "rust" => find_managed_toolchain_executable(&["rust"], &["rustc.exe", "bin/rustc.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable_from_names(&["rustc.exe"])),
        "zig" => find_managed_toolchain_executable(&["zig"], &["zig.exe", "bin/zig.exe"], runtime_root)
            .or_else(|| find_local_toolchain_executable_from_names(&["zig.exe"])),
        _ => None,
    };
    MarkdownRunCodeCapability {
        language: language.to_string(),
        available: executable.is_some(),
        runner: executable.as_ref().map(|path| path.to_string_lossy().to_string()),
        message: if executable.is_some() {
            "markdown.run.toolchain_ready".to_string()
        } else {
            "markdown.run.toolchain_missing".to_string()
        },
    }
}

#[tauri::command]
pub async fn markdown_run_code_capabilities(
    state: State<'_, AppState>,
) -> Result<Vec<MarkdownRunCodeCapability>, String> {
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || {
        Ok(vec![
            capability_for_language(&runtime_root, "python"),
            capability_for_language(&runtime_root, "c"),
            capability_for_language(&runtime_root, "cpp"),
            capability_for_language(&runtime_root, "go"),
            capability_for_language(&runtime_root, "rust"),
            capability_for_language(&runtime_root, "zig"),
        ])
    })
    .await
    .map_err(|e| e.to_string())?
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
        if !matches!(language.as_str(), "python" | "c" | "cpp" | "go" | "rust" | "zig") {
            return Err("markdown.run.language_unsupported".to_string());
        }
        let run_dir = state_snapshot
            .runtime_root
            .join("markdown-runs")
            .join(Uuid::new_v4().to_string());
        fs::create_dir_all(&run_dir).map_err(|e| e.to_string())?;
        let started = Instant::now();
        let result = match language.as_str() {
            "python" => run_python(&state_snapshot, &input, &run_dir),
            "c" | "cpp" => run_c_family(&input, &language, &run_dir, &state_snapshot.runtime_root),
            "go" => run_go(&input, &run_dir, &state_snapshot.runtime_root),
            "rust" => run_rust(&input, &run_dir),
            "zig" => run_zig(&input, &run_dir),
            _ => Err("markdown.run.language_unsupported".to_string()),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalizes_markdown_runner_languages() {
        assert_eq!(normalize_language("py"), "python");
        assert_eq!(normalize_language("c++"), "cpp");
        assert_eq!(normalize_language("golang"), "go");
        assert_eq!(normalize_language("rs"), "rust");
    }

    #[test]
    fn capability_probe_reports_requested_language_without_preparing_env() {
        let capability = capability_for_language(Path::new("target/nonexistent-runtime-root"), "python");
        assert_eq!(capability.language, "python");
        assert!(matches!(
            capability.message.as_str(),
            "markdown.run.toolchain_ready" | "markdown.run.toolchain_missing"
        ));
    }
}
