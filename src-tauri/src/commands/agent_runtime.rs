use crate::logging::sanitize_log_message_with_limit;
use crate::models::{
    AgentRuntimeDescriptor, AgentRuntimeInput, AgentRuntimeSetEnabledInput, ExternalAgentFailure,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

const PROBE_TIMEOUT: Duration = Duration::from_secs(8);
const PROBE_OUTPUT_LIMIT: usize = 16 * 1024;

#[derive(Clone, Copy)]
pub(crate) struct AgentRuntimeSpec {
    pub id: &'static str,
    pub plugin_id: &'static str,
    pub label_key: &'static str,
    pub executable: &'static str,
    pub version_args: &'static [&'static str],
    pub auth_args: &'static [&'static str],
}

pub(crate) const EXTERNAL_RUNTIME_SPECS: [AgentRuntimeSpec; 2] = [
    AgentRuntimeSpec {
        id: "codex-cli",
        plugin_id: "latotex.agent.codex-cli",
        label_key: "agents.runtime.codexCli",
        executable: "codex.exe",
        version_args: &["--version"],
        auth_args: &["login", "status"],
    },
    AgentRuntimeSpec {
        id: "claude-code-cli",
        plugin_id: "latotex.agent.claude-code-cli",
        label_key: "agents.runtime.claudeCodeCli",
        executable: "claude.exe",
        version_args: &["--version"],
        auth_args: &["auth", "status"],
    },
];

pub(crate) fn runtime_spec(runtime_id: &str) -> Result<AgentRuntimeSpec, String> {
    EXTERNAL_RUNTIME_SPECS
        .iter()
        .copied()
        .find(|spec| spec.id == runtime_id)
        .ok_or_else(|| "agent.runtime.unsupported".to_string())
}

fn failure(code: &str, stage: &str, retryable: bool, detail: &str) -> ExternalAgentFailure {
    ExternalAgentFailure {
        code: code.to_string(),
        stage: stage.to_string(),
        retryable,
        diagnostics: if detail.trim().is_empty() {
            Vec::new()
        } else {
            vec![sanitize_log_message_with_limit(detail, 512)]
        },
    }
}

#[cfg(windows)]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    use std::os::windows::fs::MetadataExt;
    metadata.file_attributes() & 0x400 != 0
}

#[cfg(not(windows))]
fn is_reparse(metadata: &std::fs::Metadata) -> bool {
    metadata.file_type().is_symlink()
}

pub(crate) fn validate_runtime_executable(path: &Path) -> Result<PathBuf, String> {
    if !path.is_absolute() || path.extension().and_then(|value| value.to_str()) != Some("exe") {
        return Err("agent.runtime.path_invalid".to_string());
    }
    let metadata =
        std::fs::symlink_metadata(path).map_err(|_| "agent.runtime.path_missing".to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() || is_reparse(&metadata) {
        return Err("agent.runtime.path_untrusted".to_string());
    }
    let canonical = path
        .canonicalize()
        .map_err(|_| "agent.runtime.path_invalid".to_string())?;
    let canonical_metadata =
        std::fs::metadata(&canonical).map_err(|_| "agent.runtime.path_missing".to_string())?;
    if !canonical_metadata.is_file() {
        return Err("agent.runtime.path_untrusted".to_string());
    }
    Ok(canonical)
}

fn terminate_probe(child: &mut std::process::Child) {
    #[cfg(windows)]
    {
        let _ = Command::new("taskkill.exe")
            .args(["/PID", &child.id().to_string(), "/T", "/F"])
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .status();
    }
    let _ = child.kill();
}

fn probe_command(path: &Path, args: &[&str]) -> Result<String, ExternalAgentFailure> {
    let mut child = Command::new(path)
        .args(args)
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            failure(
                "agent.runtime.spawn_failed",
                "spawn",
                true,
                &error.to_string(),
            )
        })?;
    let started = Instant::now();
    loop {
        match child.try_wait() {
            Ok(Some(_)) => break,
            Ok(None) if started.elapsed() < PROBE_TIMEOUT => {
                thread::sleep(Duration::from_millis(40));
            }
            Ok(None) => {
                terminate_probe(&mut child);
                return Err(failure(
                    "agent.runtime.probe_timeout",
                    "probe",
                    true,
                    "runtime probe timed out",
                ));
            }
            Err(error) => {
                terminate_probe(&mut child);
                return Err(failure(
                    "agent.runtime.probe_failed",
                    "probe",
                    true,
                    &error.to_string(),
                ));
            }
        }
    }
    let output = child.wait_with_output().map_err(|error| {
        failure(
            "agent.runtime.probe_failed",
            "probe",
            true,
            &error.to_string(),
        )
    })?;
    let combined = format!(
        "{} {}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    let sanitized = sanitize_log_message_with_limit(&combined, PROBE_OUTPUT_LIMIT);
    if !output.status.success() {
        return Err(failure(
            "agent.runtime.probe_failed",
            "probe",
            true,
            &sanitized,
        ));
    }
    Ok(sanitized.trim().to_string())
}

