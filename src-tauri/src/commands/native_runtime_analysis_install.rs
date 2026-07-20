use std::path::Path;

use super::native_runtime_analysis_uv::run_uv_command_with_source_fallback;

pub(super) const PDF2ZH_TENCENT_TMT_REQUIREMENT: &str = "tencentcloud-sdk-python-tmt<3.1";

pub(super) fn install_python_package(
    uv_path: &Path,
    runtime_root: &Path,
    python_path: &Path,
    package_spec: &Path,
    editable: bool,
) -> Result<(), String> {
    let (source_policy, output) =
        run_uv_command_with_source_fallback(uv_path, runtime_root, |command| {
            command
                .arg("pip")
                .arg("install")
                .arg("--python")
                .arg(python_path);
            if editable {
                command.arg("-e");
            }
            command.arg(package_spec);
        })
        .map_err(|e| format!("python.env.install_spawn_failed: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(format!(
        "python.env.install_failed: source_policy={source_policy}; {}",
        crate::logging::sanitize_log_message_with_limit(&detail, 320)
    ))
}

pub(super) fn install_python_requirement(
    uv_path: &Path,
    runtime_root: &Path,
    python_path: &Path,
    requirement: &str,
) -> Result<(), String> {
    let (source_policy, output) =
        run_uv_command_with_source_fallback(uv_path, runtime_root, |command| {
            command
                .arg("pip")
                .arg("install")
                .arg("--python")
                .arg(python_path)
                .arg(requirement);
        })
        .map_err(|e| format!("python.env.install_spawn_failed: {e}"))?;
    if output.status.success() {
        return Ok(());
    }
    let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    let detail = if !stderr.is_empty() { stderr } else { stdout };
    Err(format!(
        "python.env.install_failed: source_policy={source_policy}; {}",
        crate::logging::sanitize_log_message_with_limit(&detail, 320)
    ))
}
