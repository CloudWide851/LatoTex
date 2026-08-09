use crate::models::{Ack, AgentApprovalRequest, AgentExecuteRequest, AgentExecuteStartAccepted};
use crate::state::AppState;
use crate::storage::{self, AgentApprovalContext};
use serde_json::{json, Value};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use uuid::Uuid;

use super::research_planning::{
    is_research_planning_request, preflight_research_planning_model, run_research_planning,
    validate_research_planning_request,
};
use super::swarm_events::{append_protocol_event, run_envelope, EventMetadata};
use super::swarm_executor::run_execute_pipeline_async;
use super::swarm_harness::{
    apply_harness_prompt, harness_should_use_team, resolve_harness_profile,
};
use super::swarm_permissions::{preflight_permissions, PermissionPreflight};
use super::swarm_terminal_payload::{build_run_terminal_payload, build_slot_failure_payload};
use super::swarm_workflows::{
    load_registry_for_project, resolve_workflow, validate_invocation, validate_step_tools,
    WorkflowDefinition,
};

const AGENT_MAX_CONCURRENT: u32 = 4;

struct AgentRunSlotGuard {
    slots: Arc<(std::sync::Mutex<u32>, std::sync::Condvar)>,
}

impl Drop for AgentRunSlotGuard {
    fn drop(&mut self) {
        let (lock, cvar) = &*self.slots;
        if let Ok(mut current) = lock.lock() {
            *current = current.saturating_sub(1);
            cvar.notify_one();
        }
    }
}

fn acquire_agent_slot_from(
    slots: Arc<(std::sync::Mutex<u32>, std::sync::Condvar)>,
) -> Result<AgentRunSlotGuard, String> {
    let (lock, cvar) = &*slots;
    let mut current = lock
        .lock()
        .map_err(|_| "failed to lock agent slots".to_string())?;
    while *current >= AGENT_MAX_CONCURRENT {
        current = cvar
            .wait(current)
            .map_err(|_| "failed to wait for agent slot".to_string())?;
    }
    *current = current.saturating_add(1);
    drop(current);
    Ok(AgentRunSlotGuard { slots })
}

fn prepare_harnessed_input(
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    execution_profile: &crate::models::AgentProfile,
) -> AgentExecuteRequest {
    let harness_profile = resolve_harness_profile(input, workflow);
    let mut harnessed = input.clone();
    let harness_prompt = apply_harness_prompt(&harness_profile, &input.prompt);
    let use_team = harness_should_use_team(input, &harness_profile);
    harnessed.prompt = if use_team && input.graph_template_id.is_some() {
        harness_prompt
    } else {
        [
            format!("[agent_profile]\nid={}", execution_profile.id),
            "[identity]".to_string(),
            execution_profile.identity_prompt.clone(),
            format!(
                "[permission_ceiling]\ntools={}\nwrite_scopes={}",
                execution_profile.tool_ids.join(","),
                execution_profile.write_scopes.join(",")
            ),
            harness_prompt,
        ]
        .join("\n")
    };
    harnessed.harness_profile_id = Some(harness_profile.id.to_string());
    harnessed.team_mode = Some(if use_team { "force" } else { "off" }.to_string());
    harnessed
}

fn approval_payload(
    approval: &AgentApprovalRequest,
    callsite: &str,
    status: &str,
    decision: Option<&str>,
) -> Value {
    let mut payload = run_envelope(
        &approval.run_id,
        status,
        "Permission Approval",
        "",
        &format!("{}:approval:{}", approval.run_id, approval.approval_id),
        EventMetadata {
            phase: Some("approval"),
            node_id: Some("approval:permissions"),
            requires_approval: Some(status == "waiting_approval"),
            ..EventMetadata::base(&approval.workflow_id, "approval.permissions", callsite)
        },
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("approvalId".to_string(), json!(approval.approval_id));
        object.insert("capabilities".to_string(), json!(approval.capabilities));
        object.insert("expiresAt".to_string(), json!(approval.expires_at));
        if let Some(decision) = decision {
            object.insert("decision".to_string(), json!(decision));
        }
    }
    payload
}

