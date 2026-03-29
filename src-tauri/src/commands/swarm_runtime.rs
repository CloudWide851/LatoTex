use crate::models::AppSettings;
use crate::storage;
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;

use super::call_provider_with_retry;
use super::swarm_events::{emit_response_event, emit_stage_event, emit_tool_event, EventMetadata};
use super::swarm_workflows::{WorkflowDefinition, WorkflowStep};

#[derive(Debug, Clone)]
pub(super) struct ModelConnection {
    pub protocol_id: String,
    pub base_url: String,
    pub model_name: String,
    pub api_key: String,
}

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn build_prompt(prompt: &str, context_refs: &[String]) -> String {
    if context_refs.is_empty() {
        return prompt.to_string();
    }
    format!("{}\n\n[Context]\n{}", prompt, context_refs.join("\n"))
}

pub(super) fn call_model_output(
    db_path: &Path,
    connection: &ModelConnection,
    prompt: &str,
    context_refs: &[String],
    bypass_cache: bool,
) -> Result<String, String> {
    let full_prompt = build_prompt(prompt, context_refs);
    call_provider_with_retry(
        Some(db_path),
        &connection.protocol_id,
        &connection.base_url,
        &connection.api_key,
        &connection.model_name,
        &full_prompt,
        bypass_cache,
    )
}

fn push_unique(values: &mut Vec<String>, candidate: Option<String>) {
    let Some(value) = candidate.map(|item| item.trim().to_string()) else {
        return;
    };
    if value.is_empty() {
        return;
    }
    if !values.iter().any(|existing| existing == &value) {
        values.push(value);
    }
}

fn pick_feature_binding(settings: &AppSettings, callsite: &str) -> Option<String> {
    let bindings = settings
        .ui_prefs
        .as_ref()
        .and_then(|prefs| prefs.feature_model_bindings.as_ref())?;
    match callsite {
        "latex.overlay" => bindings.latex_agent_model_id.clone(),
        "analysis.workspace" => bindings.analysis_agent_model_id.clone(),
        "chat.workspace" => bindings.translation_model_id.clone(),
        "completion.inline" => bindings.completion_model_id.clone(),
        "git.summary" => bindings
            .git_summary_model_id
            .clone()
            .or_else(|| bindings.analysis_agent_model_id.clone()),
        _ => None,
    }
}

pub(super) fn resolve_model_connection(
    db_path: &Path,
    runtime_root: &Path,
    callsite: &str,
    workflow: &WorkflowDefinition,
    model_override: Option<&str>,
) -> Result<ModelConnection, String> {
    let settings = storage::load_settings(db_path, runtime_root)?;

    let mut candidates = Vec::<String>::new();
    push_unique(
        &mut candidates,
        model_override.map(|item| item.trim().to_string()),
    );
    push_unique(&mut candidates, workflow.model_id.clone());
    push_unique(&mut candidates, pick_feature_binding(&settings, callsite));
    for model in &settings.model_catalog {
        push_unique(&mut candidates, Some(model.id.clone()));
    }

    for model_id in candidates {
        let resolved = storage::resolve_model_test_connection(db_path, runtime_root, &model_id);
        let Ok((protocol_id, base_url, model_name, api_key)) = resolved else {
            continue;
        };
        let Some(key) = api_key else {
            continue;
        };
        if key.trim().is_empty() {
            continue;
        }
        return Ok(ModelConnection {
            protocol_id,
            base_url,
            model_name,
            api_key: key,
        });
    }

    Err("workflow.model.unavailable".to_string())
}

pub(super) fn run_provider_step(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    step: &WorkflowStep,
    prompt: &str,
    context_refs: &[String],
    cancel_flag: &Arc<AtomicBool>,
    connection: &ModelConnection,
    bypass_cache: bool,
    metadata: EventMetadata<'_>,
) -> Result<String, String> {
    ensure_not_cancelled(cancel_flag)?;
    let stage = if step.id.trim().is_empty() {
        "step"
    } else {
        step.id.as_str()
    };
    let title = if step.title.trim().is_empty() {
        "Workflow Step"
    } else {
        step.title.as_str()
    };
    let source = if step.source.trim().is_empty() {
        "workflow"
    } else {
        step.source.as_str()
    };

    emit_stage_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "running",
        title,
        "",
        metadata,
    )?;
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "provider_generate",
        "running",
        "",
        metadata,
    )?;

    let output = call_model_output(db_path, connection, prompt, context_refs, bypass_cache)?;
    ensure_not_cancelled(cancel_flag)?;

    emit_tool_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "provider_generate",
        "success",
        &format!("chars={}", output.chars().count()),
        metadata,
    )?;
    emit_response_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        &output,
        metadata,
    )?;
    emit_stage_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        source,
        stage,
        "success",
        title,
        "",
        metadata,
    )?;
    Ok(output)
}
