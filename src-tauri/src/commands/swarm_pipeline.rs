use crate::models::{AgentRunRequest, AgentRunStartAccepted};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use serde_json::json;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::thread;
use uuid::Uuid;
use super::swarm_events::{
    append_protocol_event, emit_response_event, emit_stage_event, emit_tool_event, envelope,
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

fn resolve_connection_for_role(
    db_path: &Path,
    runtime_root: &Path,
    role: &str,
    model_override: Option<&str>,
) -> Result<(String, String, String, String), String> {
    let (protocol_id, base_url, model_name, resolved_model_id) =
        storage::resolve_agent_model(db_path, role, model_override)?;
    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    };
    let api_key = secure::get_model_api_key(&secure_context, &resolved_model_id)?
        .api_key
        .ok_or_else(|| format!("API key is missing for model: {resolved_model_id}"))?;
    Ok((protocol_id, base_url, model_name, api_key))
}

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn call_model_output(
    db_path: &Path,
    runtime_root: &Path,
    role_for_model: &str,
    model_override: Option<&str>,
    prompt: &str,
    context_refs: &[String],
) -> Result<String, String> {
    let (protocol_id, base_url, model_name, api_key) =
        resolve_connection_for_role(db_path, runtime_root, role_for_model, model_override)?;
    let full_prompt = if context_refs.is_empty() {
        prompt.to_string()
    } else {
        format!("{}\n\n[Context]\n{}", prompt, context_refs.join("\n"))
    };
    super::call_provider_with_retry(&protocol_id, &base_url, &api_key, &model_name, &full_prompt)
}

fn run_stage_role(
    db_path: &Path,
    runtime_root: &Path,
    run_id: &str,
    project_id: &str,
    stage: &str,
    role_for_model: &str,
    source: &str,
    title: &str,
    prompt: &str,
    context_refs: &[String],
    cancel_flag: &Arc<AtomicBool>,
    model_override: Option<&str>,
    tool_name: &str,
) -> Result<String, String> {
    ensure_not_cancelled(cancel_flag)?;
    emit_stage_event(
        db_path,
        run_id,
        project_id,
        role_for_model,
        source,
        stage,
        "running",
        title,
        "",
    )?;
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        role_for_model,
        source,
        stage,
        tool_name,
        "running",
        "",
    )?;
    let output = call_model_output(
        db_path,
        runtime_root,
        role_for_model,
        model_override,
        prompt,
        context_refs,
    )?;
    ensure_not_cancelled(cancel_flag)?;
    emit_tool_event(
        db_path,
        run_id,
        project_id,
        role_for_model,
        source,
        stage,
        tool_name,
        "success",
        "",
    )?;
    emit_response_event(
        db_path,
        run_id,
        project_id,
        role_for_model,
        source,
        stage,
        &output,
    )?;
    emit_stage_event(
        db_path,
        run_id,
        project_id,
        role_for_model,
        source,
        stage,
        "success",
        title,
        "",
    )?;
    Ok(output)
}