fn append_terminal_event(
    db_path: &std::path::Path,
    run_id: &str,
    project_id: &str,
    workflow_id: &str,
    callsite: &str,
    kind: &str,
    content: &str,
) {
    let _ = append_protocol_event(
        db_path,
        run_id,
        project_id,
        workflow_id,
        kind,
        build_run_terminal_payload(run_id, workflow_id, callsite, kind, content),
    );
}

fn terminalize_run(
    db_path: &std::path::Path,
    run_id: &str,
    project_id: &str,
    workflow_id: &str,
    callsite: &str,
    status: &str,
    kind: &str,
    content: &str,
) {
    if storage::terminalize_agent_run_if_open(db_path, run_id, status, None).unwrap_or(false) {
        append_terminal_event(
            db_path,
            run_id,
            project_id,
            workflow_id,
            callsite,
            kind,
            content,
        );
    }
}

fn append_approval_resolution(state: &AppState, context: &AgentApprovalContext, decision: &str) {
    let callsite = serde_json::from_str::<AgentExecuteRequest>(&context.request_json)
        .map(|input| input.callsite)
        .unwrap_or_else(|_| "agent.approval".to_string());
    let _ = append_protocol_event(
        &state.db_path,
        &context.approval.run_id,
        &context.approval.project_id,
        &context.approval.workflow_id,
        "agent.approval.resolved",
        approval_payload(&context.approval, &callsite, "resolved", Some(decision)),
    );
}

fn launch_agent_worker(
    state: &AppState,
    run_id: String,
    input: AgentExecuteRequest,
    workflow: WorkflowDefinition,
) -> Result<(), String> {
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = state
            .agent_cancel_flags
            .lock()
            .map_err(|_| "failed to lock agent cancel flags".to_string())?;
        if flags.contains_key(&run_id) {
            return Err("agent.run.already_active".to_string());
        }
        flags.insert(run_id.clone(), cancel_flag.clone());
    }

    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let app_data_dir = state.app_data_dir.clone();
    let session_log_path = state.session_log_path.clone();
    let slots = state.agent_slots.clone();
    let cancel_flags = state.agent_cancel_flags.clone();
    thread::spawn(move || {
        let project_id = input.project_id.clone();
        let workflow_id = workflow.id.clone();
        let callsite = input.callsite.clone();
        let slot_guard = match acquire_agent_slot_from(slots) {
            Ok(guard) => guard,
            Err(message) => {
                if storage::terminalize_agent_run_if_open(&db_path, &run_id, "failed", None)
                    .unwrap_or(false)
                {
                    let _ = append_protocol_event(
                        &db_path,
                        &run_id,
                        &project_id,
                        &workflow_id,
                        "agent.run.failed",
                        build_slot_failure_payload(
                            &run_id,
                            &workflow_id,
                            &callsite,
                            &input.context_refs,
                            &message,
                        ),
                    );
                }
                if let Ok(mut flags) = cancel_flags.lock() {
                    flags.remove(&run_id);
                }
                return;
            }
        };
        let _slot_guard = slot_guard;
        let lease_id = Uuid::new_v4().to_string();
        if let Err(error) =
            storage::update_agent_run_status(&db_path, &run_id, "running", Some(&lease_id))
        {
            terminalize_run(
                &db_path,
                &run_id,
                &project_id,
                &workflow_id,
                &callsite,
                "failed",
                "agent.run.failed",
                &error,
            );
        } else {
            let result = if is_research_planning_request(&input) {
                run_research_planning(
                    &db_path,
                    &runtime_root,
                    &run_id,
                    &cancel_flag,
                    &input,
                    &workflow,
                )
            } else {
                run_execute_pipeline_async(
                    db_path.clone(),
                    runtime_root,
                    app_data_dir,
                    session_log_path,
                    run_id.clone(),
                    cancel_flag,
                    input,
                    workflow,
                )
            };
            match result {
                Ok(output) => terminalize_run(
                    &db_path,
                    &run_id,
                    &project_id,
                    &workflow_id,
                    &callsite,
                    "completed",
                    "agent.run.completed",
                    &output,
                ),
                Err(error) if error == "agent.run.cancelled" => terminalize_run(
                    &db_path,
                    &run_id,
                    &project_id,
                    &workflow_id,
                    &callsite,
                    "cancelled",
                    "agent.run.cancelled",
                    "",
                ),
                Err(error) => terminalize_run(
                    &db_path,
                    &run_id,
                    &project_id,
                    &workflow_id,
                    &callsite,
                    "failed",
                    "agent.run.failed",
                    &error,
                ),
            }
        }
        if let Ok(mut flags) = cancel_flags.lock() {
            flags.remove(&run_id);
        }
    });
    Ok(())
}

