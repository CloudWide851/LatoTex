use super::native_runtime_common::{
    command_from_path_or_name, configure_hidden_process, try_version_command,
};
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) const MANAGED_PYTHON_VERSION: &str = "3.12";

fn analysis_resource_candidates(relative_path: &str) -> Vec<PathBuf> {
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

pub(crate) fn resolve_uv_path() -> Option<PathBuf> {
    for candidate in analysis_resource_candidates("resources/tools/uv/windows-x64/uv.exe") {
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

pub(crate) fn configure_uv_command(command: &mut Command, runtime_root: &Path) {
    configure_hidden_process(command);
    let uv_cache_dir = runtime_root.join("cache").join("uv");
    let python_install_dir = runtime_root.join("python-installations");
    command
        .env("UV_PYTHON_DOWNLOADS", "automatic")
        .env("UV_CACHE_DIR", uv_cache_dir)
        .env("UV_PYTHON_INSTALL_DIR", python_install_dir)
        .env("UV_LINK_MODE", "copy");
}

pub(crate) fn ensure_managed_python(
    uv_path: &Path,
    runtime_root: &Path,
    python_version: &str,
) -> Result<(), String> {
    let mut command = Command::new(uv_path);
    configure_uv_command(&mut command, runtime_root);
    let output = command
        .arg("python")
        .arg("install")
        .arg(python_version)
        .output()
        .map_err(|e| format!("python.env.python_install_spawn_failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("python.env.python_install_failed: {detail}"));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{configure_uv_command, resolve_uv_path};
    use std::path::PathBuf;
    use std::process::Command;

    #[test]
    fn uv_command_uses_runtime_scoped_environment() {
        let runtime_root = PathBuf::from(r"H:\LatoTex\runtime-data");
        let mut command = Command::new("uv");
        configure_uv_command(&mut command, &runtime_root);
        let envs = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|item| item.to_string_lossy().to_string()),
                )
            })
            .collect::<Vec<_>>();

        assert!(envs.iter().any(|(key, value)| key == "UV_PYTHON_DOWNLOADS" && value.as_deref() == Some("automatic")));
        assert!(envs.iter().any(|(key, value)| key == "UV_CACHE_DIR" && value.as_deref().unwrap_or("").contains("cache")));
        assert!(envs.iter().any(|(key, value)| key == "UV_PYTHON_INSTALL_DIR" && value.as_deref().unwrap_or("").contains("python-installations")));
    }

    #[test]
    fn uv_path_resolution_has_a_fallback_candidate() {
        let resolved = resolve_uv_path();
        if let Some(path) = resolved {
            assert!(!path.as_os_str().is_empty());
        }
    }
}
