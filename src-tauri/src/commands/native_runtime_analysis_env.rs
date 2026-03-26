use super::native_runtime_common::{command_from_path_or_name, configure_hidden_process, try_version_command};
use crate::models::AnalysisEnvStatusResponse;
use crate::storage;
use ring::digest::{digest, SHA256};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

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
    if let Some(version) = try_version_command(&command_from_path_or_name("uv"), &["--version"])
    {
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
    );
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
    Ok(build_env_status(
        &env_paths,
        &analysis_runtime_root,
        vendor_root.as_deref(),
        Some(&uv_path),
        None,
    ))
}

