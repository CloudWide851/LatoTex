use crate::models::{AgentExecuteRequest, AgentGraphNode, AgentGraphTemplate, AgentProfile};
use crate::storage;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::swarm_events::EventMetadata;
use super::swarm_executor::{emit_supervisor_trace, run_workflow_step};
use super::swarm_runtime::resolve_model_connection;
use super::swarm_tool_skills;
use super::swarm_workflows::{timeout_for_workflow, WorkflowDefinition, WorkflowStep};

#[derive(Clone)]
struct GraphNodeJob {
    node: AgentGraphNode,
    profile: AgentProfile,
    dependency_outputs: Vec<(String, String)>,
}

fn ensure_graph_running(cancel_flag: &Arc<AtomicBool>, deadline: Instant) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    if Instant::now() >= deadline {
        return Err("agent.run.timeout.total".to_string());
    }
    Ok(())
}

fn graph_dependencies(graph: &AgentGraphTemplate) -> HashMap<String, Vec<String>> {
    let mut dependencies = graph
        .nodes
        .iter()
        .map(|node| (node.id.clone(), Vec::new()))
        .collect::<HashMap<_, _>>();
    for edge in &graph.edges {
        dependencies
            .entry(edge.to.clone())
            .or_default()
            .push(edge.from.clone());
    }
    dependencies
}

fn ready_graph_nodes(
    graph: &AgentGraphTemplate,
    dependencies: &HashMap<String, Vec<String>>,
    terminal: &HashSet<String>,
    running: &HashSet<String>,
) -> Vec<String> {
    graph
        .nodes
        .iter()
        .filter(|node| !terminal.contains(&node.id) && !running.contains(&node.id))
        .filter(|node| {
            dependencies
                .get(&node.id)
                .into_iter()
                .flatten()
                .all(|dependency| terminal.contains(dependency))
        })
        .map(|node| node.id.clone())
        .collect()
}

fn profile_for_node(
    db_path: &std::path::Path,
    fallback: &AgentProfile,
    node: &AgentGraphNode,
) -> Result<AgentProfile, String> {
    match node.profile_id.as_deref() {
        Some(profile_id) => storage::get_agent_profile(db_path, profile_id)?
            .ok_or_else(|| "agent.profile.not_found".to_string()),
        None => Ok(fallback.clone()),
    }
}

fn graph_node_model_id<'a>(
    input: &'a AgentExecuteRequest,
    profile: &'a AgentProfile,
) -> Option<&'a str> {
    input
        .model_override
        .as_deref()
        .filter(|model_id| !model_id.trim().is_empty())
        .or(profile.model_id.as_deref())
}

fn build_graph_node_prompt(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    graph: &AgentGraphTemplate,
    job: &GraphNodeJob,
    repair_feedback: Option<&str>,
) -> String {
    let skill_context = swarm_tool_skills::build_workflow_skills_prompt(
        db_path,
        runtime_root,
        &workflow.id,
        &input.callsite,
        &input.prompt,
        &job.profile.skill_ids,
    );
    let dependency_context = if job.dependency_outputs.is_empty() {
        "No dependency output. Work only from the user request and shared evidence references."
            .to_string()
    } else {
        job.dependency_outputs
            .iter()
            .map(|(node_id, output)| format!("[dependency:{node_id}]\n{output}"))
            .collect::<Vec<_>>()
            .join("\n\n")
    };
    [
        format!(
            "[agent_graph]\nid={}\nnode={}\nrole={}",
            graph.id, job.node.id, job.node.role
        ),
        format!(
            "[profile]\nid={}\ntools={}\nwrite_scopes={}\ntool_budget={}\ntoken_budget={}",
            job.profile.id,
            job.profile.tool_ids.join(","),
            job.profile.write_scopes.join(","),
            job.profile.tool_call_budget,
            job.profile.token_budget
        ),
        "[identity]".to_string(),
        job.profile.identity_prompt.clone(),
        "[node_instruction]".to_string(),
        job.node.instruction.clone(),
        "[user_request]".to_string(),
        input.prompt.clone(),
        "[direct_dependencies]".to_string(),
        dependency_context,
        "[shared_evidence_refs]".to_string(),
        if input.context_refs.is_empty() {
            "(none)".to_string()
        } else {
            input.context_refs.join("\n")
        },
        "[validated_skill_context]".to_string(),
        if skill_context.is_empty() {
            "(none)".to_string()
        } else {
            skill_context
        },
        repair_feedback
            .map(|feedback| format!("[targeted_repair_feedback]\n{feedback}"))
            .unwrap_or_default(),
    ]
    .join("\n")
}

