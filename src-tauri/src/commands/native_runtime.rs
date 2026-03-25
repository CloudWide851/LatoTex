use crate::models::{
    AnalysisEnvStatusResponse, AnalysisRunPythonInput, AnalysisRunPythonResponse,
    LatexCompileInput, LatexCompileResponse,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use ring::digest::{digest, SHA256};
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

pub(crate) fn configure_hidden_process(command: &mut Command) {
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

fn is_noise_log_line(line: &str) -> bool {
    let normalized = line.trim();
    normalized.is_empty()
        || normalized.starts_with("This is ")
        || normalized.starts_with("entering extended mode")
        || normalized.starts_with("Initial Win CP for")
        || normalized.starts_with("I changed them all to CP")
        || normalized.starts_with("Rc files read:")
        || normalized.starts_with("Latexmk: This is Latexmk")
        || normalized.starts_with("No existing .aux file")
}

fn sanitize_log_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if is_noise_log_line(line) {
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

pub(crate) fn resolve_uv_path() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/tools/uv/windows-x64/uv.exe"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/resources/tools/uv/windows-x64/uv.exe"),
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

pub(crate) fn resolve_analysis_runtime_root() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/python/analysis_runtime"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/resources/python/analysis_runtime"),
    ];
    candidates
        .into_iter()
        .find(|candidate| candidate.join("analysis_runner.py").exists())
}

pub(crate) fn resolve_pdfmathtranslate_vendor_root() -> Option<PathBuf> {
    let candidates = [
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/python/vendor/pdf2zh"),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join("../src-tauri/resources/python/vendor/pdf2zh"),
    ];
    candidates.into_iter().find(|candidate| {
        candidate.join("pyproject.toml").exists() && candidate.join("pdf2zh/__init__.py").exists()
    })
}

pub(crate) fn managed_analysis_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("python-envs")
}

fn normalized_project_root(project_root: &Path) -> Result<String, String> {
    let canonical = project_root.canonicalize().map_err(|e| e.to_string())?;
    let text = canonical.to_string_lossy().replace('\\', "/");
    #[cfg(target_os = "windows")]
    {
        return Ok(text.to_lowercase());
    }
    #[cfg(not(target_os = "windows"))]
    {
        Ok(text)
    }
}

fn hex_digest(bytes: &[u8]) -> String {
    bytes
        .iter()
        .map(|value| format!("{value:02x}"))
        .collect::<String>()
}

pub(crate) fn project_env_key(project_root: &Path) -> Result<String, String> {
    let normalized = normalized_project_root(project_root)?;
    let hashed = digest(&SHA256, normalized.as_bytes());
    Ok(hex_digest(&hashed.as_ref()[..12]))
}

struct ResolvedAnalysisEnvPaths {
    env_key: String,
    managed_root: PathBuf,
    venv_path: PathBuf,
    python_path: PathBuf,
}

fn configured_analysis_base_root(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
) -> Option<PathBuf> {
    let settings = storage::load_settings(db_path, runtime_root).ok()?;
    let raw = settings
        .ui_prefs?
        .analysis_env_roots_by_project?
        .get(project_id)?
        .trim()
        .to_string();
    if raw.is_empty() {
        return None;
    }
    let path = PathBuf::from(raw);
    if path.is_absolute() {
        Some(path)
    } else {
        None
    }
}

fn venv_python_path_from_venv_root(root: &Path) -> PathBuf {
    #[cfg(target_os = "windows")]
    {
        return root.join("Scripts/python.exe");
    }
    #[cfg(not(target_os = "windows"))]
    {
        root.join("bin/python")
    }
}

fn resolve_analysis_env_paths(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
) -> Result<ResolvedAnalysisEnvPaths, String> {
    let env_key = project_env_key(project_root)?;
    let base_root = configured_analysis_base_root(db_path, runtime_root, project_id)
        .unwrap_or_else(|| managed_analysis_root(app_data_dir));
    let managed_root = base_root.join(&env_key);
    let venv_path = managed_root.join("venv");
    let python_path = venv_python_path_from_venv_root(&venv_path);
    Ok(ResolvedAnalysisEnvPaths {
        env_key,
        managed_root,
        venv_path,
        python_path,
    })
}

