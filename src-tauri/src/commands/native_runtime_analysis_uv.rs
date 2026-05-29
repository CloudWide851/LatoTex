use super::native_runtime_common::{
    command_from_path_or_name, configure_hidden_process, try_version_command,
};
use crate::commands::runtime_assets::find_runtime_asset_entry;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) const MANAGED_PYTHON_VERSION: &str = "3.12";

pub(crate) fn resolve_uv_path(runtime_root: Option<&Path>) -> Option<PathBuf> {
    if let Some(runtime_root) = runtime_root {
        if let Some(path) = find_runtime_asset_entry(runtime_root, "uv") {
            return Some(path);
        }
    }
    if let Some(version) = try_version_command(&command_from_path_or_name("uv"), &["--version"]) {
        if !version.is_empty() {
            return Some(PathBuf::from("uv"));
        }
    }
    None
}

fn prefer_cn_source() -> bool {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default()
        .to_ascii_lowercase()
        .starts_with("zh")
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
    if prefer_cn_source() {
        command
            .env("UV_DEFAULT_INDEX", "https://pypi.tuna.tsinghua.edu.cn/simple")
            .env("UV_PYTHON_INSTALL_MIRROR", "https://gh-proxy.com/https://github.com/astral-sh/python-build-standalone/releases/download")
            .env("UV_ASTRAL_MIRROR_URL", "https://gh-proxy.com/https://github.com/astral-sh");
    }
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
        let resolved = resolve_uv_path(None);
        if let Some(path) = resolved {
            assert!(!path.as_os_str().is_empty());
        }
    }
}