fn validate_version_output(runtime_id: &str, output: &str) -> Result<(), ExternalAgentFailure> {
    let normalized = output.trim().to_ascii_lowercase();
    let provider = match runtime_id {
        "codex-cli" => "codex",
        "claude-code-cli" => "claude",
        _ => {
            return Err(failure(
                "agent.runtime.unsupported",
                "version",
                false,
                runtime_id,
            ));
        }
    };
    if !normalized.contains(provider) || !normalized.chars().any(|value| value.is_ascii_digit()) {
        return Err(failure(
            "agent.runtime.version_invalid",
            "version",
            false,
            runtime_id,
        ));
    }
    Ok(())
}

fn path_candidates(executable: &str) -> Vec<PathBuf> {
    #[cfg(windows)]
    let output = Command::new("where.exe")
        .arg(executable.trim_end_matches(".exe"))
        .stdin(Stdio::null())
        .output();
    #[cfg(not(windows))]
    let output = Command::new("which")
        .arg(executable.trim_end_matches(".exe"))
        .stdin(Stdio::null())
        .output();
    let Ok(output) = output else {
        return Vec::new();
    };
    if !output.status.success() {
        return Vec::new();
    }
    String::from_utf8_lossy(&output.stdout)
        .lines()
        .map(str::trim)
        .filter(|value| value.to_ascii_lowercase().ends_with(".exe"))
        .map(PathBuf::from)
        .collect()
}

fn resolve_runtime_path(
    db_path: &Path,
    spec: AgentRuntimeSpec,
) -> Result<(PathBuf, String), ExternalAgentFailure> {
    let setting = storage::agent_runtime_setting(db_path, spec.id)
        .map_err(|error| failure("agent.runtime.settings_failed", "settings", true, &error))?;
    if let Some(configured) = setting.executable_path.as_deref() {
        let file_name_matches = Path::new(configured)
            .file_name()
            .and_then(|value| value.to_str())
            .is_some_and(|value| value.eq_ignore_ascii_case(spec.executable));
        if !file_name_matches {
            return Err(failure(
                "agent.runtime.executable_mismatch",
                "path",
                false,
                configured,
            ));
        }
        match validate_runtime_executable(Path::new(configured)) {
            Ok(path) => return Ok((path, "manual".to_string())),
            Err(error) => {
                return Err(failure(&error, "path", true, configured));
            }
        }
    }
    for candidate in path_candidates(spec.executable) {
        if let Ok(path) = validate_runtime_executable(&candidate) {
            return Ok((path, "path".to_string()));
        }
    }
    Err(failure(
        "agent.runtime.not_found",
        "path",
        true,
        spec.executable,
    ))
}

pub(crate) fn inspect_runtime(db_path: &Path, spec: AgentRuntimeSpec) -> AgentRuntimeDescriptor {
    let setting =
        storage::agent_runtime_setting(db_path, spec.id).unwrap_or(storage::AgentRuntimeSetting {
            executable_path: None,
            enabled: false,
        });
    let (path, source) = match resolve_runtime_path(db_path, spec) {
        Ok(value) => value,
        Err(runtime_failure) => {
            return AgentRuntimeDescriptor {
                id: spec.id.to_string(),
                plugin_id: spec.plugin_id.to_string(),
                label_key: spec.label_key.to_string(),
                enabled: setting.enabled,
                available: false,
                authenticated: false,
                source: "missing".to_string(),
                executable_path: setting.executable_path,
                version: None,
                failure: Some(runtime_failure),
            };
        }
    };
    let version = match probe_command(&path, spec.version_args) {
        Ok(value) => match validate_version_output(spec.id, &value) {
            Ok(()) => value,
            Err(runtime_failure) => {
                return AgentRuntimeDescriptor {
                    id: spec.id.to_string(),
                    plugin_id: spec.plugin_id.to_string(),
                    label_key: spec.label_key.to_string(),
                    enabled: setting.enabled,
                    available: false,
                    authenticated: false,
                    source,
                    executable_path: Some(path.to_string_lossy().to_string()),
                    version: None,
                    failure: Some(runtime_failure),
                };
            }
        },
        Err(runtime_failure) => {
            return AgentRuntimeDescriptor {
                id: spec.id.to_string(),
                plugin_id: spec.plugin_id.to_string(),
                label_key: spec.label_key.to_string(),
                enabled: setting.enabled,
                available: false,
                authenticated: false,
                source,
                executable_path: Some(path.to_string_lossy().to_string()),
                version: None,
                failure: Some(runtime_failure),
            };
        }
    };
    let auth = probe_command(&path, spec.auth_args);
    AgentRuntimeDescriptor {
        id: spec.id.to_string(),
        plugin_id: spec.plugin_id.to_string(),
        label_key: spec.label_key.to_string(),
        enabled: setting.enabled,
        available: true,
        authenticated: auth.is_ok(),
        source,
        executable_path: Some(path.to_string_lossy().to_string()),
        version: Some(version),
        failure: auth.err(),
    }
}