fn append_fingerprint_entries(
    root: &Path,
    prefix: &Path,
    entries: &mut Vec<String>,
) -> Result<(), String> {
    let mut items = fs::read_dir(root)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    items.sort_by_key(|item| item.file_name());
    for item in items {
        let path = item.path();
        if path.is_dir() {
            append_fingerprint_entries(&path, prefix, entries)?;
            continue;
        }
        let relative = path
            .strip_prefix(prefix)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        let digest_value = digest(&SHA256, &bytes);
        entries.push(format!(
            "{relative}:{}:{}",
            bytes.len(),
            hex_digest(digest_value.as_ref())
        ));
    }
    Ok(())
}

fn runtime_dependency_fingerprint(
    runtime_root: &Path,
    vendor_root: Option<&Path>,
) -> Result<String, String> {
    let mut entries = Vec::<String>::new();
    append_fingerprint_entries(runtime_root, runtime_root, &mut entries)?;
    if let Some(vendor_root) = vendor_root {
        append_fingerprint_entries(vendor_root, vendor_root, &mut entries)?;
    }
    let joined = entries.join("\n");
    Ok(hex_digest(digest(&SHA256, joined.as_bytes()).as_ref()))
}

fn runtime_dependency_stamp_path(managed_root: &Path) -> PathBuf {
    managed_root.join(".latotex-runtime-stamp")
}

fn python_module_version(python_path: &Path, package_name: &str) -> Option<String> {
    let mut command = Command::new(python_path);
    configure_hidden_process(&mut command);
    let output = command
        .arg("-c")
        .arg(format!(
            "import importlib.metadata as m; print(m.version({package_name:?}))"
        ))
        .output()
        .ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        None
    } else {
        Some(stdout)
    }
}

