use super::native_runtime_common::{configure_hidden_process, try_version_command};
use crate::commands::runtime_assets::find_runtime_asset_entry;
use std::path::{Path, PathBuf};
use std::process::{Command, Output};

pub(crate) const MANAGED_PYTHON_VERSION: &str = "3.12";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ResolvedUv {
    pub(crate) path: PathBuf,
    pub(crate) source: &'static str,
    pub(crate) version: String,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum UvSourcePolicy {
    CnHttpsMirror,
    OfficialHttps,
}

fn bundled_uv_candidates() -> Vec<PathBuf> {
    let executable = if cfg!(target_os = "windows") {
        "tools/uv/windows-x64/uv.exe"
    } else {
        "tools/uv/uv"
    };
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .join("resources")
        .join(executable)];
    if let Ok(current_exe) = std::env::current_exe() {
        if let Some(exe_dir) = current_exe.parent() {
            candidates.push(exe_dir.join("resources").join(executable));
            candidates.push(exe_dir.join(executable));
        }
    }
    candidates
}

fn verified_uv(path: PathBuf, source: &'static str) -> Option<ResolvedUv> {
    if path != PathBuf::from("uv") && !path.is_file() {
        return None;
    }
    let version = try_version_command(&path, &["--version"])?;
    if version.trim().is_empty() {
        return None;
    }
    Some(ResolvedUv {
        path,
        source,
        version,
    })
}

fn first_verified_uv<I>(candidates: I) -> Option<ResolvedUv>
where
    I: IntoIterator<Item = (PathBuf, &'static str)>,
{
    candidates
        .into_iter()
        .find_map(|(path, source)| verified_uv(path, source))
}

pub(crate) fn resolve_uv(runtime_root: Option<&Path>) -> Option<ResolvedUv> {
    if let Some(resolved) = first_verified_uv(
        bundled_uv_candidates()
            .into_iter()
            .map(|candidate| (candidate, "bundled")),
    ) {
        return Some(resolved);
    }
    if let Some(runtime_root) = runtime_root {
        if let Some(path) = find_runtime_asset_entry(runtime_root, "uv") {
            if let Some(resolved) = verified_uv(path, "managed") {
                return Some(resolved);
            }
        }
    }
    verified_uv(PathBuf::from("uv"), "path")
}

fn locale_prefers_cn_source(locale: &str) -> bool {
    locale
        .trim()
        .replace('_', "-")
        .to_ascii_lowercase()
        .starts_with("zh")
}

#[cfg(target_os = "windows")]
fn system_locale_name() -> Option<String> {
    use windows_sys::Win32::Globalization::GetUserDefaultLocaleName;

    let mut buffer = [0u16; 85];
    let length = unsafe { GetUserDefaultLocaleName(buffer.as_mut_ptr(), buffer.len() as i32) };
    if length <= 1 {
        return None;
    }
    String::from_utf16(&buffer[..length as usize - 1]).ok()
}

#[cfg(not(target_os = "windows"))]
fn system_locale_name() -> Option<String> {
    None
}

fn prefer_cn_source() -> bool {
    let explicit_locale = std::env::var("LC_ALL")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .or_else(|| {
            std::env::var("LANG")
                .ok()
                .filter(|value| !value.trim().is_empty())
        });
    explicit_locale
        .or_else(system_locale_name)
        .is_some_and(|locale| locale_prefers_cn_source(&locale))
}

pub(crate) fn uv_source_policy_label() -> &'static str {
    if prefer_cn_source() {
        "cn_https_mirror_with_official_https_fallback"
    } else {
        "official_https"
    }
}

fn uv_source_policies() -> Vec<UvSourcePolicy> {
    uv_source_policies_for_preference(prefer_cn_source())
}