fn emit_run_accepted(
    db_path: &std::path::Path,
    run_id: &str,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<(), String> {
    append_protocol_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "agent.run.accepted",
        run_envelope(
            run_id,
            "accepted",
            "Run Accepted",
            "",
            &format!("{run_id}:run:accepted"),
            EventMetadata {
                phase: Some("run"),
                node_id: Some("run:accepted"),
                harness_profile_id: input.harness_profile_id.as_deref(),
                ..EventMetadata::base(&workflow.id, "run", &input.callsite)
            },
        ),
    )
}

pub fn agent_execute_start(
    state: &AppState,
    mut input: AgentExecuteRequest,
) -> Result<AgentExecuteStartAccepted, String> {
    state.log(
        "INFO",
        &format!(
            "agent_execute_start: workflow={}, callsite={}, project={}",
            input.workflow_id, input.callsite, input.project_id
        ),
    );
    let registry = load_registry_for_project(&state.db_path, &input.project_id)?;
    let workflow = resolve_workflow(&registry, &input.workflow_id)?.clone();
    validate_invocation(&workflow, &input.callsite, &input.context_refs)?;
    validate_step_tools(&workflow)?;
    validate_research_planning_request(&state.db_path, &input)?;
    let selection = if is_research_planning_request(&input) {
        let profile = storage::get_agent_profile(&state.db_path, "builtin-planner")?
            .ok_or_else(|| "agent.profile.not_found".to_string())?;
        storage::AgentExecutionSelection {
            profile,
            graph_template: None,
        }
    } else {
        storage::resolve_agent_execution_selection(&state.db_path, &input)?
    };
    input.profile_id = Some(selection.profile.id.clone());
    input.graph_template_id = selection
        .graph_template
        .as_ref()
        .map(|graph| graph.id.clone());
    if selection.graph_template.is_none()
        && input
            .model_override
            .as_deref()
            .unwrap_or_default()
            .is_empty()
    {
        input.model_override = selection.profile.model_id.clone();
    }
    let harnessed_input = prepare_harnessed_input(&input, &workflow, &selection.profile);
    preflight_research_planning_model(
        &state.db_path,
        &state.runtime_root,
        &harnessed_input,
        &workflow,
    )?;
    let preflight = preflight_permissions(
        &state.db_path,
        &state.runtime_root,
        &input,
        &workflow,
        &selection,
    )?;

    let run_id = Uuid::new_v4().to_string();
    storage::insert_agent_run(&state.db_path, &run_id, &input)?;
    emit_run_accepted(&state.db_path, &run_id, &harnessed_input, &workflow)?;

    match preflight {
        PermissionPreflight::Allowed => {
            launch_agent_worker(state, run_id.clone(), harnessed_input, workflow)?;
            Ok(AgentExecuteStartAccepted {
                run_id,
                status: "accepted".to_string(),
            })
        }
        PermissionPreflight::Pending(capabilities) => {
            let workflow_json = serde_json::to_string(&workflow).map_err(|e| e.to_string())?;
            let approval = storage::insert_agent_approval(
                &state.db_path,
                &run_id,
                &input,
                &workflow_json,
                &capabilities,
            )?;
            storage::update_agent_run_status(&state.db_path, &run_id, "waiting_approval", None)?;
            append_protocol_event(
                &state.db_path,
                &run_id,
                &input.project_id,
                &workflow.id,
                "agent.approval.requested",
                approval_payload(&approval, &input.callsite, "waiting_approval", None),
            )?;
            Ok(AgentExecuteStartAccepted {
                run_id,
                status: "waiting_approval".to_string(),
            })
        }
    }
}

