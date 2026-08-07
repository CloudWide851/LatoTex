use crate::models::{
    AgentAppCommand, ResearchPlanExecutionAccepted, ResearchPlanStep, ResearchPlanVersion,
};
use crate::state::AppState;
use crate::storage;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::time::Instant;

#[path = "research_agent_execution_audit.rs"]
mod audit;
#[path = "research_agent_execution_evidence.rs"]
mod evidence;
#[path = "research_agent_execution_order.rs"]
mod order;
#[path = "research_agent_execution_resources.rs"]
mod resources;
#[path = "research_agent_execution_worker.rs"]
mod worker;
use audit::record_capability_audit;
use evidence::archive_search_evidence;
use order::ordered_execution_steps;
use resources::{command_input_summary, command_resources, stable_diagnostic_code};
use worker::{claim_research_worker, research_worker_key, spawn_claimed_plan_worker};

#[derive(Clone)]
struct ResearchExecutionContext {
    db_path: PathBuf,
    runtime_root: PathBuf,
    app_data_dir: PathBuf,
    project_id: String,
}

fn execute_command(
    context: &ResearchExecutionContext,
    command: &AgentAppCommand,
) -> Result<Value, String> {
    match command {
        AgentAppCommand::ProjectOverview => {
            let snapshot = storage::project_snapshot(&context.db_path, &context.project_id)?;
            let integrity =
                storage::project_integrity_status(&context.db_path, &context.project_id)?;
            Ok(json!({
                "project": snapshot.summary,
                "workspaceItemCount": snapshot.tree.len(),
                "integrity": integrity,
            }))
        }
        AgentAppCommand::WorkspaceRead { path, max_chars } => {
            let file = storage::read_project_file(&context.db_path, &context.project_id, path)?;
            let max_chars = max_chars.unwrap_or(16_000).clamp(256, 32_768) as usize;
            let original_chars = file.content.chars().count();
            Ok(json!({
                "path": file.relative_path,
                "content": file.content.chars().take(max_chars).collect::<String>(),
                "truncated": original_chars > max_chars,
            }))
        }
        AgentAppCommand::LiteratureSearch { queries, deep } => {
            if queries.is_empty()
                || queries.len() > 8
                || queries
                    .iter()
                    .any(|query| query.trim().is_empty() || query.chars().count() > 1_000)
            {
                return Err("research.query.invalid".to_string());
            }
            let response = super::analysis::run_reference_check_queries_for_project(
                &context.db_path,
                &context.runtime_root,
                Some(&context.app_data_dir),
                Some(&context.project_id),
                queries.clone(),
                5,
                None,
                deep.unwrap_or(false),
            )?;
            serde_json::to_value(response).map_err(|_| "research.run.result_invalid".to_string())
        }
        AgentAppCommand::SubmissionCheck {
            main_path,
            profile_id,
        } => super::submission_pack::preview_submission_pack(
            &context.db_path,
            &context.project_id,
            main_path,
            profile_id.as_deref().unwrap_or("generic"),
        ),
        AgentAppCommand::RuntimeStatus => serde_json::to_value(
            super::agent_runtime::cached_runtime_catalog(&context.db_path),
        )
        .map_err(|_| "research.run.result_invalid".to_string()),
        _ => Err("research.capability.backend_unavailable".to_string()),
    }
}

fn step_dependencies_completed(
    context: &ResearchExecutionContext,
    run_id: &str,
    step: &ResearchPlanStep,
) -> Result<bool, String> {
    for dependency in &step.dependencies {
        if !storage::research_step_is_completed(
            &context.db_path,
            &context.project_id,
            run_id,
            dependency,
        )? {
            return Ok(false);
        }
    }
    Ok(true)
}

fn execute_with_lock_heartbeat(
    context: &ResearchExecutionContext,
    run_id: &str,
    has_locks: bool,
    command: &AgentAppCommand,
) -> Result<Value, String> {
    if !has_locks {
        return execute_command(context, command);
    }
    let (stop_sender, stop_receiver) = std::sync::mpsc::channel::<()>();
    let heartbeat_db_path = context.db_path.clone();
    let heartbeat_project_id = context.project_id.clone();
    let heartbeat_run_id = run_id.to_string();
    let heartbeat = std::thread::Builder::new()
        .name("latotex-research-lock-heartbeat".to_string())
        .spawn(move || loop {
            match stop_receiver.recv_timeout(std::time::Duration::from_secs(30)) {
                Ok(_) | Err(std::sync::mpsc::RecvTimeoutError::Disconnected) => break,
                Err(std::sync::mpsc::RecvTimeoutError::Timeout) => {
                    let _ = storage::heartbeat_research_resource_locks(
                        &heartbeat_db_path,
                        &heartbeat_project_id,
                        &heartbeat_run_id,
                    );
                }
            }
        })
        .map_err(|_| "research.lock.heartbeat_spawn_failed".to_string())?;
    let result = execute_command(context, command);
    let _ = stop_sender.send(());
    let _ = heartbeat.join();
    result
}

