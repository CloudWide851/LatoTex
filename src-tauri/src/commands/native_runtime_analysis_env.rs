use super::native_runtime_analysis_uv::{
    configure_uv_command, ensure_managed_python, resolve_uv_path, MANAGED_PYTHON_VERSION,
};
use super::native_runtime_common::{configure_hidden_process, try_version_command};
use crate::models::AnalysisEnvStatusResponse;
use crate::storage;
use ring::digest::{digest, SHA256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn analysis_resource_candidates(relative_path: &str) -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(relative_path),
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../src-tauri/{relative_path}")),
    ];
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(relative_path));
            candidates.push(exe_dir.join(format!("resources/{relative_path}")));
            candidates.push(exe_dir.join(format!("../resources/{relative_path}")));
        }
    }
    candidates
}

pub(crate) fn resolve_analysis_runtime_root() -> Option<PathBuf> {
    let bundled = analysis_resource_candidates("resources/python/analysis_runtime")
        .into_iter()
        .find(|candidate| candidate.join("analysis_runner.py").exists());
    bundled.or_else(|| {
        Some(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/python/analysis_runtime"))
            .filter(|candidate| candidate.join("analysis_runner.py").exists())
    })
}

pub(crate) fn resolve_pdfmathtranslate_vendor_root() -> Option<PathBuf> {
    analysis_resource_candidates("resources/python/vendor/pdf2zh")
        .into_iter()
        .find(|candidate| {
            candidate.join("pyproject.toml").exists() && candidate.join("pdf2zh/__init__.py").exists()
        })
}

pub(crate) fn managed_analysis_root(runtime_root: &Path) -> PathBuf {
    runtime_root.join("python-envs")
}

fn legacy_managed_analysis_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("python-envs")
}

fn strip_windows_verbatim_prefix(text: &str) -> String {
    if let Some(stripped) = text.strip_prefix("\\\\?\\UNC\\") {
        return format!("//{}", stripped.replace('\\', "/"));
    }
    if let Some(stripped) = text.strip_prefix("\\\\?\\") {
        return stripped.replace('\\', "/");
    }
    text.to_string()
}

