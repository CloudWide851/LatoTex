use crate::models::AgentExecuteRequest;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::swarm_events::EventMetadata;
use super::swarm_external_dispatch::{selected_profile, try_run_external_step};
use super::swarm_tool_skills;
use super::swarm_workflows::{WorkflowDefinition, WorkflowStep};

pub(super) fn try_run_selected_external_pipeline(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    session_log_path: &Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<Option<String>, String> {
    let profile = selected_profile(db_path, input)?;
    if profile.runtime_id == "native" {
        return Ok(None);
    }
    let skill_context = swarm_tool_skills::build_workflow_skills_prompt(
        db_path,
        runtime_root,
        &workflow.id,
        &input.callsite,
        &input.prompt,
        &profile.skill_ids,
    );
    let prompt = swarm_tool_skills::append_skill_context(&input.prompt, &skill_context);
    let step = WorkflowStep {
        id: "external.execute".to_string(),
        kind: "provider.generate".to_string(),
        title: workflow.title.clone(),
        source: profile.runtime_id.clone(),
        retryable: Some(false),
        approval_required: Some(profile.write_scopes.iter().any(|scope| scope != "readonly")),
    };
    let metadata = EventMetadata::base(&workflow.id, &step.id, &input.callsite);
    try_run_external_step(
        db_path,
        runtime_root,
        app_data_dir,
        session_log_path,
        run_id,
        input,
        workflow,
        &step,
        &prompt,
        cancel_flag,
        &profile,
        metadata,
    )
}