fn uv_source_policies_for_preference(prefer_cn: bool) -> Vec<UvSourcePolicy> {
    if prefer_cn {
        vec![UvSourcePolicy::CnHttpsMirror, UvSourcePolicy::OfficialHttps]
    } else {
        vec![UvSourcePolicy::OfficialHttps]
    }
}

fn configure_uv_command_for_policy(
    command: &mut Command,
    runtime_root: &Path,
    policy: UvSourcePolicy,
) {
    configure_hidden_process(command);
    let uv_cache_dir = runtime_root.join("cache").join("uv");
    let python_install_dir = runtime_root.join("python-installations");
    command
        .env_remove("PIP_INDEX_URL")
        .env_remove("PIP_EXTRA_INDEX_URL")
        .env_remove("UV_INDEX")
        .env_remove("UV_INDEX_URL")
        .env_remove("UV_EXTRA_INDEX_URL")
        .env_remove("UV_PYTHON_INSTALL_MIRROR")
        .env_remove("UV_ASTRAL_MIRROR_URL")
        .env("UV_PYTHON_DOWNLOADS", "automatic")
        .env("UV_CACHE_DIR", uv_cache_dir)
        .env("UV_PYTHON_INSTALL_DIR", python_install_dir)
        .env("UV_LINK_MODE", "copy");
    match policy {
        UvSourcePolicy::CnHttpsMirror => {
            command
                .env("UV_DEFAULT_INDEX", "https://pypi.tuna.tsinghua.edu.cn/simple")
                .env("UV_PYTHON_INSTALL_MIRROR", "https://gh-proxy.com/https://github.com/astral-sh/python-build-standalone/releases/download")
                .env("UV_ASTRAL_MIRROR_URL", "https://gh-proxy.com/https://github.com/astral-sh");
        }
        UvSourcePolicy::OfficialHttps => {
            command.env("UV_DEFAULT_INDEX", "https://pypi.org/simple");
        }
    }
}

pub(crate) fn configure_uv_command(command: &mut Command, runtime_root: &Path) {
    let policy = uv_source_policies()
        .into_iter()
        .next()
        .unwrap_or(UvSourcePolicy::OfficialHttps);
    configure_uv_command_for_policy(command, runtime_root, policy);
}

