use crate::models::{
    AgentExecuteRequest, ResearchPlanSaveInput, ResearchPlanStepDraft, ResearchPlanningDecision,
    ResearchPlanningEnvelope,
};
use crate::storage;
use serde_json::{json, Value};
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::swarm_events::{
    append_protocol_event, emit_response_completed_event, emit_stage_event, EventMetadata,
};
use super::swarm_runtime::{call_model_output_streaming, resolve_model_connection};
use super::swarm_workflows::WorkflowDefinition;

const PLANNING_WORKFLOW_ID: &str = "research-plan-discussion";
const PLANNING_CALLSITE: &str = "research.workbench";
const MAX_ASSISTANT_MESSAGE_CHARS: usize = 24_000;
const MAX_PLAN_TEXT_CHARS: usize = 8_000;
const MAX_LIST_ITEMS: usize = 32;

pub(super) fn is_research_planning_request(input: &AgentExecuteRequest) -> bool {
    input.workflow_id == PLANNING_WORKFLOW_ID && input.callsite == PLANNING_CALLSITE
}

pub(super) fn validate_research_planning_request(
    db_path: &std::path::Path,
    input: &AgentExecuteRequest,
) -> Result<(), String> {
    let planning = is_research_planning_request(input);
    match (planning, input.research_task_id.as_deref()) {
        (true, Some(task_id)) => {
            if !input.context_refs.is_empty() {
                return Err("research.planning.context_forbidden".to_string());
            }
            storage::ensure_research_task_exists(db_path, &input.project_id, task_id)
        }
        (true, None) => Err("research.planning.task_required".to_string()),
        (false, Some(_)) => Err("research.planning.scope_forbidden".to_string()),
        (false, None) => Ok(()),
    }
}

pub(super) fn preflight_research_planning_model(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<(), String> {
    if !is_research_planning_request(input) {
        return Ok(());
    }
    resolve_model_connection(
        db_path,
        runtime_root,
        &input.callsite,
        workflow,
        input.model_override.as_deref(),
    )
    .map(|_| ())
    .map_err(|_| "research.planning.model_unavailable".to_string())
}

fn validate_text(value: &str, allow_empty: bool) -> Result<(), String> {
    let trimmed = value.trim();
    if (!allow_empty && trimmed.is_empty()) || value.chars().count() > MAX_PLAN_TEXT_CHARS {
        return Err("research.planning.envelope_invalid".to_string());
    }
    Ok(())
}

fn validate_text_list(values: &[String]) -> Result<(), String> {
    if values.len() > MAX_LIST_ITEMS {
        return Err("research.planning.envelope_invalid".to_string());
    }
    for value in values {
        validate_text(value, false)?;
    }
    Ok(())
}

fn normalize_envelope(
    mut envelope: ResearchPlanningEnvelope,
) -> Result<ResearchPlanningEnvelope, String> {
    let assistant_message = envelope.assistant_message.trim();
    if assistant_message.is_empty()
        || envelope.assistant_message.chars().count() > MAX_ASSISTANT_MESSAGE_CHARS
    {
        return Err("research.planning.envelope_invalid".to_string());
    }
    envelope.assistant_message = assistant_message.to_string();
    validate_text_list(&envelope.assumptions)?;

    match envelope.decision {
        ResearchPlanningDecision::Clarify => {
            if envelope.questions.is_empty()
                || envelope.questions.len() > 5
                || envelope.plan.is_some()
            {
                return Err("research.planning.envelope_invalid".to_string());
            }
            for question in &envelope.questions {
                validate_identifier(&question.id)?;
                validate_text(&question.prompt, false)?;
                validate_text(&question.rationale, true)?;
                if question.choices.len() > 8 {
                    return Err("research.planning.envelope_invalid".to_string());
                }
                validate_text_list(&question.choices)?;
            }
        }
        ResearchPlanningDecision::Ready => {
            if !envelope.questions.is_empty() {
                return Err("research.planning.envelope_invalid".to_string());
            }
            let plan = envelope
                .plan
                .as_ref()
                .ok_or_else(|| "research.planning.envelope_invalid".to_string())?;
            validate_text(&plan.title, false)?;
            validate_text(&plan.summary, false)?;
            validate_text_list(&plan.expected_artifacts)?;
            validate_text_list(&plan.acceptance_criteria)?;
            if plan.steps.is_empty() || plan.steps.len() > MAX_LIST_ITEMS {
                return Err("research.planning.envelope_invalid".to_string());
            }
        }
        ResearchPlanningDecision::Blocked => {
            if envelope.plan.is_some() || !envelope.questions.is_empty() {
                return Err("research.planning.envelope_invalid".to_string());
            }
        }
    }
    Ok(envelope)
}

fn validate_identifier(value: &str) -> Result<(), String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("research.planning.envelope_invalid".to_string());
    }
    Ok(())
}