fn normalized_project_root(project_root: &Path) -> Result<String, String> {
    let canonical = project_root.canonicalize().map_err(|e| e.to_string())?;
    let text = strip_windows_verbatim_prefix(&canonical.to_string_lossy()).replace('\\', "/");
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

pub(crate) struct ResolvedAnalysisEnvPaths {
    pub(crate) env_key: String,
    pub(crate) managed_root: PathBuf,
    pub(crate) venv_path: PathBuf,
    pub(crate) python_path: PathBuf,
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

pub(crate) fn resolve_analysis_env_paths(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
) -> Result<ResolvedAnalysisEnvPaths, String> {
    let env_key = project_env_key(project_root)?;
    let install_root = managed_analysis_root(runtime_root);
    let legacy_root = legacy_managed_analysis_root(app_data_dir);
    let base_root = configured_analysis_base_root(db_path, runtime_root, project_id).unwrap_or_else(|| {
        if install_root.join(&env_key).exists() {
            install_root.clone()
        } else if legacy_root.join(&env_key).exists() {
            legacy_root
        } else {
            install_root.clone()
        }
    });
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

fn should_skip_fingerprint_path(path: &Path) -> bool {
    let name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if path.is_dir() {
        return matches!(name, "__pycache__" | ".pytest_cache" | ".mypy_cache");
    }
    let lower = name.to_ascii_lowercase();
    lower.ends_with(".pyc") || lower.ends_with(".pyo")
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
        if should_skip_fingerprint_path(&path) {
            continue;
        }
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

fn pdf2zh_entry_ready(python_path: &Path) -> bool {
    let mut command = Command::new(python_path);
    configure_hidden_process(&mut command);
    let output = command
        .arg("-m")
        .arg("pdf2zh.pdf2zh")
        .arg("--version")
        .output();
    match output {
        Ok(item) => item.status.success(),
        Err(_) => false,
    }
}

fn install_python_package(
    uv_path: &Path,
    runtime_root: &Path,
    python_path: &Path,
    package_spec: &Path,
    editable: bool,
) -> Result<(), String> {
    let mut command = Command::new(uv_path);
    configure_uv_command(&mut command, runtime_root);
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
    runtime_root: &Path,
    python_path: &Path,
    requirement: &str,
) -> Result<(), String> {
    let mut command = Command::new(uv_path);
    configure_uv_command(&mut command, runtime_root);
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

fn ensure_runtime_packages<F>(
    uv_path: &Path,
    app_runtime_root: &Path,
    python_path: &Path,
    runtime_root: &Path,
    vendor_root: Option<&Path>,
    managed_root: &Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(f64, &str, Option<&str>),
{
    let fingerprint = runtime_dependency_fingerprint(runtime_root, vendor_root)?;
    let stamp_path = runtime_dependency_stamp_path(managed_root);
    if fs::read_to_string(&stamp_path).ok().as_deref() == Some(fingerprint.as_str()) {
        on_progress(92.0, "verifying", Some("runtime-cache-hit"));
        return Ok(());
    }

    if let Some(vendor_root) = vendor_root {
        on_progress(52.0, "installing_pdf2zh", vendor_root.file_name().and_then(|value| value.to_str()));
        install_python_package(uv_path, app_runtime_root, python_path, vendor_root, false)?;
    } else {
        on_progress(52.0, "installing_pdf2zh", Some("pdf2zh>=1.9.11,<2"));
        install_python_requirement(uv_path, app_runtime_root, python_path, "pdf2zh>=1.9.11,<2")?;
    }
    on_progress(78.0, "installing_runtime", runtime_root.file_name().and_then(|value| value.to_str()));
    install_python_package(uv_path, app_runtime_root, python_path, runtime_root, true)?;
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
    Ok(python_module_version(python_path, "pdf2zh").is_some() && pdf2zh_entry_ready(python_path))
}

fn build_env_status(
    env_paths: &ResolvedAnalysisEnvPaths,
    runtime_root: &Path,
    vendor_root: Option<&Path>,
    uv_path: Option<&Path>,
    last_error: Option<String>,
) -> AnalysisEnvStatusResponse {
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

    AnalysisEnvStatusResponse {
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
    }
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
    let uv_path = resolve_uv_path(Some(runtime_root));
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
    );
    if !status.ready && status.last_error.is_none() {
        status.last_error = Some("python.env.runtime_missing".to_string());
    }
    Ok(status)
}

pub(crate) fn ensure_analysis_env_with_progress_blocking<F>(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
    mut on_progress: F,
) -> Result<AnalysisEnvStatusResponse, String>
where
    F: FnMut(f64, &str, Option<&str>),
{
    let analysis_runtime_root = resolve_analysis_runtime_root()
        .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
    let vendor_root = resolve_pdfmathtranslate_vendor_root();
    let uv_path = resolve_uv_path(Some(runtime_root)).ok_or_else(|| "uv executable was not found".to_string())?;
    let env_paths = resolve_analysis_env_paths(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        project_root,
    )?;

    let managed_root_text = env_paths.managed_root.to_string_lossy().to_string();
    on_progress(6.0, "resolving", Some(&managed_root_text));
    if !env_paths.python_path.exists() {
        fs::create_dir_all(&env_paths.managed_root).map_err(|e| e.to_string())?;
        on_progress(14.0, "installing_python", Some(MANAGED_PYTHON_VERSION));
        ensure_managed_python(&uv_path, runtime_root, MANAGED_PYTHON_VERSION)?;
        let mut command = Command::new(&uv_path);
        configure_uv_command(&mut command, runtime_root);
        let venv_path_text = env_paths.venv_path.to_string_lossy().to_string();
        on_progress(18.0, "creating_venv", Some(&venv_path_text));
        let output = command
            .arg("venv")
            .arg(&env_paths.venv_path)
            .arg("--python")
            .arg(MANAGED_PYTHON_VERSION)
            .output()
            .map_err(|e| format!("python.env.spawn_failed: {e}"))?;
        if !output.status.success() {
            let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
            let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
            let detail = if !stderr.is_empty() { stderr } else { stdout };
            return Err(format!("python.env.prepare_failed: {detail}"));
        }
    } else {
        on_progress(28.0, "creating_venv", Some("venv-ready"));
    }

    ensure_runtime_packages(
        &uv_path,
        runtime_root,
        &env_paths.python_path,
        &analysis_runtime_root,
        vendor_root.as_deref(),
        &env_paths.managed_root,
        |percent, stage, current_item| on_progress(percent, stage, current_item),
    )?;
    on_progress(96.0, "verifying", Some("pdf2zh.pdf2zh --version"));
    let status = build_env_status(
        &env_paths,
        &analysis_runtime_root,
        vendor_root.as_deref(),
        Some(&uv_path),
        None,
    );
    if !status.ready {
        return Err("python.env.runtime_missing".to_string());
    }
    let completed_path = status.venv_path.clone();
    on_progress(100.0, "completed", Some(&completed_path));
    Ok(status)
}

pub(crate) fn ensure_analysis_env_blocking(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
) -> Result<AnalysisEnvStatusResponse, String> {
    ensure_analysis_env_with_progress_blocking(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        project_root,
        |_percent, _stage, _current_item| {},
    )
}
#[cfg(test)]
mod native_runtime_analysis_env_tests;
