use crate::models::AgentExecuteRequest;
use serde_json::json;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::swarm_events::{emit_stage_event, run_envelope, EventMetadata};
use super::swarm_runtime::{resolve_model_connection, run_provider_step, ModelConnection};
use super::swarm_supervisor::{
    build_context_summary, build_evaluator_prompt, build_revision_prompt, build_supervisor_plan,
    execution_mode_label, parse_supervisor_evaluation, requires_write_checkpoint,
};
use super::swarm_team_executor::{run_execute_pipeline_team, select_agent_team, should_use_team};
use super::swarm_tool_search;
use super::{swarm_tool_mcp, swarm_tool_python, swarm_tool_skills, swarm_tool_workspace};
use super::swarm_workflows::{
    execution_mode_for_workflow, max_iterations_for_workflow, max_steps_for_workflow,
    timeout_for_workflow, WorkflowDefinition, WorkflowStep,
};

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn step_metadata<'a>(
    workflow_id: &'a str,
    step_id: &'a str,
    callsite: &'a str,
) -> EventMetadata<'a> {
    EventMetadata::base(workflow_id, step_id, callsite)
}

pub(super) fn run_workflow_step(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    run_id: &str,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    step: &WorkflowStep,
    prompt: &str,
    cancel_flag: &Arc<AtomicBool>,
    connection: &ModelConnection,
    metadata: EventMetadata<'_>,
) -> Result<String, String> {
    match step.kind.as_str() {
        "provider.generate" => run_provider_step(
            db_path,
            run_id,
            &input.project_id,
            &workflow.id,
            step,
            prompt,
            &input.context_refs,
            cancel_flag,
            connection,
            input.bypass_cache,
            metadata,
        ),
        "tool.search" => swarm_tool_search::run_stage_tool_search(
            db_path,
            runtime_root,
            run_id,
            &input.project_id,
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
            prompt,
            &input.context_refs,
            cancel_flag,
            &connection.protocol_id,
            &connection.base_url,
            &connection.api_key,
            &connection.model_name,
            input.bypass_cache,
            metadata,
        ),
        "tool.workspace" => swarm_tool_workspace::run_stage_workspace_search(
            db_path,
            runtime_root,
            run_id,
            &input.project_id,
            &workflow.id,
            &step.id,
            if step.source.trim().is_empty() { "workflow" } else { step.source.as_str() },
            if step.title.trim().is_empty() { "Workspace Search" } else { step.title.as_str() },
            prompt,
            cancel_flag,
            metadata,
        ),
        "tool.python" => swarm_tool_python::run_stage_python_probe(
            db_path,
            runtime_root,
            app_data_dir,
            run_id,
            &input.project_id,
            &workflow.id,
            &step.id,
            if step.source.trim().is_empty() { "workflow" } else { step.source.as_str() },
            if step.title.trim().is_empty() { "Python Analysis" } else { step.title.as_str() },
            prompt,
            cancel_flag,
            metadata,
        ),
        "mcp.call" => swarm_tool_mcp::run_stage_mcp_call(
            db_path,
            runtime_root,
            run_id,
            &input.project_id,
            &workflow.id,
            &step.id,
            if step.source.trim().is_empty() { "stitch:tools/list" } else { step.source.as_str() },
            if step.title.trim().is_empty() { "MCP Call" } else { step.title.as_str() },
            cancel_flag,
            metadata,
        ),
        other => Err(format!("workflow.step.unsupported:{}", other)),
    }
}

pub(super) fn emit_supervisor_trace(
    db_path: &std::path::Path,
    run_id: &str,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    stage: &str,
    status: &str,
    title: &str,
    content: &str,
    metadata: EventMetadata<'_>,
) -> Result<(), String> {
    emit_stage_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "supervisor",
        stage,
        status,
        title,
        content,
        metadata,
    )
}