fn node_event_metadata<'a>(
    workflow_id: &'a str,
    step_id: &'a str,
    input: &'a AgentExecuteRequest,
    graph: &'a AgentGraphTemplate,
    node: &'a AgentGraphNode,
    parent_node_id: Option<&'a str>,
) -> EventMetadata<'a> {
    EventMetadata {
        phase: Some(node.role.as_str()),
        node_id: Some(node.id.as_str()),
        parent_node_id,
        team_id: Some(graph.id.as_str()),
        team_role_id: Some(node.role.as_str()),
        team_role_name: Some(node.title.as_str()),
        team_task_id: Some(step_id),
        artifact_refs: Some(input.context_refs.as_slice()),
        requires_approval: Some(node.role == "writer" && input.callsite == "latex.overlay"),
        ..EventMetadata::base(workflow_id, step_id, &input.callsite)
    }
}

fn execute_graph_node(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    graph: &AgentGraphTemplate,
    job: &GraphNodeJob,
    deadline: Instant,
    repair_feedback: Option<&str>,
) -> Result<String, String> {
    ensure_graph_running(cancel_flag, deadline)?;
    let node_deadline = Instant::now() + Duration::from_millis(job.profile.timeout_ms.min(600_000));
    let connection = resolve_model_connection(
        db_path,
        runtime_root,
        &input.callsite,
        workflow,
        graph_node_model_id(input, &job.profile),
    )?;
    let mut prompt = build_graph_node_prompt(
        db_path,
        runtime_root,
        input,
        workflow,
        graph,
        job,
        repair_feedback,
    );
    let tools = job
        .profile
        .tool_ids
        .iter()
        .take(job.profile.tool_call_budget as usize)
        .cloned()
        .collect::<Vec<_>>();
    for tool in tools {
        ensure_graph_running(cancel_flag, deadline.min(node_deadline))?;
        let source = match tool.as_str() {
            "workspace" | "web" | "python" => job.node.id.clone(),
            "mcp" => {
                let Some(server) = job.profile.mcp_server_ids.first() else {
                    prompt.push_str("\n\n[mcp.skipped]\nreason=mcp.server.not_configured");
                    continue;
                };
                format!("{server}:tools/list")
            }
            _ => continue,
        };
        let kind = match tool.as_str() {
            "workspace" => "tool.workspace",
            "web" => "tool.search",
            "python" => "tool.python",
            "mcp" => "mcp.call",
            _ => continue,
        };
        let step_id = format!("graph.{}.{}.{}", graph.id, job.node.id, tool);
        let step = WorkflowStep {
            id: step_id.clone(),
            kind: kind.to_string(),
            title: format!("{} · {}", job.node.title, tool),
            source,
            retryable: Some(true),
            approval_required: Some(false),
        };
        let parent = job
            .dependency_outputs
            .last()
            .map(|(node_id, _)| node_id.as_str())
            .or(Some("graph:plan"));
        let output = run_workflow_step(
            db_path,
            runtime_root,
            app_data_dir,
            run_id,
            input,
            workflow,
            &step,
            &prompt,
            cancel_flag,
            &connection,
            node_event_metadata(&workflow.id, &step_id, input, graph, &job.node, parent),
        )?;
        if !output.trim().is_empty() {
            prompt.push_str(&format!("\n\n[tool:{tool}]\n{output}"));
        }
    }
    ensure_graph_running(cancel_flag, deadline.min(node_deadline))?;
    let step_id = format!("graph.{}.{}.respond", graph.id, job.node.id);
    let step = WorkflowStep {
        id: step_id.clone(),
        kind: "provider.generate".to_string(),
        title: job.node.title.clone(),
        source: job.node.role.clone(),
        retryable: Some(true),
        approval_required: Some(
            job.profile
                .write_scopes
                .iter()
                .any(|scope| scope != "readonly"),
        ),
    };
    let parent = job
        .dependency_outputs
        .last()
        .map(|(node_id, _)| node_id.as_str())
        .or(Some("graph:plan"));
    run_workflow_step(
        db_path,
        runtime_root,
        app_data_dir,
        run_id,
        input,
        workflow,
        &step,
        &prompt,
        cancel_flag,
        &connection,
        node_event_metadata(&workflow.id, &step_id, input, graph, &job.node, parent),
    )
}

