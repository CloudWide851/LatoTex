use crate::models::{
    AnalysisEnvStatusResponse, AnalysisRunPythonInput, AnalysisRunPythonResponse, LatexCompileInput,
    LatexCompileResponse,
};
use crate::state::AppState;
use crate::storage;
use std::fs;
use std::path::{Component, Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

fn configure_hidden_process(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

fn safe_relative_path(input: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for component in Path::new(input).components() {
        match component {
            Component::Normal(value) => out.push(value),
            Component::CurDir => {}
            _ => return Err(format!("Unsupported relative path: {input}")),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("Relative path cannot be empty".to_string());
    }
    Ok(out)
}

fn sanitize_log_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if line.is_empty() {
            continue;
        }
        if line.starts_with("This is ") || line.starts_with("entering extended mode") {
            continue;
        }
        if lines.iter().any(|item: &String| item == line) {
            continue;
        }
        lines.push(line.to_string());
    }
    lines.truncate(24);
    lines
}

fn try_version_command(program: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    configure_hidden_process(&mut command);
    command.args(args);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        }
    } else {
        Some(stdout)
    }
}

fn command_from_path_or_name(value: &str) -> PathBuf {
    PathBuf::from(value)
}

fn resolve_uv_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/tools/uv/windows-x64/uv.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/resources/tools/uv/windows-x64/uv.exe"),
    ];
    for candidate in candidates {
        if candidate.exists() {
            return Some(candidate);
        }
    }
    if let Some(version) = try_version_command(&command_from_path_or_name("uv"), &["--version"]) {
        if !version.is_empty() {
            return Some(PathBuf::from("uv"));
        }
    }
    None
}

fn resolve_analysis_runtime_root() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/python/analysis_runtime"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../src-tauri/resources/python/analysis_runtime"),
    ];
    candidates.into_iter().find(|candidate| candidate.join("analysis_runner.py").exists())
}

fn venv_root(project_root: &Path) -> PathBuf {
    project_root.join(".venv")
}

fn venv_python_path(project_root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return venv_root(project_root).join("Scripts/python.exe");
    }
    #[cfg(not(target_os = "windows"))]
    {
        venv_root(project_root).join("bin/python")
    }
}

fn ensure_analysis_env_blocking(project_root: &Path) -> Result<AnalysisEnvStatusResponse, String> {
    let runtime_root = resolve_analysis_runtime_root()
        .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
    let uv_path = resolve_uv_path().ok_or_else(|| "uv executable was not found".to_string())?;
    let venv_path = venv_root(project_root);
    let python_path = venv_python_path(project_root);

    if !python_path.exists() {
        fs::create_dir_all(project_root).map_err(|e| e.to_string())?;
        let mut command = Command::new(&uv_path);
        configure_hidden_process(&mut command);
        let output = command
            .arg("venv")
            .arg(&venv_path)
            .arg("--python")
            .arg("3.12")
            .output()
            .map_err(|e| format!("python.env.spawn_failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("python.env.prepare_failed: {detail}"));
        }
    }

    let uv_version = try_version_command(&uv_path, &["--version"]);
    let python_version = try_version_command(&python_path, &["--version"]);

    Ok(AnalysisEnvStatusResponse {
        ready: python_path.exists(),
        uv_path: Some(uv_path.to_string_lossy().to_string()),
        uv_version,
        python_path: Some(python_path.to_string_lossy().to_string()),
        python_version,
        venv_path: venv_path.to_string_lossy().to_string(),
        runtime_root: runtime_root.to_string_lossy().to_string(),
        last_error: None,
    })
}

fn latex_tool_exists(name: &str) -> bool {
    try_version_command(&command_from_path_or_name(name), &["--version"]).is_some()
}

fn detect_latex_engine(prefer_engine: Option<&str>) -> String {
    let preferred = prefer_engine.unwrap_or("tectonic").trim().to_lowercase();
    if preferred == "tectonic" && latex_tool_exists("tectonic") {
        return "tectonic".to_string();
    }
    if latex_tool_exists("latexmk") {
        return "latexmk".to_string();
    }
    if latex_tool_exists("xelatex") {
        return "xelatex".to_string();
    }
    if latex_tool_exists("pdflatex") {
        return "pdflatex".to_string();
    }
    "missing".to_string()
}

fn write_compile_workspace(root: &Path, file_map: &std::collections::HashMap<String, String>, main_path: &str, entry_content: &str) -> Result<(), String> {
    for (relative, content) in file_map {
        let target = root.join(safe_relative_path(relative)?);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(target, content).map_err(|e| e.to_string())?;
    }
    let main_target = root.join(safe_relative_path(main_path)?);
    if let Some(parent) = main_target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(main_target, entry_content).map_err(|e| e.to_string())?;
    Ok(())
}

fn copy_if_exists(source: &Path, target: &Path) -> Result<Option<String>, String> {
    if !source.exists() {
        return Ok(None);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().replace('\\', "/")))
}

