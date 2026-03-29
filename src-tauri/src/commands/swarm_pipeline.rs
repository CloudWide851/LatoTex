use crate::models::{AgentExecuteRequest, AgentExecuteStartAccepted};
use crate::state::AppState;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;
use std::thread;
use uuid::Uuid;

use super::swarm_events::{append_protocol_event, run_envelope, EventMetadata};
use super::swarm_executor::{
    build_run_terminal_payload, build_slot_failure_payload, run_execute_pipeline_async,
};
use super::swarm_workflows::{
    load_registry_for_project, resolve_workflow, validate_invocation, validate_step_tools,
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

pub fn agent_execute_start(
    state: &AppState,
    input: AgentExecuteRequest,
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

    let run_id = Uuid::new_v4().to_string();
    append_protocol_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &workflow.id,
        "agent.run.accepted",
        run_envelope(
            &run_id,
            "accepted",
            "Run Accepted",
            "",
            &format!("{run_id}:run:accepted"),
            EventMetadata {
                phase: Some("run"),
                node_id: Some("run:accepted"),
                parent_node_id: None,
                artifact_refs: Some(input.context_refs.as_slice()),
                ..EventMetadata::base(&workflow.id, "run", &input.callsite)
            },
        ),
    )?;

    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let run_id_for_worker = run_id.clone();
    let slots = state.agent_slots.clone();
    let cancel_flags = state.agent_cancel_flags.clone();
    let cancel_flag = Arc::new(AtomicBool::new(false));
    {
        let mut flags = cancel_flags
            .lock()
            .map_err(|_| "failed to lock agent cancel flags".to_string())?;
        flags.insert(run_id.clone(), cancel_flag.clone());
    }

    let worker_project_id = input.project_id.clone();
    let worker_workflow_id = workflow.id.clone();
    let worker_callsite = input.callsite.clone();
    thread::spawn(move || {
        let slot_guard = acquire_agent_slot_from(slots);
        if slot_guard.is_err() {
            let message = slot_guard
                .err()
                .unwrap_or_else(|| "failed to acquire slot".to_string());
            let _ = append_protocol_event(
                &db_path,
                &run_id_for_worker,
                &worker_project_id,
                &worker_workflow_id,
                "a2a.task.failed",
                build_slot_failure_payload(
                    &run_id_for_worker,
                    &worker_workflow_id,
                    &worker_callsite,
                    &input.context_refs,
                    &message,
                ),
            );
            if let Ok(mut flags) = cancel_flags.lock() {
                flags.remove(&run_id_for_worker);
            }
            return;
        }
        let _slot_guard = slot_guard.unwrap();
        let run_output = run_execute_pipeline_async(
            db_path.clone(),
            runtime_root.clone(),
            run_id_for_worker.clone(),
            cancel_flag,
            input,
            workflow,
        );
        match run_output {
            Ok(output) => {
                let _ = append_protocol_event(
                    &db_path,
                    &run_id_for_worker,
                    &worker_project_id,
                    &worker_workflow_id,
                    "agent.run.completed",
                    build_run_terminal_payload(
                        &run_id_for_worker,
                        &worker_workflow_id,
                        &worker_callsite,
                        "agent.run.completed",
                        &output,
                    ),
                );
            }
            Err(error) => {
                if error == "agent.run.cancelled" {
                    let _ = append_protocol_event(
                        &db_path,
                        &run_id_for_worker,
                        &worker_project_id,
                        &worker_workflow_id,
                        "agent.run.cancelled",
                        build_run_terminal_payload(
                            &run_id_for_worker,
                            &worker_workflow_id,
                            &worker_callsite,
                            "agent.run.cancelled",
                            "",
                        ),
                    );
                    if let Ok(mut flags) = cancel_flags.lock() {
                        flags.remove(&run_id_for_worker);
                    }
                    return;
                }
                let _ = append_protocol_event(
                    &db_path,
                    &run_id_for_worker,
                    &worker_project_id,
                    &worker_workflow_id,
                    "agent.run.failed",
                    build_run_terminal_payload(
                        &run_id_for_worker,
                        &worker_workflow_id,
                        &worker_callsite,
                        "agent.run.failed",
                        &error,
                    ),
                );
            }
        }
        if let Ok(mut flags) = cancel_flags.lock() {
            flags.remove(&run_id_for_worker);
        }
    });

    Ok(AgentExecuteStartAccepted {
        run_id,
        status: "accepted".to_string(),
    })
}