pub(super) fn resolve_agent_approval(
    state: &AppState,
    approval_id: &str,
    decision: &str,
) -> Result<AgentExecuteStartAccepted, String> {
    let context = storage::resolve_agent_approval(&state.db_path, approval_id, decision)?;
    let input: AgentExecuteRequest =
        serde_json::from_str(&context.request_json).map_err(|e| e.to_string())?;
    let workflow: WorkflowDefinition =
        serde_json::from_str(&context.workflow_json).map_err(|e| e.to_string())?;
    append_protocol_event(
        &state.db_path,
        &context.approval.run_id,
        &context.approval.project_id,
        &context.approval.workflow_id,
        "agent.approval.resolved",
        approval_payload(
            &context.approval,
            &input.callsite,
            "resolved",
            Some(decision),
        ),
    )?;
    if decision == "deny" {
        terminalize_run(
            &state.db_path,
            &context.approval.run_id,
            &context.approval.project_id,
            &context.approval.workflow_id,
            &input.callsite,
            "cancelled",
            "agent.run.cancelled",
            "agent.approval.denied",
        );
        return Ok(AgentExecuteStartAccepted {
            run_id: context.approval.run_id,
            status: "denied".to_string(),
        });
    }
    let selection = storage::resolve_agent_execution_selection(&state.db_path, &input)?;
    let harnessed_input = prepare_harnessed_input(&input, &workflow, &selection.profile);
    storage::update_agent_run_status(&state.db_path, &context.approval.run_id, "accepted", None)?;
    launch_agent_worker(
        state,
        context.approval.run_id.clone(),
        harnessed_input,
        workflow,
    )?;
    Ok(AgentExecuteStartAccepted {
        run_id: context.approval.run_id,
        status: "accepted".to_string(),
    })
}

pub(super) fn cancel_agent_execution(state: &AppState, run_id: &str) -> Result<Ack, String> {
    if let Some(flag) = state
        .agent_cancel_flags
        .lock()
        .map_err(|_| "failed to lock agent cancel flags".to_string())?
        .get(run_id)
        .cloned()
    {
        flag.store(true, Ordering::Relaxed);
        return Ok(Ack {
            ok: true,
            message: "cancelling".to_string(),
        });
    }
    let approval_context =
        storage::get_pending_agent_approval_context_by_run(&state.db_path, run_id)?;
    if approval_context.is_some() && storage::cancel_pending_agent_approval(&state.db_path, run_id)?
    {
        let record = storage::get_agent_run_record(&state.db_path, run_id)?
            .ok_or_else(|| "agent run not found".to_string())?;
        if let Some(context) = approval_context.as_ref() {
            append_approval_resolution(state, context, "cancelled");
        }
        terminalize_run(
            &state.db_path,
            run_id,
            &record.project_id,
            &record.workflow_id,
            &record.callsite,
            "cancelled",
            "agent.run.cancelled",
            "",
        );
        return Ok(Ack {
            ok: true,
            message: "cancelled".to_string(),
        });
    }
    Err("agent run not found".to_string())
}

pub(super) fn expire_approval_context(state: &AppState, context: AgentApprovalContext) {
    let callsite = serde_json::from_str::<AgentExecuteRequest>(&context.request_json)
        .map(|input| input.callsite)
        .unwrap_or_else(|_| "agent.approval".to_string());
    append_approval_resolution(state, &context, "expired");
    terminalize_run(
        &state.db_path,
        &context.approval.run_id,
        &context.approval.project_id,
        &context.approval.workflow_id,
        &callsite,
        "cancelled",
        "agent.run.cancelled",
        "agent.approval.expired",
    );
}