fn repair_target(output: &str) -> Option<String> {
    output.lines().find_map(|line| {
        line.trim()
            .strip_prefix("REPAIR_REQUIRED:")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_string)
    })
}

#[allow(clippy::too_many_arguments)]
pub(super) fn run_execute_pipeline_graph(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    fallback_profile: &AgentProfile,
    graph: &AgentGraphTemplate,
) -> Result<String, String> {
    storage::validate_agent_graph_template(graph)?;
    let deadline = Instant::now() + Duration::from_millis(timeout_for_workflow(workflow));
    let dependencies = graph_dependencies(graph);
    let plan = format!(
        "graph={} nodes={} parallelism={} context=direct_dependencies",
        graph.id,
        graph.nodes.len(),
        graph.max_parallelism.min(3)
    );
    emit_supervisor_trace(
        db_path,
        run_id,
        input,
        workflow,
        "graph.plan",
        "success",
        "Multi-Agent Workflow Plan",
        &plan,
        EventMetadata {
            phase: Some("plan"),
            node_id: Some("graph:plan"),
            team_id: Some(graph.id.as_str()),
            team_task_id: Some("graph.plan"),
            artifact_refs: Some(input.context_refs.as_slice()),
            ..EventMetadata::base(&workflow.id, "graph.plan", &input.callsite)
        },
    )?;

    let nodes = graph
        .nodes
        .iter()
        .map(|node| (node.id.clone(), node.clone()))
        .collect::<HashMap<_, _>>();
    let mut outputs = BTreeMap::<String, String>::new();
    let mut terminal = HashSet::<String>::new();
    let mut running = HashSet::<String>::new();
    let mut repair_used = false;
    while terminal.len() < graph.nodes.len() {
        ensure_graph_running(cancel_flag, deadline)?;
        let ready = ready_graph_nodes(graph, &dependencies, &terminal, &running);
        if ready.is_empty() {
            return Err("agent.graph.scheduler_stalled".to_string());
        }
        let batch = ready
            .into_iter()
            .take(graph.max_parallelism.clamp(1, 3) as usize)
            .collect::<Vec<_>>();
        let mut jobs = Vec::new();
        for node_id in &batch {
            running.insert(node_id.clone());
            let node = nodes
                .get(node_id)
                .cloned()
                .ok_or_else(|| "agent.graph.node_not_found".to_string())?;
            let profile = profile_for_node(db_path, fallback_profile, &node)?;
            let dependency_outputs = dependencies
                .get(node_id)
                .into_iter()
                .flatten()
                .filter_map(|dependency| {
                    outputs
                        .get(dependency)
                        .map(|output| (dependency.clone(), output.clone()))
                })
                .collect::<Vec<_>>();
            jobs.push(GraphNodeJob {
                node,
                profile,
                dependency_outputs,
            });
        }
        let results = std::thread::scope(|scope| {
            let handles = jobs
                .iter()
                .map(|job| {
                    scope.spawn(move || {
                        execute_graph_node(
                            db_path,
                            runtime_root,
                            app_data_dir,
                            run_id,
                            cancel_flag,
                            input,
                            workflow,
                            graph,
                            job,
                            deadline,
                            None,
                        )
                    })
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .zip(jobs.iter())
                .map(|(handle, job)| {
                    (
                        job.clone(),
                        handle
                            .join()
                            .unwrap_or_else(|_| Err("agent.graph.worker_panic".to_string())),
                    )
                })
                .collect::<Vec<_>>()
        });
        for (job, result) in results {
            running.remove(&job.node.id);
            match result {
                Ok(mut output) => {
                    if job.node.role == "reviewer" && !repair_used {
                        if let Some(target) = repair_target(&output) {
                            let allowed = dependencies
                                .get(&job.node.id)
                                .is_some_and(|items| items.contains(&target));
                            if allowed {
                                repair_used = true;
                                let target_node = nodes.get(&target).cloned().ok_or_else(|| {
                                    "agent.graph.repair_target_missing".to_string()
                                })?;
                                let repair_job = GraphNodeJob {
                                    profile: profile_for_node(
                                        db_path,
                                        fallback_profile,
                                        &target_node,
                                    )?,
                                    dependency_outputs: dependencies
                                        .get(&target)
                                        .into_iter()
                                        .flatten()
                                        .filter_map(|dependency| {
                                            outputs
                                                .get(dependency)
                                                .map(|value| (dependency.clone(), value.clone()))
                                        })
                                        .collect(),
                                    node: target_node,
                                };
                                let repaired = execute_graph_node(
                                    db_path,
                                    runtime_root,
                                    app_data_dir,
                                    run_id,
                                    cancel_flag,
                                    input,
                                    workflow,
                                    graph,
                                    &repair_job,
                                    deadline,
                                    Some(&output),
                                )?;
                                outputs.insert(target.clone(), repaired.clone());
                                output.push_str(&format!(
                                    "\n\n[targeted_repair:{target}]\n{repaired}"
                                ));
                            }
                        }
                    }
                    outputs.insert(job.node.id.clone(), output);
                    terminal.insert(job.node.id);
                }
                Err(error) if job.node.optional => {
                    emit_supervisor_trace(
                        db_path,
                        run_id,
                        input,
                        workflow,
                        &format!("graph.{}.optional_failure", job.node.id),
                        "failed",
                        &job.node.title,
                        "agent.graph.optional_node_failed",
                        EventMetadata {
                            phase: Some(job.node.role.as_str()),
                            node_id: Some(job.node.id.as_str()),
                            team_id: Some(graph.id.as_str()),
                            team_role_id: Some(job.node.role.as_str()),
                            decision: Some("degraded"),
                            artifact_refs: Some(input.context_refs.as_slice()),
                            ..EventMetadata::base(
                                &workflow.id,
                                "graph.optional_failure",
                                &input.callsite,
                            )
                        },
                    )?;
                    outputs.insert(
                        job.node.id.clone(),
                        format!("[optional node unavailable: {error}]"),
                    );
                    terminal.insert(job.node.id);
                }
                Err(error) => return Err(error),
            }
        }
    }
    let outgoing = graph
        .edges
        .iter()
        .map(|edge| edge.from.as_str())
        .collect::<BTreeSet<_>>();
    graph
        .nodes
        .iter()
        .rev()
        .find(|node| node.role == "synthesizer" && outputs.contains_key(&node.id))
        .or_else(|| {
            graph
                .nodes
                .iter()
                .rev()
                .find(|node| !outgoing.contains(node.id.as_str()))
        })
        .and_then(|node| outputs.get(&node.id))
        .cloned()
        .ok_or_else(|| "agent.graph.no_output".to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn scheduler_returns_only_dependency_ready_nodes_in_graph_order() {
        let graph = storage::built_in_research_graph("now");
        let dependencies = graph_dependencies(&graph);
        let mut terminal = HashSet::new();
        let running = HashSet::new();
        assert_eq!(
            ready_graph_nodes(&graph, &dependencies, &terminal, &running),
            vec!["plan"]
        );
        terminal.insert("plan".to_string());
        assert_eq!(
            ready_graph_nodes(&graph, &dependencies, &terminal, &running),
            vec!["research", "analysis"]
        );
    }

    #[test]
    fn reviewer_repair_marker_is_bounded_and_explicit() {
        assert_eq!(
            repair_target("ok\nREPAIR_REQUIRED:write\nexplain"),
            Some("write".to_string())
        );
        assert_eq!(repair_target("please improve everything"), None);
    }
}