fn execute_plan(context: ResearchExecutionContext, run_id: String, plan: ResearchPlanVersion) {
    let outcome = execute_plan_inner(&context, &run_id, &plan);
    if let Err(error) = outcome {
        let current = storage::get_research_plan_run(
            &context.db_path,
            &context.runtime_root,
            &context.project_id,
            &run_id,
        )
        .ok();
        let completed = current.as_ref().map(|run| run.completed_steps).unwrap_or(0);
        let _ = storage::release_research_resource_locks(
            &context.db_path,
            &context.project_id,
            &run_id,
        );
        let _ = storage::update_research_run_progress(
            &context.db_path,
            &context.runtime_root,
            &context.project_id,
            &run_id,
            "failed",
            current
                .as_ref()
                .and_then(|run| run.current_step_id.as_deref()),
            completed,
            Some("Execution failed"),
            Some(&error),
        );
    }
}

fn execute_plan_inner(
    context: &ResearchExecutionContext,
    run_id: &str,
    plan: &ResearchPlanVersion,
) -> Result<(), String> {
    let mut completed = storage::get_research_plan_run(
        &context.db_path,
        &context.runtime_root,
        &context.project_id,
        run_id,
    )?
    .completed_steps;
    for step in ordered_execution_steps(plan)? {
        if storage::research_step_is_completed(
            &context.db_path,
            &context.project_id,
            run_id,
            &step.id,
        )? {
            continue;
        }
        let run = storage::get_research_plan_run(
            &context.db_path,
            &context.runtime_root,
            &context.project_id,
            run_id,
        )?;
        if run.status == "cancelled" || run.status == "paused" {
            storage::release_research_resource_locks(
                &context.db_path,
                &context.project_id,
                run_id,
            )?;
            return Ok(());
        }
        if !step_dependencies_completed(context, run_id, step)? {
            return Err("research.plan.dependency_incomplete".to_string());
        }
        let descriptor = crate::research_agent::capability_descriptor(&step.capability)?;
        let command = crate::research_agent::parse_app_command(&step.capability, &step.input)?;
        let input_summary = command_input_summary(step, &command);
        if descriptor.risk_level == "high"
            && !storage::research_step_is_approved(
                &context.db_path,
                &context.project_id,
                run_id,
                &step.id,
            )?
        {
            storage::request_research_plan_approval(
                &context.db_path,
                &context.runtime_root,
                &context.project_id,
                run_id,
                &step.id,
                &descriptor.risk_level,
                &step.capability,
            )?;
            record_capability_audit(
                context,
                run_id,
                step,
                &descriptor,
                "waiting_approval",
                &input_summary,
                None,
                None,
            )?;
            storage::update_research_run_progress(
                &context.db_path,
                &context.runtime_root,
                &context.project_id,
                run_id,
                "waiting_approval",
                Some(&step.id),
                completed,
                Some(&step.capability),
                None,
            )?;
            return Ok(());
        }
        storage::update_research_run_progress(
            &context.db_path,
            &context.runtime_root,
            &context.project_id,
            run_id,
            "running",
            Some(&step.id),
            completed,
            Some(&step.capability),
            None,
        )?;
        let resources = command_resources(&command);
        for (path, mode) in &resources {
            storage::acquire_research_resource_lock(
                &context.db_path,
                &context.project_id,
                run_id,
                path,
                mode,
            )?;
        }
        if descriptor.execution_target == "frontend" {
            let pending_command = serde_json::to_value(&command)
                .map_err(|_| "research.ui_command.encode_failed".to_string())?;
            storage::store_research_step_result(
                &context.db_path,
                &context.runtime_root,
                &context.project_id,
                run_id,
                &step.id,
                "waiting_ui",
                Some(&pending_command),
                None,
            )?;
            record_capability_audit(
                context,
                run_id,
                step,
                &descriptor,
                "waiting_ui",
                &input_summary,
                None,
                None,
            )?;
            storage::update_research_run_progress(
                &context.db_path,
                &context.runtime_root,
                &context.project_id,
                run_id,
                "waiting_ui",
                Some(&step.id),
                completed,
                Some(&step.capability),
                None,
            )?;
            return Ok(());
        }
        let execution_started = Instant::now();
        let result = execute_with_lock_heartbeat(context, run_id, !resources.is_empty(), &command);
        let duration_ms = execution_started
            .elapsed()
            .as_millis()
            .min(i64::MAX as u128) as i64;
        storage::release_research_resource_locks(&context.db_path, &context.project_id, run_id)?;
        let command_error = match result {
            Ok(result) => {
                if step.capability == "literature.search" {
                    archive_search_evidence(context, run_id, &plan.task_id, &result)?;
                }
                storage::store_research_step_result(
                    &context.db_path,
                    &context.runtime_root,
                    &context.project_id,
                    run_id,
                    &step.id,
                    "completed",
                    Some(&result),
                    None,
                )?;
                record_capability_audit(
                    context,
                    run_id,
                    step,
                    &descriptor,
                    "completed",
                    &input_summary,
                    Some(duration_ms),
                    None,
                )?;
                completed += 1;
                None
            }
            Err(error) => {
                storage::store_research_step_result(
                    &context.db_path,
                    &context.runtime_root,
                    &context.project_id,
                    run_id,
                    &step.id,
                    "failed",
                    None,
                    Some(&error),
                )?;
                let diagnostic = stable_diagnostic_code(&error);
                record_capability_audit(
                    context,
                    run_id,
                    step,
                    &descriptor,
                    "failed",
                    &input_summary,
                    Some(duration_ms),
                    Some(diagnostic),
                )?;
                Some(error)
            }
        };
        let current = storage::get_research_plan_run(
            &context.db_path,
            &context.runtime_root,
            &context.project_id,
            run_id,
        )?;
        if current.status == "cancelled" || current.status == "paused" {
            storage::update_research_run_progress(
                &context.db_path,
                &context.runtime_root,
                &context.project_id,
                run_id,
                &current.status,
                current.current_step_id.as_deref(),
                completed,
                current.last_operation.as_deref(),
                current.diagnostic_code.as_deref(),
            )?;
            return Ok(());
        }
        if let Some(error) = command_error {
            return Err(error);
        }
    }
    let current = storage::get_research_plan_run(
        &context.db_path,
        &context.runtime_root,
        &context.project_id,
        run_id,
    )?;
    if current.status == "cancelled" || current.status == "paused" {
        return Ok(());
    }
    storage::update_research_run_progress(
        &context.db_path,
        &context.runtime_root,
        &context.project_id,
        run_id,
        "validating",
        None,
        completed,
        Some("Validating plan outputs"),
        None,
    )?;
    storage::update_research_run_progress(
        &context.db_path,
        &context.runtime_root,
        &context.project_id,
        run_id,
        "completed",
        None,
        completed,
        Some("Plan completed"),
        None,
    )
}