fn install_python_package(
    uv_path: &Path,
    python_path: &Path,
    package_spec: &Path,
    editable: bool,
) -> Result<(), String> {
    let mut command = Command::new(uv_path);
    configure_hidden_process(&mut command);
    command
        .arg("pip")
        .arg("install")
        .arg("--python")
        .arg(python_path);
    if editable {
        command.arg("-e");
    }
    let output = command
        .arg(package_spec)
        .output()
        .map_err(|e| format!("python.env.install_spawn_failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("python.env.install_failed: {detail}"));
    }
    Ok(())
}

fn install_python_requirement(
    uv_path: &Path,
    python_path: &Path,
    requirement: &str,
) -> Result<(), String> {
    let mut command = Command::new(uv_path);
    configure_hidden_process(&mut command);
    let output = command
        .arg("pip")
        .arg("install")
        .arg("--python")
        .arg(python_path)
        .arg(requirement)
        .output()
        .map_err(|e| format!("python.env.install_spawn_failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("python.env.install_failed: {detail}"));
    }
    Ok(())
}

fn ensure_runtime_packages(
    uv_path: &Path,
    python_path: &Path,
    runtime_root: &Path,
    vendor_root: Option<&Path>,
    managed_root: &Path,
) -> Result<(), String> {
    let fingerprint = runtime_dependency_fingerprint(runtime_root, vendor_root)?;
    let stamp_path = runtime_dependency_stamp_path(managed_root);
    if fs::read_to_string(&stamp_path).ok().as_deref() == Some(fingerprint.as_str()) {
        return Ok(());
    }

    if let Some(vendor_root) = vendor_root {
        install_python_package(uv_path, python_path, vendor_root, false)?;
    } else {
        install_python_requirement(uv_path, python_path, "pdf2zh>=1.9.11,<2")?;
    }
    install_python_package(uv_path, python_path, runtime_root, true)?;
    fs::write(stamp_path, fingerprint).map_err(|e| e.to_string())?;
    Ok(())
}

fn runtime_packages_ready(
    runtime_root: &Path,
    vendor_root: Option<&Path>,
    managed_root: &Path,
    python_path: &Path,
) -> Result<bool, String> {
    if !python_path.exists() {
        return Ok(false);
    }
    let fingerprint = runtime_dependency_fingerprint(runtime_root, vendor_root)?;
    let stamp_matches = fs::read_to_string(runtime_dependency_stamp_path(managed_root))
        .ok()
        .map(|value| value.trim().to_string())
        .as_deref()
        == Some(fingerprint.as_str());
    if !stamp_matches {
        return Ok(false);
    }
    Ok(python_module_version(python_path, "pdf2zh").is_some())
}

fn build_env_status(
    env_paths: &ResolvedAnalysisEnvPaths,
    runtime_root: &Path,
    vendor_root: Option<&Path>,
    uv_path: Option<&Path>,
    last_error: Option<String>,
) -> Result<AnalysisEnvStatusResponse, String> {
    let exists = env_paths.managed_root.exists() || env_paths.venv_path.exists();
    let python_exists = env_paths.python_path.exists();
    let ready = runtime_packages_ready(
        runtime_root,
        vendor_root,
        &env_paths.managed_root,
        &env_paths.python_path,
    )
    .unwrap_or(false);
    let uv_version = uv_path.and_then(|path| try_version_command(path, &["--version"]));
    let python_version = if python_exists {
        try_version_command(&env_paths.python_path, &["--version"])
    } else {
        None
    };
    let pdf_math_translate_version = if python_exists {
        python_module_version(&env_paths.python_path, "pdf2zh")
    } else {
        None
    };

    Ok(AnalysisEnvStatusResponse {
        ready,
        exists,
        env_key: env_paths.env_key.clone(),
        managed_root: env_paths.managed_root.to_string_lossy().to_string(),
        uv_path: uv_path.map(|path| path.to_string_lossy().to_string()),
        uv_version,
        python_path: if python_exists {
            Some(env_paths.python_path.to_string_lossy().to_string())
        } else {
            None
        },
        python_version,
        pdf_math_translate_version,
        venv_path: env_paths.venv_path.to_string_lossy().to_string(),
        runtime_root: runtime_root.to_string_lossy().to_string(),
        last_error,
    })
}

pub(crate) fn analysis_env_status_blocking(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
) -> Result<AnalysisEnvStatusResponse, String> {
    let analysis_runtime_root = resolve_analysis_runtime_root()
        .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
    let vendor_root = resolve_pdfmathtranslate_vendor_root();
    let uv_path = resolve_uv_path();
    let env_paths = resolve_analysis_env_paths(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        project_root,
    )?;
    let last_error = if env_paths.python_path.exists() {
        None
    } else {
        Some("python.env.not_prepared".to_string())
    };
    let mut status = build_env_status(
        &env_paths,
        &analysis_runtime_root,
        vendor_root.as_deref(),
        uv_path.as_deref(),
        last_error,
    )?;
    if !status.ready && status.last_error.is_none() {
        status.last_error = Some("python.env.runtime_missing".to_string());
    }
    Ok(status)
}

pub(crate) fn ensure_analysis_env_blocking(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
) -> Result<AnalysisEnvStatusResponse, String> {
    let analysis_runtime_root = resolve_analysis_runtime_root()
        .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
    let vendor_root = resolve_pdfmathtranslate_vendor_root();
    let uv_path = resolve_uv_path().ok_or_else(|| "uv executable was not found".to_string())?;
    let env_paths = resolve_analysis_env_paths(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        project_root,
    )?;

    if !env_paths.python_path.exists() {
        fs::create_dir_all(&env_paths.managed_root).map_err(|e| e.to_string())?;
        let mut command = Command::new(&uv_path);
        configure_hidden_process(&mut command);
        let output = command
            .arg("venv")
            .arg(&env_paths.venv_path)
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

    ensure_runtime_packages(
        &uv_path,
        &env_paths.python_path,
        &analysis_runtime_root,
        vendor_root.as_deref(),
        &env_paths.managed_root,
    )?;
    build_env_status(
        &env_paths,
        &analysis_runtime_root,
        vendor_root.as_deref(),
        Some(&uv_path),
        None,
    )
}
fn latex_tool_exists(name: &str) -> bool {
    try_version_command(&command_from_path_or_name(name), &["--version"]).is_some()
}

fn detect_latex_engine(_prefer_engine: Option<&str>) -> String {
    if latex_tool_exists("tectonic") {
        return "tectonic".to_string();
    }
    "missing".to_string()
}

fn write_compile_workspace(
    root: &Path,
    file_map: &std::collections::HashMap<String, String>,
    main_path: &str,
    entry_content: &str,
) -> Result<(), String> {
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

fn run_compile_command(
    engine: &str,
    run_root: &Path,
    main_path: &str,
) -> Result<(std::process::Output, Option<std::process::Output>), String> {
    if engine != "tectonic" {
        return Err("compile.engine.missing".to_string());
    }
    let mut command = Command::new("tectonic");
    command.arg("-X").arg("compile").arg(main_path);
    configure_hidden_process(&mut command);
    command.current_dir(run_root);
    let output = command
        .output()
        .map_err(|e| format!("compile.spawn_failed: {e}"))?;
    Ok((output, None))
}

fn compile_blocking(
    db_path: &Path,
    input: LatexCompileInput,
) -> Result<LatexCompileResponse, String> {
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    let compile_root = project_root.join(".latotex/build/native");
    let run_id = Uuid::new_v4().to_string();
    let run_root = compile_root.join(&run_id);
    fs::create_dir_all(&run_root).map_err(|e| e.to_string())?;

    write_compile_workspace(
        &run_root,
        &input.file_map,
        &input.main_path,
        &input.entry_content,
    )?;

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
            diagnostics: vec![
                "Tectonic was not found. Install Tectonic and retry."
                    .to_string(),
            ],
            duration_ms: 0,
            pdf_relative_path: None,
            log_relative_path: None,
            pdf_bytes: None,
            used_fallback_fonts: Vec::new(),
            recovered_packages: Vec::new(),
        });
    }

    let started = Instant::now();
    let (first_output, second_output) =
        run_compile_command(&engine, &run_root, &normalized_main.to_string_lossy())?;
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
        && second_output
            .as_ref()
            .map(|item| item.status.success())
            .unwrap_or(true);

    let pdf_relative_path = copy_if_exists(&main_pdf, &artifact_pdf)?.map(|full| {
        full.replace(project_root.to_string_lossy().as_ref(), "")
            .trim_start_matches('/')
            .to_string()
    });
    let log_relative_path = copy_if_exists(&main_log, &artifact_log)?.map(|full| {
        full.replace(project_root.to_string_lossy().as_ref(), "")
            .trim_start_matches('/')
            .to_string()
    });
    let pdf_bytes = if success {
        Some(fs::read(&main_pdf).map_err(|e| e.to_string())?)
    } else {
        None
    };

    Ok(LatexCompileResponse {
        status: if success {
            "success".to_string()
        } else {
            "error".to_string()
        },
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
    state.log(
        "INFO",
        &format!("analysis_env_prepare: project={}", input.project_id),
    );
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &project_id)?;
        ensure_analysis_env_blocking(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &project_root,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn analysis_env_status(
    state: State<'_, AppState>,
    input: crate::models::ProjectRefInput,
) -> Result<AnalysisEnvStatusResponse, String> {
    state.log(
        "INFO",
        &format!("analysis_env_status: project={}", input.project_id),
    );
    let db_path = state.db_path.clone();
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    let project_id = input.project_id;
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &project_id)?;
        match analysis_env_status_blocking(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &project_id,
            &project_root,
        ) {
            Ok(status) => Ok(status),
            Err(error) => {
                let resolved_paths = resolve_analysis_env_paths(
                    &db_path,
                    &runtime_root,
                    &app_data_dir,
                    &project_id,
                    &project_root,
                )
                .ok();
                Ok(AnalysisEnvStatusResponse {
                    ready: false,
                    exists: false,
                    env_key: resolved_paths
                        .as_ref()
                        .map(|paths| paths.env_key.clone())
                        .unwrap_or_else(|| {
                            project_env_key(&project_root)
                                .unwrap_or_else(|_| "unknown".to_string())
                        }),
                    managed_root: resolved_paths
                        .as_ref()
                        .map(|paths| paths.managed_root.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    uv_path: resolve_uv_path().map(|path| path.to_string_lossy().to_string()),
                    uv_version: resolve_uv_path()
                        .and_then(|path| try_version_command(&path, &["--version"])),
                    python_path: None,
                    python_version: None,
                    pdf_math_translate_version: None,
                    venv_path: resolved_paths
                        .as_ref()
                        .map(|paths| paths.venv_path.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    runtime_root: resolve_analysis_runtime_root()
                        .map(|path| path.to_string_lossy().to_string())
                        .unwrap_or_default(),
                    last_error: Some(error),
                })
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn analysis_env_pick_directory(state: State<'_, AppState>) -> Result<Option<String>, String> {
    state.log("INFO", "analysis_env_pick_directory");
    Ok(FileDialog::new()
        .pick_folder()
        .map(|path| path.to_string_lossy().to_string()))
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
    let app_data_dir = state.app_data_dir.clone();
    let runtime_root = state.runtime_root.clone();
    tauri::async_runtime::spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &input.project_id)?;
        let env_status = ensure_analysis_env_blocking(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &input.project_id,
            &project_root,
        )?;
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
                diagnostics
                    .first()
                    .cloned()
                    .unwrap_or_else(|| "analysis runner failed".to_string())
            ));
        }
        let profile_json = if output_json.trim().is_empty() {
            serde_json::json!({
                "runtimeSource": "uv",
                "status": "empty"
            })
        } else {
            serde_json::from_str(&output_json)
                .map_err(|e| format!("python.run.invalid_json: {e}"))?
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