use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use serde_json::json;

use super::swarm_events::{emit_stage_event, emit_tool_event, EventMetadata};
use crate::commands::native_runtime::ensure_analysis_env_blocking;

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

pub(super) fn run_stage_python_probe(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
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
    let project_root = crate::storage::load_project_root(db_path, project_id)?;
    let env_status = ensure_analysis_env_blocking(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        &project_root,
    )?;
    let python_path = env_status
        .python_path
        .clone()
        .ok_or_else(|| "python.env.python_missing".to_string())?;
    let version = env_status
        .python_version
        .clone()
        .unwrap_or_else(|| "python: managed".to_string());
    ensure_not_cancelled(cancel_flag)?;
    let prompt_size = prompt.chars().count();
    let content = format!(
        "[python_analysis.runtime.v1]\nstatus={}\nprompt_chars={prompt_size}\nruntime_source=managed_uv\nvenv={}",
        version,
        env_status.venv_path
    );
    let success_actions = json!([{
        "type": "run",
        "tool": "python",
        "status": "success",
        "summary": version,
        "pythonPath": PathBuf::from(python_path).to_string_lossy().to_string(),
        "venvPath": env_status.venv_path
    }]);
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