fn run_compile_command(engine: &str, run_root: &Path, main_path: &str) -> Result<(std::process::Output, Option<std::process::Output>), String> {
    let mut command = match engine {
        "tectonic" => {
            let mut command = Command::new("tectonic");
            command.arg("-X").arg("compile").arg(main_path);
            command
        }
        "latexmk" => {
            let mut command = Command::new("latexmk");
            command
                .arg("-xelatex")
                .arg("-interaction=nonstopmode")
                .arg("-file-line-error")
                .arg("-halt-on-error")
                .arg(main_path);
            command
        }
        "xelatex" => {
            let mut command = Command::new("xelatex");
            command
                .arg("-interaction=nonstopmode")
                .arg("-file-line-error")
                .arg("-halt-on-error")
                .arg(main_path);
            command
        }
        "pdflatex" => {
            let mut command = Command::new("pdflatex");
            command
                .arg("-interaction=nonstopmode")
                .arg("-file-line-error")
                .arg("-halt-on-error")
                .arg(main_path);
            command
        }
        _ => return Err("compile.engine.missing".to_string()),
    };
    configure_hidden_process(&mut command);
    command.current_dir(run_root);
    let first = command.output().map_err(|e| format!("compile.spawn_failed: {e}"))?;

    if engine == "xelatex" || engine == "pdflatex" {
        let mut second = Command::new(engine);
        configure_hidden_process(&mut second);
        second
            .current_dir(run_root)
            .arg("-interaction=nonstopmode")
            .arg("-file-line-error")
            .arg("-halt-on-error")
            .arg(main_path);
        let second_output = second.output().map_err(|e| format!("compile.spawn_failed: {e}"))?;
        return Ok((first, Some(second_output)));
    }

    Ok((first, None))
}

fn compile_blocking(db_path: &Path, input: LatexCompileInput) -> Result<LatexCompileResponse, String> {
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    let compile_root = project_root.join(".latotex/build/native");
    let run_id = Uuid::new_v4().to_string();
    let run_root = compile_root.join(&run_id);
    fs::create_dir_all(&run_root).map_err(|e| e.to_string())?;

    write_compile_workspace(&run_root, &input.file_map, &input.main_path, &input.entry_content)?;

    let normalized_main = safe_relative_path(&input.main_path)?;
    let main_pdf = run_root.join(&normalized_main).with_extension("pdf");
    let main_log = run_root.join(&normalized_main).with_extension("log");
    let artifact_root = project_root.join(".latotex/build/native-output");
    let artifact_pdf = artifact_root.join(&normalized_main).with_extension("pdf");
    let artifact_log = artifact_root.join(&normalized_main).with_extension("log");
    let engine = detect_latex_engine(input.prefer_engine.as_deref());
    if engine == "missing" {
        return Ok(LatexCompileResponse {
            status: "error".to_string(),
            engine,
            diagnostics: vec!["No native LaTeX engine found. Install tectonic, latexmk, xelatex, or pdflatex.".to_string()],
            duration_ms: 0,
            pdf_relative_path: None,
            log_relative_path: None,
            pdf_bytes: None,
            used_fallback_fonts: Vec::new(),
            recovered_packages: Vec::new(),
        });
    }

    let started = Instant::now();
    let (first_output, second_output) = run_compile_command(&engine, &run_root, &normalized_main.to_string_lossy())?;
    let duration_ms = started.elapsed().as_millis() as u64;
    let mut combined_log = String::new();
    combined_log.push_str(&String::from_utf8_lossy(&first_output.stdout));
    combined_log.push('\n');
    combined_log.push_str(&String::from_utf8_lossy(&first_output.stderr));
    if let Some(extra) = &second_output {
        combined_log.push('\n');
        combined_log.push_str(&String::from_utf8_lossy(&extra.stdout));
        combined_log.push('\n');
        combined_log.push_str(&String::from_utf8_lossy(&extra.stderr));
    }
    if main_log.exists() {
        let log_text = fs::read_to_string(&main_log).unwrap_or_default();
        if !log_text.is_empty() {
            combined_log.push('\n');
            combined_log.push_str(&log_text);
        }
    }

    let diagnostics = sanitize_log_lines(&combined_log);
    let success = main_pdf.exists()
        && first_output.status.success()
        && second_output.as_ref().map(|item| item.status.success()).unwrap_or(true);

    let pdf_relative_path = copy_if_exists(&main_pdf, &artifact_pdf)?
        .map(|full| full.replace(project_root.to_string_lossy().as_ref(), "").trim_start_matches('/').to_string());
    let log_relative_path = copy_if_exists(&main_log, &artifact_log)?
        .map(|full| full.replace(project_root.to_string_lossy().as_ref(), "").trim_start_matches('/').to_string());
    let pdf_bytes = if success {
        Some(fs::read(&main_pdf).map_err(|e| e.to_string())?)
    } else {
        None
    };

    Ok(LatexCompileResponse {
        status: if success { "success".to_string() } else { "error".to_string() },
        engine,
        diagnostics,
        duration_ms,
        pdf_relative_path,
        log_relative_path,
        pdf_bytes,
        used_fallback_fonts: Vec::new(),
        recovered_packages: Vec::new(),
    })
}