pub(crate) fn run_uv_command_with_source_fallback<F>(
    uv_path: &Path,
    runtime_root: &Path,
    configure: F,
) -> std::io::Result<(&'static str, Output)>
where
    F: Fn(&mut Command),
{
    let mut last_output = None;
    for policy in uv_source_policies() {
        let mut command = Command::new(uv_path);
        configure_uv_command_for_policy(&mut command, runtime_root, policy);
        configure(&mut command);
        let output = command.output()?;
        let label = match policy {
            UvSourcePolicy::CnHttpsMirror => "cn_https_mirror",
            UvSourcePolicy::OfficialHttps => "official_https",
        };
        if output.status.success() {
            return Ok((label, output));
        }
        last_output = Some((label, output));
    }
    Ok(last_output.expect("uv source policy list is never empty"))
}

pub(crate) fn ensure_managed_python(
    uv_path: &Path,
    runtime_root: &Path,
    python_version: &str,
) -> Result<(), String> {
    let (source_policy, output) =
        run_uv_command_with_source_fallback(uv_path, runtime_root, |command| {
            command.arg("python").arg("install").arg(python_version);
        })
        .map_err(|e| format!("python.env.python_install_spawn_failed: {e}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!(
            "python.env.python_install_failed: source_policy={source_policy}; {}",
            crate::logging::sanitize_log_message_with_limit(&detail, 320)
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{
        bundled_uv_candidates, configure_uv_command, configure_uv_command_for_policy,
        first_verified_uv, locale_prefers_cn_source, resolve_uv, uv_source_policies_for_preference,
        uv_source_policy_label, UvSourcePolicy,
    };
    use std::fs;
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

        assert!(envs
            .iter()
            .any(|(key, value)| key == "UV_PYTHON_DOWNLOADS"
                && value.as_deref() == Some("automatic")));
        assert!(envs.iter().any(|(key, value)| key == "UV_CACHE_DIR"
            && value.as_deref().unwrap_or("").contains("cache")));
        assert!(envs
            .iter()
            .any(|(key, value)| key == "UV_PYTHON_INSTALL_DIR"
                && value
                    .as_deref()
                    .unwrap_or("")
                    .contains("python-installations")));
        assert!(matches!(
            uv_source_policy_label(),
            "official_https" | "cn_https_mirror_with_official_https_fallback"
        ));
    }

    #[test]
    fn official_fallback_clears_inherited_index_and_uses_https() {
        let runtime_root = PathBuf::from(r"H:\LatoTex\runtime-data");
        let mut command = Command::new("uv");
        command.env("UV_INDEX_URL", "http://unsafe.invalid/simple");
        configure_uv_command_for_policy(&mut command, &runtime_root, UvSourcePolicy::OfficialHttps);
        let envs = command
            .get_envs()
            .map(|(key, value)| {
                (
                    key.to_string_lossy().to_string(),
                    value.map(|item| item.to_string_lossy().to_string()),
                )
            })
            .collect::<Vec<_>>();
        assert!(envs
            .iter()
            .any(|(key, value)| key == "UV_INDEX_URL" && value.is_none()));
        assert!(envs.iter().any(|(key, value)| {
            key == "UV_DEFAULT_INDEX" && value.as_deref() == Some("https://pypi.org/simple")
        }));
    }

    #[test]
    fn chinese_source_policy_tries_mirror_then_official_https() {
        assert_eq!(
            uv_source_policies_for_preference(true),
            vec![UvSourcePolicy::CnHttpsMirror, UvSourcePolicy::OfficialHttps]
        );
        assert_eq!(
            uv_source_policies_for_preference(false),
            vec![UvSourcePolicy::OfficialHttps]
        );
    }

    #[test]
    fn chinese_locale_detection_accepts_windows_and_posix_shapes() {
        assert!(locale_prefers_cn_source("zh-CN"));
        assert!(locale_prefers_cn_source("zh_CN.UTF-8"));
        assert!(locale_prefers_cn_source(" zh-Hans "));
        assert!(!locale_prefers_cn_source("en-US"));
    }

    #[test]
    fn uv_path_resolution_has_a_fallback_candidate() {
        let resolved = resolve_uv(None);
        if let Some(uv) = resolved {
            assert!(!uv.path.as_os_str().is_empty());
        }
    }

    #[test]
    fn packaged_uv_is_the_first_candidate_and_resolves_when_present() {
        let candidates = bundled_uv_candidates();
        assert!(candidates
            .first()
            .is_some_and(|path| path.ends_with("resources/tools/uv/windows-x64/uv.exe")));
        if candidates.first().is_some_and(|path| path.is_file()) {
            let resolved = resolve_uv(None).expect("packaged uv should resolve");
            assert_eq!(resolved.source, "bundled");
            assert_eq!(resolved.path, candidates[0]);
            assert!(!resolved.version.trim().is_empty());
        }
    }

    #[test]
    fn damaged_uv_candidate_falls_back_to_the_next_verified_candidate() {
        let packaged = bundled_uv_candidates()
            .into_iter()
            .find(|candidate| candidate.is_file())
            .expect("packaged uv fixture should exist");
        let temp_root =
            std::env::temp_dir().join(format!("latotex-uv-fallback-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&temp_root).unwrap();
        let damaged = temp_root.join("uv.exe");
        fs::write(&damaged, b"not an executable").unwrap();

        let resolved = first_verified_uv([(damaged, "bundled"), (packaged.clone(), "managed")])
            .expect("the verified fallback should resolve");

        assert_eq!(resolved.path, packaged);
        assert_eq!(resolved.source, "managed");
        let _ = fs::remove_dir_all(temp_root);
    }
}
