use crate::models::{AgentExecuteRequest, AgentProfile};
use crate::storage;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::swarm_events::{
    emit_response_completed_event, emit_response_delta_event, emit_response_event,
    emit_stage_event, emit_tool_event, EventMetadata,
};
use super::swarm_external_runtime::run_external_process;
use super::swarm_workflows::{WorkflowDefinition, WorkflowStep};

#[allow(clippy::too_many_arguments)]
pub(super) fn try_run_external_step(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    session_log_path: &Path,
    run_id: &str,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    step: &WorkflowStep,
    prompt: &str,
    cancel_flag: &Arc<AtomicBool>,
    profile: &AgentProfile,
    metadata: EventMetadata<'_>,
) -> Result<Option<String>, String> {
    if profile.runtime_id == "native" {
        return Ok(None);
    }
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    let stage = if step.id.trim().is_empty() {
        "external"
    } else {
        &step.id
    };
    let source = if step.source.trim().is_empty() {
        profile.runtime_id.as_str()
    } else {
        &step.source
    };
    let title = if step.title.trim().is_empty() {
        "External Agent"
    } else {
        &step.title
    };
    emit_stage_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
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
        &input.project_id,
        &workflow.id,
        source,
        stage,
        "external_agent",
        "running",
        &profile.runtime_id,
        metadata,
    )?;
    let card_key = format!("{run_id}:{stage}:{source}:{}:response", workflow.id);
    let mut streamed = false;
    let result = run_external_process(
        db_path,
        runtime_root,
        app_data_dir,
        session_log_path,
        run_id,
        &input.project_id,
        &project_root,
        profile,
        prompt,
        cancel_flag,
        |chunk| {
            streamed = true;
            emit_response_delta_event(
                db_path,
                run_id,
                &input.project_id,
                &workflow.id,
                source,
                stage,
                chunk,
                &card_key,
                metadata,
            )
        },
    );
    match result {
        Ok(output) => {
            emit_tool_event(
                db_path,
                run_id,
                &input.project_id,
                &workflow.id,
                source,
                stage,
                "external_agent",
                "success",
                &format!(
                    "runtime={}; chars={}",
                    profile.runtime_id,
                    output.chars().count()
                ),
                metadata,
            )?;
            if streamed {
                emit_response_completed_event(
                    db_path,
                    run_id,
                    &input.project_id,
                    &workflow.id,
                    source,
                    stage,
                    &output,
                    &card_key,
                    metadata,
                )?;
            } else {
                emit_response_event(
                    db_path,
                    run_id,
                    &input.project_id,
                    &workflow.id,
                    source,
                    stage,
                    &output,
                    metadata,
                )?;
            }
            emit_stage_event(
                db_path,
                run_id,
                &input.project_id,
                &workflow.id,
                source,
                stage,
                "success",
                title,
                "",
                metadata,
            )?;
            Ok(Some(output))
        }
        Err(error) if !error.output_started && profile.fallback_runtime_id == "native" => {
            emit_tool_event(
                db_path,
                run_id,
                &input.project_id,
                &workflow.id,
                source,
                stage,
                "external_agent",
                "fallback",
                &format!(
                    "runtime={}; code={}; fallback=native",
                    profile.runtime_id, error.failure.code
                ),
                metadata,
            )?;
            Ok(None)
        }
        Err(error) if error.failure.code == "agent.run.cancelled" => {
            Err("agent.run.cancelled".to_string())
        }
        Err(error) => Err(error.failure.code),
    }
}

pub(super) fn selected_profile(
    db_path: &Path,
    input: &AgentExecuteRequest,
) -> Result<AgentProfile, String> {
    storage::resolve_agent_execution_selection(db_path, input).map(|value| value.profile)
}