fn execution_context(state: &AppState, project_id: &str) -> ResearchExecutionContext {
    ResearchExecutionContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
        app_data_dir: state.app_data_dir.clone(),
        project_id: project_id.to_string(),
    }
}

pub fn start_plan_execution(
    state: &AppState,
    project_id: &str,
    task_id: &str,
    version: i64,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let (run, plan) = storage::create_research_plan_run(
        &state.db_path,
        &state.runtime_root,
        project_id,
        task_id,
        version,
    )?;
    let run_id = run.run_id.clone();
    let worker_run_id = run_id.clone();
    let context = execution_context(state, project_id);
    let worker_key = research_worker_key(project_id, &run_id);
    if !claim_research_worker(&worker_key)? {
        return Err("research.run.already_active".to_string());
    }
    if let Err(error) = spawn_claimed_plan_worker(
        context,
        worker_run_id,
        plan,
        format!("latotex-research-{}", &run_id[..run_id.len().min(28)]),
        worker_key,
    ) {
        let _ = storage::update_research_run_progress(
            &state.db_path,
            &state.runtime_root,
            project_id,
            &run_id,
            "failed",
            None,
            0,
            Some("Worker start failed"),
            Some(&error),
        );
        return Err(error);
    }
    Ok(ResearchPlanExecutionAccepted {
        run_id,
        status: "running".to_string(),
    })
}

pub fn resume_plan_execution(
    state: &AppState,
    project_id: &str,
    run_id: &str,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let run =
        storage::get_research_plan_run(&state.db_path, &state.runtime_root, project_id, run_id)?;
    if matches!(run.status.as_str(), "completed" | "failed" | "cancelled") {
        return Err("research.run.terminal".to_string());
    }
    let plan = storage::load_research_plan_version(
        &state.db_path,
        &state.runtime_root,
        project_id,
        &run.task_id,
        run.plan_version,
    )?;
    let worker_key = research_worker_key(project_id, run_id);
    if !claim_research_worker(&worker_key)? {
        return Ok(ResearchPlanExecutionAccepted {
            run_id: run_id.to_string(),
            status: run.status,
        });
    }
    storage::update_research_run_progress(
        &state.db_path,
        &state.runtime_root,
        project_id,
        run_id,
        "running",
        run.current_step_id.as_deref(),
        run.completed_steps,
        run.last_operation.as_deref(),
        None,
    )?;
    let context = execution_context(state, project_id);
    let worker_run_id = run_id.to_string();
    if let Err(error) = spawn_claimed_plan_worker(
        context,
        worker_run_id,
        plan,
        "latotex-research-resume".to_string(),
        worker_key,
    ) {
        let _ = storage::update_research_run_progress(
            &state.db_path,
            &state.runtime_root,
            project_id,
            run_id,
            &run.status,
            run.current_step_id.as_deref(),
            run.completed_steps,
            run.last_operation.as_deref(),
            run.diagnostic_code.as_deref(),
        );
        return Err(error);
    }
    Ok(ResearchPlanExecutionAccepted {
        run_id: run_id.to_string(),
        status: "running".to_string(),
    })
}

#[cfg(test)]
#[path = "research_agent_execution_tests.rs"]
mod tests;