fn run_agent_pipeline_async(
    db_path: PathBuf,
    runtime_root: PathBuf,
    run_id: String,
    cancel_flag: Arc<AtomicBool>,
    input: AgentRunRequest,
) -> Result<String, String> {
    if input.role == "web_search" {
        return super::swarm_tool_search::run_stage_tool_search(
            &db_path,
            &runtime_root,
            &run_id,
            &input.project_id,
            "web_search",
            "web_search",
            "explorer",
            "Tool Search",
            &input.prompt,
            &input.context_refs,
            &cancel_flag,
            input.model_override.as_deref(),
        );
    }

    if input.role != "task" {
        return run_stage_role(
            &db_path,
            &runtime_root,
            &run_id,
            &input.project_id,
            &input.role,
            &input.role,
            "tasker",
            "Task",
            &input.prompt,
            &input.context_refs,
            &cancel_flag,
            input.model_override.as_deref(),
            "provider_generate",
        );
    }

    let plan_prompt = [
        "You are a planning agent.",
        "Generate concise execution steps for the user request.",
        "Return markdown with sections: Goal, Steps, Risks.",
        "",
        "User request:",
        input.prompt.as_str(),
    ]
    .join("\n");
    let plan_output = run_stage_role(
        &db_path,
        &runtime_root,
        &run_id,
        &input.project_id,
        "plan",
        "plan",
        "planner",
        "Plan",
        &plan_prompt,
        &input.context_refs,
        &cancel_flag,
        None,
        "planner_reason",
    )?;

    let explore_prompt_a = format!(
        "Explore subtask A. Focus on LaTeX file impact and safe edit boundaries.\n\nPlan:\n{}",
        plan_output
    );
    let explore_prompt_b = format!(
        "Explore subtask B. Use structured web-search style notes and references.\n\nPlan:\n{}",
        plan_output
    );

    let db_a = db_path.clone();
    let runtime_a = runtime_root.clone();
    let run_a = run_id.clone();
    let project_a = input.project_id.clone();
    let context_a = input.context_refs.clone();
    let cancel_a = cancel_flag.clone();
    let handle_a = thread::spawn(move || {
        run_stage_role(
            &db_a,
            &runtime_a,
            &run_a,
            &project_a,
            "explore",
            "explore",
            "explorer",
            "Explore · LaTeX",
            &explore_prompt_a,
            &context_a,
            &cancel_a,
            None,
            "latex_file_scan",
        )
    });

    let db_b = db_path.clone();
    let runtime_b = runtime_root.clone();
    let run_b = run_id.clone();
    let project_b = input.project_id.clone();
    let context_b = input.context_refs.clone();
    let cancel_b = cancel_flag.clone();
    let handle_b = thread::spawn(move || {
        super::swarm_tool_search::run_stage_tool_search(
            &db_b,
            &runtime_b,
            &run_b,
            &project_b,
            "explore",
            "web_search",
            "explorer",
            "Explore · Web",
            &explore_prompt_b,
            &context_b,
            &cancel_b,
            None,
        )
    });

    let explore_a = handle_a
        .join()
        .map_err(|_| "explore subtask A panicked".to_string())??;
    let explore_b = handle_b
        .join()
        .map_err(|_| "explore subtask B panicked".to_string())??;

    let refine_prompt = format!(
        "Refine the execution plan using exploration results.\n\nOriginal Plan:\n{}\n\nExplore A:\n{}\n\nExplore B:\n{}",
        plan_output, explore_a, explore_b
    );
    let refined_plan = run_stage_role(
        &db_path,
        &runtime_root,
        &run_id,
        &input.project_id,
        "plan_refine",
        "plan",
        "planner",
        "Plan Refine",
        &refine_prompt,
        &input.context_refs,
        &cancel_flag,
        None,
        "planner_refine",
    )?;

    let task_prompt = format!(
        "Execute the refined plan.\nReturn ONLY IDE-style SEARCH/REPLACE edits in ```edit fences.\nDo not return prose-only explanations.\nEach edit block must include:\n- path: <relative path>\n- <<<<<<< SEARCH\n- =======\n- >>>>>>> REPLACE\nPrefer minimal partial edits and avoid full-file output unless absolutely necessary.\n\nRefined Plan:\n{}\n\nUser request:\n{}",
        refined_plan, input.prompt
    );
    let mut final_output = run_stage_role(
        &db_path,
        &runtime_root,
        &run_id,
        &input.project_id,
        "task",
        "task",
        "tasker",
        "Task",
        &task_prompt,
        &input.context_refs,
        &cancel_flag,
        input.model_override.as_deref(),
        "provider_generate",
    )?;

    if final_output.trim().is_empty() {
        let review_prompt = format!(
            "Task output was empty. Produce a usable final result.\n\nUser request:\n{}",
            input.prompt
        );
        final_output = run_stage_role(
            &db_path,
            &runtime_root,
            &run_id,
            &input.project_id,
            "review",
            "review",
            "reviewer",
            "Review",
            &review_prompt,
            &input.context_refs,
            &cancel_flag,
            None,
            "quality_review",
        )?;
    }

    Ok(final_output)
}

pub fn agent_run_start(
    state: &AppState,
    input: AgentRunRequest,
) -> Result<AgentRunStartAccepted, String> {
    state.log(
        "INFO",
        &format!(
            "agent_run_start: role={}, project={}",
            input.role, input.project_id
        ),
    );

    let run_id = Uuid::new_v4().to_string();
    storage::append_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &input.role,
        "agent.run.accepted",
        envelope(
            &run_id,
            "system",
            "run",
            "accepted",
            "Run Accepted",
            "",
            &format!("{run_id}:run:accepted"),
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
    let worker_role = input.role.clone();
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
                &worker_role,
                "a2a.task.failed",
                envelope(
                    &run_id_for_worker,
                    "system",
                    "run",
                    "error",
                    "Run Failed",
                    &message,
                    &format!("{run_id_for_worker}:run:failed"),
                ),
            );
            if let Ok(mut flags) = cancel_flags.lock() {
                flags.remove(&run_id_for_worker);
            }
            return;
        }
        let _slot_guard = slot_guard.unwrap();
        let run_output = run_agent_pipeline_async(
            db_path.clone(),
            runtime_root.clone(),
            run_id_for_worker.clone(),
            cancel_flag,
            input,
        );
        match run_output {
            Ok(output) => {
                let mut payload = envelope(
                    &run_id_for_worker,
                    "system",
                    "run",
                    "success",
                    "Run Completed",
                    "",
                    &format!("{run_id_for_worker}:run:completed"),
                );
                if let Some(object) = payload.as_object_mut() {
                    object.insert("output".to_string(), json!(output));
                }
                let _ = append_protocol_event(
                    &db_path,
                    &run_id_for_worker,
                    &worker_project_id,
                    &worker_role,
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
                        &worker_role,
                        "agent.run.cancelled",
                        envelope(
                            &run_id_for_worker,
                            "system",
                            "run",
                            "cancelled",
                            "Run Cancelled",
                            "",
                            &format!("{run_id_for_worker}:run:cancelled"),
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
                    &worker_role,
                    "agent.run.failed",
                    envelope(
                        &run_id_for_worker,
                        "system",
                        "run",
                        "error",
                        "Run Failed",
                        &error,
                        &format!("{run_id_for_worker}:run:failed"),
                    ),
                );
            }
        }
        if let Ok(mut flags) = cancel_flags.lock() {
            flags.remove(&run_id_for_worker);
        }
    });

    Ok(AgentRunStartAccepted {
        run_id,
        status: "accepted".to_string(),
    })
}