pub(crate) fn runtime_catalog(db_path: &Path) -> Vec<AgentRuntimeDescriptor> {
    let mut runtimes = vec![AgentRuntimeDescriptor {
        id: "native".to_string(),
        plugin_id: "latotex.agent.native".to_string(),
        label_key: "agents.runtime.native".to_string(),
        enabled: true,
        available: true,
        authenticated: true,
        source: "bundled".to_string(),
        executable_path: None,
        version: Some(env!("CARGO_PKG_VERSION").to_string()),
        failure: None,
    }];
    runtimes.extend(
        EXTERNAL_RUNTIME_SPECS
            .iter()
            .copied()
            .map(|spec| inspect_runtime(db_path, spec)),
    );
    runtimes
}

#[tauri::command]
pub fn agent_runtime_list(
    state: State<'_, AppState>,
) -> Result<Vec<AgentRuntimeDescriptor>, String> {
    Ok(runtime_catalog(&state.db_path))
}

#[tauri::command]
pub fn agent_runtime_detect(
    state: State<'_, AppState>,
    input: AgentRuntimeInput,
) -> Result<AgentRuntimeDescriptor, String> {
    let spec = runtime_spec(&input.runtime_id)?;
    let descriptor = inspect_runtime(&state.db_path, spec);
    if descriptor.available {
        storage::set_agent_runtime_path(
            &state.db_path,
            spec.id,
            descriptor.executable_path.as_deref(),
        )?;
    }
    Ok(descriptor)
}

#[tauri::command]
pub fn agent_runtime_pick_executable(
    state: State<'_, AppState>,
    input: AgentRuntimeInput,
) -> Result<Option<AgentRuntimeDescriptor>, String> {
    let spec = runtime_spec(&input.runtime_id)?;
    let selected = FileDialog::new()
        .add_filter("Windows executable", &["exe"])
        .pick_file();
    let Some(selected) = selected else {
        return Ok(None);
    };
    let canonical = validate_runtime_executable(&selected)?;
    let file_name = canonical
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    if !file_name.eq_ignore_ascii_case(spec.executable) {
        return Err("agent.runtime.executable_mismatch".to_string());
    }
    let version = probe_command(&canonical, spec.version_args).map_err(|item| item.code)?;
    validate_version_output(spec.id, &version).map_err(|item| item.code)?;
    storage::set_agent_runtime_path(&state.db_path, spec.id, Some(&canonical.to_string_lossy()))?;
    Ok(Some(inspect_runtime(&state.db_path, spec)))
}

#[tauri::command]
pub fn agent_runtime_set_enabled(
    state: State<'_, AppState>,
    input: AgentRuntimeSetEnabledInput,
) -> Result<AgentRuntimeDescriptor, String> {
    let spec = runtime_spec(&input.runtime_id)?;
    let status = inspect_runtime(&state.db_path, spec);
    if input.enabled && (!status.available || !status.authenticated) {
        return Err("agent.runtime.not_ready".to_string());
    }
    storage::set_agent_runtime_enabled(&state.db_path, spec.id, input.enabled)?;
    Ok(inspect_runtime(&state.db_path, spec))
}

pub(crate) fn ready_runtime(
    db_path: &Path,
    runtime_id: &str,
) -> Result<AgentRuntimeDescriptor, ExternalAgentFailure> {
    let spec =
        runtime_spec(runtime_id).map_err(|error| failure(&error, "resolve", false, runtime_id))?;
    let descriptor = inspect_runtime(db_path, spec);
    if !descriptor.enabled {
        return Err(failure(
            "agent.runtime.disabled",
            "resolve",
            true,
            runtime_id,
        ));
    }
    if !descriptor.available || !descriptor.authenticated {
        return Err(descriptor
            .failure
            .unwrap_or_else(|| failure("agent.runtime.not_ready", "resolve", true, runtime_id)));
    }
    Ok(descriptor)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn runtime_path_requires_absolute_exe() {
        assert_eq!(
            validate_runtime_executable(Path::new("codex.exe")).unwrap_err(),
            "agent.runtime.path_invalid"
        );
        assert_eq!(
            validate_runtime_executable(Path::new("../codex.cmd")).unwrap_err(),
            "agent.runtime.path_invalid"
        );
    }

    #[test]
    fn runtime_registry_is_closed() {
        assert_eq!(runtime_spec("codex-cli").unwrap().executable, "codex.exe");
        assert!(runtime_spec("custom-shell").is_err());
    }

    #[test]
    fn provider_version_output_cannot_be_forged_by_exit_status_alone() {
        assert!(validate_version_output("codex-cli", "codex-cli 0.146.0").is_ok());
        assert!(validate_version_output("claude-code-cli", "2.1.179 (Claude Code)").is_ok());
        let failure = validate_version_output("codex-cli", "unrelated tool 1.0").unwrap_err();
        assert_eq!(failure.code, "agent.runtime.version_invalid");
    }
}