fn parse_planning_output(output: &str) -> Result<ResearchPlanningEnvelope, String> {
    let normalized = output.trim().trim_start_matches('\u{feff}');
    let envelope = serde_json::from_str::<ResearchPlanningEnvelope>(normalized)
        .map_err(|_| "research.planning.envelope_invalid".to_string())?;
    normalize_envelope(envelope)
}

fn save_ready_plan(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    input: &AgentExecuteRequest,
    envelope: &ResearchPlanningEnvelope,
) -> Result<Option<crate::models::ResearchPlanVersion>, String> {
    if envelope.decision != ResearchPlanningDecision::Ready {
        return Ok(None);
    }
    let plan = envelope
        .plan
        .as_ref()
        .ok_or_else(|| "research.planning.envelope_invalid".to_string())?;
    let steps = plan
        .steps
        .iter()
        .enumerate()
        .map(|(index, step)| {
            let id = step
                .id
                .clone()
                .unwrap_or_else(|| format!("step-{}", index + 1));
            validate_identifier(&id)?;
            for dependency in &step.dependencies {
                validate_identifier(dependency)?;
            }
            let descriptor = crate::research_agent::capability_descriptor(&step.capability)
                .map_err(|_| "research.planning.capability_invalid".to_string())?;
            crate::research_agent::parse_app_command(&step.capability, &step.input)
                .map_err(|_| "research.planning.capability_input_invalid".to_string())?;
            Ok(ResearchPlanStepDraft {
                id: Some(id),
                enabled: step.enabled,
                dependencies: step.dependencies.clone(),
                capability: step.capability.clone(),
                input: step.input.clone(),
                risk_level: descriptor.risk_level,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    let task_id = input
        .research_task_id
        .as_deref()
        .ok_or_else(|| "research.planning.task_required".to_string())?;
    let source_message =
        storage::load_research_task(db_path, runtime_root, &input.project_id, task_id)?.goal;
    storage::save_research_plan(
        db_path,
        runtime_root,
        ResearchPlanSaveInput {
            project_id: input.project_id.clone(),
            task_id: task_id.to_string(),
            source_message,
            authorized_project_ids: vec![input.project_id.clone()],
            title: plan.title.clone(),
            summary: plan.summary.clone(),
            assumptions: envelope.assumptions.clone(),
            expected_artifacts: plan.expected_artifacts.clone(),
            acceptance_criteria: plan.acceptance_criteria.clone(),
            steps,
        },
    )
    .map(Some)
}

fn planning_event_payload(
    run_id: &str,
    task_id: &str,
    envelope: &ResearchPlanningEnvelope,
    saved_plan: Option<&crate::models::ResearchPlanVersion>,
) -> Value {
    json!({
        "protocol": "json",
        "schema": "research-planning-envelope.v1",
        "runId": run_id,
        "taskId": task_id,
        "decision": envelope.decision,
        "assistantMessage": envelope.assistant_message,
        "questions": envelope.questions,
        "assumptions": envelope.assumptions,
        "planId": saved_plan.map(|plan| plan.id.as_str()),
        "planVersion": saved_plan.map(|plan| plan.version),
    })
}

pub(super) fn run_research_planning(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<String, String> {
    let task_id = input
        .research_task_id
        .as_deref()
        .ok_or_else(|| "research.planning.task_required".to_string())?;
    let connection = resolve_model_connection(
        db_path,
        runtime_root,
        &input.callsite,
        workflow,
        input.model_override.as_deref(),
    )
    .map_err(|_| "research.planning.model_unavailable".to_string())?;
    let metadata = EventMetadata {
        phase: Some("discussion"),
        node_id: Some("research:planning"),
        harness_profile_id: input.harness_profile_id.as_deref(),
        ..EventMetadata::base(&workflow.id, "planning", &input.callsite)
    };
    emit_stage_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "planner",
        "planning",
        "running",
        "research.planning.stage",
        "",
        metadata,
    )?;
    let output = call_model_output_streaming(
        db_path,
        &connection,
        &input.prompt,
        &[],
        input.bypass_cache,
        |_| Ok(()),
    )?;
    if cancel_flag.load(std::sync::atomic::Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    let envelope = parse_planning_output(&output)?;
    let saved_plan = save_ready_plan(db_path, runtime_root, input, &envelope)?;
    append_protocol_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "research.planning.result",
        planning_event_payload(run_id, task_id, &envelope, saved_plan.as_ref()),
    )?;
    emit_response_completed_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "planner",
        "planning",
        &envelope.assistant_message,
        &format!("{run_id}:research:planning:response"),
        metadata,
    )?;
    emit_stage_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "planner",
        "planning",
        "success",
        "research.planning.stage",
        "",
        metadata,
    )?;
    Ok(envelope.assistant_message)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "windows")]
    fn planning_fixture() -> (std::path::PathBuf, std::path::PathBuf, String) {
        let runtime_root = std::env::temp_dir().join(format!(
            "latotex-research-planning-{}",
            uuid::Uuid::new_v4()
        ));
        let db_path = runtime_root.join("latotex.db");
        std::fs::create_dir_all(runtime_root.join("projects")).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let project = storage::create_project(
            &db_path,
            &runtime_root.join("projects"),
            "Planning contract",
        )
        .unwrap();
        (runtime_root, db_path, project.summary.id)
    }

    #[cfg(target_os = "windows")]
    fn planning_request(project_id: &str, task_id: Option<String>) -> AgentExecuteRequest {
        AgentExecuteRequest {
            project_id: project_id.to_string(),
            workflow_id: PLANNING_WORKFLOW_ID.to_string(),
            callsite: PLANNING_CALLSITE.to_string(),
            prompt: "Plan a reproducible review".to_string(),
            context_refs: Vec::new(),
            model_override: None,
            bypass_cache: true,
            team_mode: Some("off".to_string()),
            harness_profile_id: Some("research.planning".to_string()),
            profile_id: Some("builtin-planner".to_string()),
            graph_template_id: None,
            research_task_id: task_id,
        }
    }

    #[test]
    fn strict_planning_envelope_rejects_markdown_and_unknown_fields() {
        assert_eq!(
            parse_planning_output("```json\n{}\n```").unwrap_err(),
            "research.planning.envelope_invalid"
        );
        assert_eq!(
            parse_planning_output(
                r#"{"decision":"blocked","assistantMessage":"Configure a model.","questions":[],"assumptions":[],"plan":null,"extra":true}"#,
            )
            .unwrap_err(),
            "research.planning.envelope_invalid"
        );
    }

    #[test]
    fn clarification_is_bounded_and_ready_requires_a_plan() {
        let too_many = json!({
            "decision": "clarify",
            "assistantMessage": "Please clarify.",
            "questions": (0..6).map(|index| json!({"id": format!("q-{index}"), "prompt": "Question"})).collect::<Vec<_>>(),
            "assumptions": [],
            "plan": null
        });
        assert!(parse_planning_output(&too_many.to_string()).is_err());
        let missing_plan = json!({
            "decision": "ready",
            "assistantMessage": "Ready.",
            "questions": [],
            "assumptions": [],
            "plan": null
        });
        assert!(parse_planning_output(&missing_plan.to_string()).is_err());
    }

    #[test]
    fn ready_envelope_accepts_only_structured_registered_steps_later() {
        let ready = json!({
            "decision": "ready",
            "assistantMessage": "I prepared a reviewable plan.",
            "questions": [],
            "assumptions": ["The project scope is sufficient."],
            "plan": {
                "title": "Evidence review",
                "summary": "Search and assess evidence.",
                "steps": [{
                    "id": "search",
                    "enabled": true,
                    "dependencies": [],
                    "capability": "literature.search",
                    "input": {"queries": ["biomarker survival"]}
                }],
                "expectedArtifacts": ["Evidence table"],
                "acceptanceCriteria": ["Claims are traceable"]
            }
        });
        let envelope = parse_planning_output(&ready.to_string()).unwrap();
        assert_eq!(envelope.decision, ResearchPlanningDecision::Ready);
        assert_eq!(envelope.plan.unwrap().steps.len(), 1);
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn research_task_scope_is_limited_to_the_builtin_planning_route() {
        let (runtime_root, db_path, project_id) = planning_fixture();
        let task = storage::create_research_task(
            &db_path,
            &runtime_root,
            crate::models::ResearchTaskCreateInput {
                project_id: project_id.clone(),
                goal: "Plan a reproducible review".to_string(),
                chat_session_id: Some("chat-planning".to_string()),
            },
        )
        .unwrap();
        let request = planning_request(&project_id, Some(task.id));
        validate_research_planning_request(&db_path, &request).unwrap();

        let mut wrong_callsite = request.clone();
        wrong_callsite.callsite = "chat.workspace".to_string();
        assert_eq!(
            validate_research_planning_request(&db_path, &wrong_callsite).unwrap_err(),
            "research.planning.scope_forbidden"
        );
    }
}
