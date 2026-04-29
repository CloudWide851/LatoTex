use std::process::Command;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde_json::json;

use super::swarm_events::{emit_stage_event, emit_tool_event, EventMetadata};
use crate::commands::native_runtime::configure_hidden_process;

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn python_version() -> String {
    for command_name in ["python", "py"] {
        let mut command = Command::new(command_name);
        configure_hidden_process(&mut command);
        let output = command.arg("--version").output();
        if let Ok(output) = output {
            let text = String::from_utf8_lossy(if output.stdout.is_empty() {
                &output.stderr
            } else {
                &output.stdout
            })
            .trim()
            .to_string();
            if output.status.success() && !text.is_empty() {
                return format!("{command_name}: {text}");
            }
        }
    }
    "python: unavailable".to_string()
}

pub(super) fn run_stage_python_probe(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    stage: &str,
    source: &str,
    title: &str,
    prompt: &str,
    cancel_flag: &Arc<AtomicBool>,
    metadata: EventMetadata<'_>,
) -> Result<String, String> {
    ensure_not_cancelled(cancel_flag)?;
    let settings = crate::storage::load_settings(db_path, runtime_root).ok();
    let enabled = settings
        .and_then(|settings| settings.ui_prefs)
        .and_then(|prefs| prefs.agent_tool_prefs)
        .and_then(|prefs| prefs.python_enabled)
        .unwrap_or(true);
    if !enabled {
        return Ok("[python_analysis.runtime.v1]\npython=disabled_by_settings".to_string());
    }
    emit_stage_event(db_path, run_id, project_id, event_scope, source, stage, "running", title, "", metadata)?;
    let running_actions = json!([{"type":"run","tool":"python","status":"running"}]);
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "python_analysis",
        "running",
        "",
        EventMetadata { actions: Some(&running_actions), ..metadata },
    )?;
    let version = python_version();
    ensure_not_cancelled(cancel_flag)?;
    let prompt_size = prompt.chars().count();
    let content = format!(
        "[python_analysis.runtime.v1]\nstatus={}\nprompt_chars={prompt_size}",
        version
    );
    let success_actions = json!([{"type":"run","tool":"python","status":"success","summary":version}]);
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "python_analysis",
        "success",
        &content,
        EventMetadata { actions: Some(&success_actions), ..metadata },
    )?;
    emit_stage_event(db_path, run_id, project_id, event_scope, source, stage, "success", title, "", metadata)?;
    Ok(content)
}