fn run_execute_pipeline_single(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<String, String> {
    let connection = resolve_model_connection(
        db_path,
        runtime_root,
        &input.callsite,
        workflow,
        input.model_override.as_deref(),
    )?;
    let max_steps = max_steps_for_workflow(workflow);
    let timeout_ms = timeout_for_workflow(workflow);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let mut output = String::new();
    let skill_context = swarm_tool_skills::build_enabled_skills_prompt(db_path, runtime_root);
    let base_prompt = swarm_tool_skills::append_skill_context(&input.prompt, &skill_context);
    let mut step_prompt = base_prompt.clone();
    let mut tool_context = Vec::<String>::new();

    for step in workflow.steps.iter().take(max_steps) {
        ensure_not_cancelled(cancel_flag)?;
        if Instant::now() >= deadline {
            return Err("agent.run.timeout.total".to_string());
        }
        let step_id = if step.id.trim().is_empty() { "step" } else { step.id.as_str() };
        let node_id = format!("step:{step_id}");
        let metadata = EventMetadata {
            phase: Some("execute"),
            node_id: Some(node_id.as_str()),
            parent_node_id: None,
            artifact_refs: Some(input.context_refs.as_slice()),
            ..step_metadata(&workflow.id, step_id, &input.callsite)
        };
        output = run_workflow_step(
            db_path,
            runtime_root,
            app_data_dir,
            run_id,
            input,
            workflow,
            step,
            &step_prompt,
            cancel_flag,
            &connection,
            metadata,
        )?;
        if step.kind != "provider.generate" && !output.trim().is_empty() {
            tool_context.push(output.clone());
            step_prompt = format!("{base_prompt}\n\n[Previous Tool Output]\n{}", tool_context.join("\n\n"));
        }
    }

    Ok(output)
}

pub(super) fn run_execute_pipeline_supervisor(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<String, String> {
    let connection = resolve_model_connection(
        db_path,
        runtime_root,
        &input.callsite,
        workflow,
        input.model_override.as_deref(),
    )?;
    let max_steps = max_steps_for_workflow(workflow);
    let max_iterations = max_iterations_for_workflow(workflow);
    let timeout_ms = timeout_for_workflow(workflow);
    let deadline = Instant::now() + Duration::from_millis(timeout_ms);
    let plan_node_id = String::from("plan:workflow");
    let context_node_id = String::from("context:refs");

    let plan_metadata = EventMetadata {
        phase: Some("plan"),
        node_id: Some(plan_node_id.as_str()),
        parent_node_id: None,
        artifact_refs: Some(input.context_refs.as_slice()),
        ..step_metadata(&workflow.id, "plan.create", &input.callsite)
    };
    emit_supervisor_trace(
        db_path,
        run_id,
        input,
        workflow,
        "plan.create",
        "running",
        "Supervisor Planning",
        "Preparing plan for this run.",
        plan_metadata,
    )?;
    emit_supervisor_trace(
        db_path,
        run_id,
        input,
        workflow,
        "plan.create",
        "success",
        "Supervisor Plan",
        &build_supervisor_plan(workflow, &input.callsite, &input.context_refs),
        plan_metadata,
    )?;

    if !input.context_refs.is_empty() {
        let context_metadata = EventMetadata {
            phase: Some("context"),
            node_id: Some(context_node_id.as_str()),
            parent_node_id: Some(plan_node_id.as_str()),
            artifact_refs: Some(input.context_refs.as_slice()),
            ..step_metadata(&workflow.id, "context.collect", &input.callsite)
        };
        emit_supervisor_trace(
            db_path,
            run_id,
            input,
            workflow,
            "context.collect",
            "success",
            "Context Collected",
            &build_context_summary(&input.context_refs),
            context_metadata,
        )?;
    }

    let mut output = String::new();
    let skill_context = swarm_tool_skills::build_enabled_skills_prompt(db_path, runtime_root);
    let base_prompt = swarm_tool_skills::append_skill_context(&input.prompt, &skill_context);
    let mut step_prompt = base_prompt.clone();
    let mut tool_context = Vec::<String>::new();
    let parent_node = if input.context_refs.is_empty() {
        plan_node_id.as_str()
    } else {
        context_node_id.as_str()
    };

    for step in workflow.steps.iter().take(max_steps) {
        ensure_not_cancelled(cancel_flag)?;
        if Instant::now() >= deadline {
            return Err("agent.run.timeout.total".to_string());
        }
        let base_step_id = if step.id.trim().is_empty() { "step" } else { step.id.as_str() };
        let base_node_id = format!("step:{base_step_id}");

        if step.kind == "provider.generate" {
            let mut attempt_prompt = step_prompt.clone();
            let mut latest_output = String::new();
            for iteration in 0..max_iterations {
                ensure_not_cancelled(cancel_flag)?;
                if Instant::now() >= deadline {
                    return Err("agent.run.timeout.total".to_string());
                }
                let step_instance = if iteration == 0 {
                    step.clone()
                } else {
                    WorkflowStep {
                        id: format!("{}.revision{}", base_step_id, iteration + 1),
                        kind: step.kind.clone(),
                        title: if step.title.trim().is_empty() {
                            format!("Revision {}", iteration + 1)
                        } else {
                            format!("{} Revision {}", step.title.trim(), iteration + 1)
                        },
                        source: step.source.clone(),
                        retryable: step.retryable,
                        approval_required: step.approval_required,
                    }
                };
                let step_node_id = format!("{}:attempt{}", base_node_id, iteration + 1);
                let metadata = EventMetadata {
                    phase: Some("execute"),
                    node_id: Some(step_node_id.as_str()),
                    parent_node_id: Some(parent_node),
                    artifact_refs: Some(input.context_refs.as_slice()),
                    ..step_metadata(&workflow.id, step_instance.id.as_str(), &input.callsite)
                };
                latest_output = run_workflow_step(
                    db_path,
                    runtime_root,
                    app_data_dir,
                    run_id,
                    input,
                    workflow,
                    &step_instance,
                    &attempt_prompt,
                    cancel_flag,
                    &connection,
                    metadata,
                )?;

                let evaluator_step = WorkflowStep {
                    id: format!("{}.evaluator{}", base_step_id, iteration + 1),
                    kind: "provider.generate".to_string(),
                    title: "Evaluate Output".to_string(),
                    source: "supervisor".to_string(),
                    retryable: Some(false),
                    approval_required: Some(false),
                };
                let evaluator_node_id = format!("evaluate:{base_step_id}:{}", iteration + 1);
                let evaluator_metadata = EventMetadata {
                    phase: Some("evaluate"),
                    node_id: Some(evaluator_node_id.as_str()),
                    parent_node_id: Some(step_node_id.as_str()),
                    artifact_refs: Some(input.context_refs.as_slice()),
                    ..step_metadata(&workflow.id, evaluator_step.id.as_str(), &input.callsite)
                };
                let evaluator_raw = run_workflow_step(
                    db_path,
                    runtime_root,
                    app_data_dir,
                    run_id,
                    input,
                    workflow,
                    &evaluator_step,
                    &build_evaluator_prompt(workflow, &input.prompt, &latest_output),
                    cancel_flag,
                    &connection,
                    evaluator_metadata,
                )?;
                let evaluation = parse_supervisor_evaluation(&evaluator_raw, workflow);
                let evaluator_summary_node = format!("evaluate:{base_step_id}:{}:summary", iteration + 1);
                let summary_metadata = EventMetadata {
                    phase: Some("evaluate"),
                    node_id: Some(evaluator_summary_node.as_str()),
                    parent_node_id: Some(evaluator_node_id.as_str()),
                    decision: Some(evaluation.decision.as_str()),
                    risk_level: Some(evaluation.risk_level.as_str()),
                    artifact_refs: Some(input.context_refs.as_slice()),
                    requires_approval: Some(evaluation.requires_approval),
                    ..step_metadata(&workflow.id, evaluator_step.id.as_str(), &input.callsite)
                };
                let summary_content = [
                    format!("decision={}", evaluation.decision),
                    format!("risk={}", evaluation.risk_level),
                    format!("requires_approval={}", evaluation.requires_approval),
                    evaluation.summary.clone(),
                ]
                .join("\n");
                emit_supervisor_trace(
                    db_path,
                    run_id,
                    input,
                    workflow,
                    &format!("{}.evaluator.summary", base_step_id),
                    "success",
                    "Evaluator Decision",
                    &summary_content,
                    summary_metadata,
                )?;

                if evaluation.decision == "block" {
                    return Err(format!("agent.supervisor.blocked:{}", evaluation.summary));
                }
                if evaluation.decision != "revise" || iteration + 1 >= max_iterations {
                    break;
                }
                attempt_prompt = build_revision_prompt(&base_prompt, &evaluation, iteration + 1);
            }
            output = latest_output;
            continue;
        }

        let metadata = EventMetadata {
            phase: Some("execute"),
            node_id: Some(base_node_id.as_str()),
            parent_node_id: Some(parent_node),
            artifact_refs: Some(input.context_refs.as_slice()),
            ..step_metadata(&workflow.id, base_step_id, &input.callsite)
        };
        output = run_workflow_step(
            db_path,
            runtime_root,
            app_data_dir,
            run_id,
            input,
            workflow,
            step,
            &step_prompt,
            cancel_flag,
            &connection,
            metadata,
        )?;
        if !output.trim().is_empty() {
            tool_context.push(output.clone());
            step_prompt = format!("{base_prompt}\n\n[Previous Tool Output]\n{}", tool_context.join("\n\n"));
        }
    }

    if requires_write_checkpoint(workflow) && !output.trim().is_empty() {
        let checkpoint_node_id = String::from("checkpoint:write");
        let checkpoint_metadata = EventMetadata {
            phase: Some("checkpoint"),
            node_id: Some(checkpoint_node_id.as_str()),
            parent_node_id: Some(parent_node),
            decision: Some("user_approval_required"),
            risk_level: Some("high"),
            artifact_refs: Some(input.context_refs.as_slice()),
            requires_approval: Some(true),
            ..step_metadata(&workflow.id, "checkpoint.write", &input.callsite)
        };
        let checkpoint_content = [
            "approval_policy=checkpoint_on_write".to_string(),
            format!("execution_mode={}", execution_mode_label(workflow, &input.callsite)),
            "This run produced a mutating result and requires explicit user approval before file changes are finalized.".to_string(),
        ]
        .join("\n");
        emit_supervisor_trace(
            db_path,
            run_id,
            input,
            workflow,
            "checkpoint.write",
            "running",
            "Write Approval Required",
            &checkpoint_content,
            checkpoint_metadata,
        )?;
    }

    Ok(output)
}

pub(super) fn run_execute_pipeline_async(
    db_path: std::path::PathBuf,
    runtime_root: std::path::PathBuf,
    app_data_dir: std::path::PathBuf,
    run_id: String,
    cancel_flag: Arc<AtomicBool>,
    input: AgentExecuteRequest,
    workflow: WorkflowDefinition,
) -> Result<String, String> {
    if should_use_team(&input) {
        if let Some(team) = select_agent_team(&db_path, &runtime_root, &input.callsite) {
            return run_execute_pipeline_team(
                &db_path,
                &runtime_root,
                &app_data_dir,
                &run_id,
                &cancel_flag,
                &input,
                &workflow,
                team,
            );
        }
    }
    match execution_mode_for_workflow(&workflow, &input.callsite) {
        "single" => run_execute_pipeline_single(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &run_id,
            &cancel_flag,
            &input,
            &workflow,
        ),
        _ => run_execute_pipeline_supervisor(
            &db_path,
            &runtime_root,
            &app_data_dir,
            &run_id,
            &cancel_flag,
            &input,
            &workflow,
        ),
    }
}

pub(super) fn build_slot_failure_payload(
    run_id: &str,
    workflow_id: &str,
    callsite: &str,
    context_refs: &[String],
    message: &str,
) -> serde_json::Value {
    run_envelope(
        run_id,
        "error",
        "Run Failed",
        message,
        &format!("{run_id}:run:failed"),
        EventMetadata {
            phase: Some("run"),
            node_id: Some("run:failed"),
            parent_node_id: None,
            artifact_refs: Some(context_refs),
            ..EventMetadata::base(workflow_id, "run", callsite)
        },
    )
}

pub(super) fn build_run_terminal_payload(
    run_id: &str,
    workflow_id: &str,
    callsite: &str,
    kind: &str,
    content: &str,
) -> serde_json::Value {
    let (status, title, node_id) = match kind {
        "agent.run.completed" => ("success", "Run Completed", "run:completed"),
        "agent.run.cancelled" => ("cancelled", "Run Cancelled", "run:cancelled"),
        _ => ("error", "Run Failed", "run:failed"),
    };
    let mut payload = run_envelope(
        run_id,
        status,
        title,
        content,
        &format!("{run_id}:{node_id}"),
        EventMetadata {
            phase: Some("run"),
            node_id: Some(node_id),
            parent_node_id: None,
            artifact_refs: None,
            ..EventMetadata::base(workflow_id, "run", callsite)
        },
    );
    if kind == "agent.run.completed" {
        if let Some(object) = payload.as_object_mut() {
            object.insert("output".to_string(), json!(content));
        }
    }
    payload
}