#[tauri::command]
pub async fn latex_compile_native(
    state: State<'_, AppState>,
    input: LatexCompileInput,
) -> Result<LatexCompileResponse, String> {
    let reason = input.reason.clone().unwrap_or_else(|| "manual".to_string());
    state.log(
        "INFO",
        &format!(
            "latex_compile_native: project={}, file={}, reason={}",
            input.project_id, input.main_path, reason
        ),
    );

    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || compile_blocking(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn analysis_env_prepare(
    state: State<'_, AppState>,
    input: crate::models::ProjectRefInput,
) -> Result<AnalysisEnvStatusResponse, String> {
    state.log("INFO", &format!("analysis_env_prepare: project={}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &project_id)?;
        ensure_analysis_env_blocking(&project_root)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn analysis_env_status(
    state: State<'_, AppState>,
    input: crate::models::ProjectRefInput,
) -> Result<AnalysisEnvStatusResponse, String> {
    state.log("INFO", &format!("analysis_env_status: project={}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &project_id)?;
        match ensure_analysis_env_blocking(&project_root) {
            Ok(status) => Ok(status),
            Err(error) => Ok(AnalysisEnvStatusResponse {
                ready: false,
                uv_path: resolve_uv_path().map(|path| path.to_string_lossy().to_string()),
                uv_version: resolve_uv_path().and_then(|path| try_version_command(&path, &["--version"])),
                python_path: None,
                python_version: None,
                venv_path: venv_root(&project_root).to_string_lossy().to_string(),
                runtime_root: resolve_analysis_runtime_root()
                    .map(|path| path.to_string_lossy().to_string())
                    .unwrap_or_default(),
                last_error: Some(error),
            }),
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn analysis_run_python(
    state: State<'_, AppState>,
    input: AnalysisRunPythonInput,
) -> Result<AnalysisRunPythonResponse, String> {
    state.log(
        "INFO",
        &format!(
            "analysis_run_python: project={}, task={}, snapshots={}",
            input.project_id,
            input.task_id.as_deref().unwrap_or("-"),
            input.snapshots.len()
        ),
    );
    let db_path = state.db_path.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &input.project_id)?;
        let env_status = ensure_analysis_env_blocking(&project_root)?;
        let python_path = PathBuf::from(
            env_status
                .python_path
                .clone()
                .ok_or_else(|| "python.env.python_missing".to_string())?,
        );
        let runtime_root = resolve_analysis_runtime_root()
            .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
        let run_root = project_root.join(".latotex/analysis-runtime").join(
            input
                .task_id
                .clone()
                .unwrap_or_else(|| Uuid::new_v4().to_string()),
        );
        fs::create_dir_all(&run_root).map_err(|e| e.to_string())?;
        let input_path = run_root.join("input.json");
        let output_path = run_root.join("output.json");
        let payload = serde_json::to_string_pretty(&input).map_err(|e| e.to_string())?;
        fs::write(&input_path, payload).map_err(|e| e.to_string())?;

        let mut command = Command::new(&python_path);
        configure_hidden_process(&mut command);
        let output = command
            .arg(runtime_root.join("analysis_runner.py"))
            .arg("--input")
            .arg(&input_path)
            .arg("--output")
            .arg(&output_path)
            .output()
            .map_err(|e| format!("python.run.spawn_failed: {e}"))?;
        let stdout = String::from_utf8_lossy(&output.stdout).to_string();
        let stderr = String::from_utf8_lossy(&output.stderr).to_string();
        let output_json = if output_path.exists() {
            fs::read_to_string(&output_path).map_err(|e| e.to_string())?
        } else {
            String::new()
        };
        if !output.status.success() {
            let diagnostics = sanitize_log_lines(&format!("{}\n{}", stdout, stderr));
            return Err(format!(
                "python.run.failed: {}",
                diagnostics.first().cloned().unwrap_or_else(|| "analysis runner failed".to_string())
            ));
        }
        let profile_json = if output_json.trim().is_empty() {
            serde_json::json!({
                "runtimeSource": "uv",
                "status": "empty"
            })
        } else {
            serde_json::from_str(&output_json).map_err(|e| format!("python.run.invalid_json: {e}"))?
        };

        Ok(AnalysisRunPythonResponse {
            status: "completed".to_string(),
            runtime_source: "uv".to_string(),
            python_path: python_path.to_string_lossy().to_string(),
            venv_path: env_status.venv_path,
            stdout: stdout.trim().to_string(),
            stderr: stderr.trim().to_string(),
            diagnostics: sanitize_log_lines(&format!("{}\n{}", stdout, stderr)),
            profile_json,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}
