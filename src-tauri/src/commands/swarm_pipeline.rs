use crate::models::{AgentExecuteRequest, AgentExecuteStartAccepted, AppSettings};
use crate::state::AppState;
use crate::storage;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use std::time::{Duration, Instant};
use uuid::Uuid;

use super::swarm_events::{
    append_protocol_event, emit_response_event, emit_stage_event, emit_tool_event, run_envelope,
    EventMetadata,
};
use super::swarm_harness::{
    apply_harness_prompt, harness_should_use_team, resolve_harness_profile,
};
use super::swarm_pipeline_team::{run_execute_pipeline_team, select_agent_team};
use super::swarm_tool_search;
use super::swarm_workflows::{
    load_registry_for_project, max_steps_for_workflow, resolve_workflow, timeout_for_workflow,
    validate_invocation, validate_step_tools, WorkflowDefinition, WorkflowStep,
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

#[derive(Debug, Clone)]
pub(super) struct ModelConnection {
    pub(super) protocol_id: String,
    pub(super) base_url: String,
    pub(super) model_name: String,
    pub(super) api_key: String,
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

fn call_model_output(
    db_path: &Path,
    connection: &ModelConnection,
    prompt: &str,
    context_refs: &[String],
    bypass_cache: bool,
) -> Result<String, String> {
    let full_prompt = build_prompt(prompt, context_refs);
    super::call_provider_with_retry(
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
        "git.summary" => bindings.analysis_agent_model_id.clone(),
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
        "",
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

fn run_execute_pipeline_async(
    db_path: PathBuf,
    runtime_root: PathBuf,
    run_id: String,
    cancel_flag: Arc<AtomicBool>,
    input: AgentExecuteRequest,
    workflow: WorkflowDefinition,
) -> Result<String, String> {
    let harness_profile = resolve_harness_profile(&input, &workflow);
    let mut harnessed_input = input.clone();
    harnessed_input.prompt = apply_harness_prompt(&harness_profile, &input.prompt);
    harnessed_input.harness_profile_id = Some(harness_profile.id.to_string());

    if harness_should_use_team(&harnessed_input, &harness_profile) {
        if let Some(team) = select_agent_team(&db_path, &runtime_root, &harnessed_input.callsite) {
            return run_execute_pipeline_team(
                &db_path,
                &runtime_root,
                &run_id,
                &cancel_flag,
                &harnessed_input,
                &workflow,
                team,
            );
        }
    }

    let connection = resolve_model_connection(
        &db_path,
        &runtime_root,
        &harnessed_input.callsite,
        &workflow,
        harnessed_input.model_override.as_deref(),
    )?;
    let max_steps = max_steps_for_workflow(&workflow);
    let timeout_ms = timeout_for_workflow(&workflow);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);

    let mut output = String::new();
    let steps = workflow.steps.iter().take(max_steps);
    for step in steps {
        ensure_not_cancelled(&cancel_flag)?;
        if Instant::now() >= deadline {
            return Err("agent.run.timeout.total".to_string());
        }
        let metadata = EventMetadata {
            harness_profile_id: Some(harness_profile.id),
            ..EventMetadata::base(&workflow.id, &step.id, &harnessed_input.callsite)
        };
        output = match step.kind.as_str() {
            "provider.generate" => run_provider_step(
                &db_path,
                &run_id,
                &harnessed_input.project_id,
                &workflow.id,
                step,
                &harnessed_input.prompt,
                &harnessed_input.context_refs,
                &cancel_flag,
                &connection,
                harnessed_input.bypass_cache,
                metadata,
            )?,
            "tool.search" => swarm_tool_search::run_stage_tool_search(
                &db_path,
                &runtime_root,
                &run_id,
                &harnessed_input.project_id,
                &workflow.id,
                &step.id,
                if step.source.trim().is_empty() {
                    "workflow"
                } else {
                    step.source.as_str()
                },
                if step.title.trim().is_empty() {
                    "Tool Search"
                } else {
                    step.title.as_str()
                },
                &harnessed_input.prompt,
                &harnessed_input.context_refs,
                &cancel_flag,
                &connection.protocol_id,
                &connection.base_url,
                &connection.api_key,
                &connection.model_name,
                harnessed_input.bypass_cache,
                metadata,
            )?,
            other => {
                return Err(format!("workflow.step.unsupported:{}", other));
            }
        };
    }

    Ok(output)
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
    let accepted_harness_profile = resolve_harness_profile(&input, &workflow);

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
                harness_profile_id: Some(accepted_harness_profile.id),
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
    let worker_harness_profile_id = accepted_harness_profile.id.to_string();
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
                run_envelope(
                    &run_id_for_worker,
                    "error",
                    "Run Failed",
                    &message,
                    &format!("{run_id_for_worker}:run:failed"),
                    EventMetadata {
                        phase: Some("run"),
                        node_id: Some("run:failed"),
                        harness_profile_id: Some(worker_harness_profile_id.as_str()),
                        ..EventMetadata::base(&worker_workflow_id, "run", &worker_callsite)
                    },
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
                let mut payload = run_envelope(
                    &run_id_for_worker,
                    "success",
                    "Run Completed",
                    "",
                    &format!("{run_id_for_worker}:run:completed"),
                    EventMetadata {
                        phase: Some("run"),
                        node_id: Some("run:completed"),
                        harness_profile_id: Some(worker_harness_profile_id.as_str()),
                        ..EventMetadata::base(&worker_workflow_id, "run", &worker_callsite)
                    },
                );
                if let Some(object) = payload.as_object_mut() {
                    object.insert("output".to_string(), json!(output));
                }
                let _ = append_protocol_event(
                    &db_path,
                    &run_id_for_worker,
                    &worker_project_id,
                    &worker_workflow_id,
                    "agent.run.completed",
                    payload,
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
                        run_envelope(
                            &run_id_for_worker,
                            "cancelled",
                            "Run Cancelled",
                            "",
                            &format!("{run_id_for_worker}:run:cancelled"),
                            EventMetadata {
                                phase: Some("run"),
                                node_id: Some("run:cancelled"),
                                harness_profile_id: Some(worker_harness_profile_id.as_str()),
                                ..EventMetadata::base(&worker_workflow_id, "run", &worker_callsite)
                            },
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
                    run_envelope(
                        &run_id_for_worker,
                        "error",
                        "Run Failed",
                        &error,
                        &format!("{run_id_for_worker}:run:failed"),
                        EventMetadata {
                            phase: Some("run"),
                            node_id: Some("run:failed"),
                            harness_profile_id: Some(worker_harness_profile_id.as_str()),
                            ..EventMetadata::base(&worker_workflow_id, "run", &worker_callsite)
                        },
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
