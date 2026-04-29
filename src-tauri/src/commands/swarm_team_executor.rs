use crate::models::{AgentExecuteRequest, AgentTeamConfig, AgentTeamRolePrefs};
use crate::storage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::swarm_events::EventMetadata;
use super::swarm_executor::{
    emit_supervisor_trace, run_execute_pipeline_supervisor, run_workflow_step,
};
use super::swarm_runtime::resolve_model_connection;
use super::swarm_supervisor::requires_write_checkpoint;
use super::swarm_workflows::{timeout_for_workflow, WorkflowDefinition, WorkflowStep};

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn default_team_roles() -> Vec<AgentTeamRolePrefs> {
    vec![
        AgentTeamRolePrefs {
            id: "planner".to_string(),
            name: "Planner".to_string(),
            description: Some("Break the request into concrete tasks and constraints.".to_string()),
            identity_prompt: Some("You are the planning lead. Produce concise task structure, assumptions, and risks before execution.".to_string()),
            model_id: None,
            phase: Some("plan".to_string()),
            can_write: Some(false),
            tool_access: Some(vec!["workspace".to_string()]),
            mcp_server_ids: None,
            skill_ids: None,
            color: Some("#2563eb".to_string()),
            enabled: Some(true),
        },
        AgentTeamRolePrefs {
            id: "researcher".to_string(),
            name: "Researcher".to_string(),
            description: Some("Gather workspace, web, Python, MCP, and skill context.".to_string()),
            identity_prompt: Some("You are the research agent. Prefer evidence, cite files or tool outputs, and keep output compact.".to_string()),
            model_id: None,
            phase: Some("research".to_string()),
            can_write: Some(false),
            tool_access: Some(vec![
                "workspace".to_string(),
                "web".to_string(),
                "python".to_string(),
                "mcp".to_string(),
            ]),
            mcp_server_ids: Some(vec!["stitch".to_string()]),
            skill_ids: Some(vec!["stitch".to_string()]),
            color: Some("#0f766e".to_string()),
            enabled: Some(true),
        },
        AgentTeamRolePrefs {
            id: "editor".to_string(),
            name: "Editor".to_string(),
            description: Some("Prepare the final answer or file edit proposal.".to_string()),
            identity_prompt: Some("You are the editor agent. Turn prior findings into a precise answer or minimal file edit proposal.".to_string()),
            model_id: None,
            phase: Some("edit".to_string()),
            can_write: Some(true),
            tool_access: Some(vec!["workspace".to_string()]),
            mcp_server_ids: None,
            skill_ids: None,
            color: Some("#16a34a".to_string()),
            enabled: Some(true),
        },
        AgentTeamRolePrefs {
            id: "reviewer".to_string(),
            name: "Reviewer".to_string(),
            description: Some("Check regressions, edge cases, and missing validation.".to_string()),
            identity_prompt: Some("You are the reviewer agent. Challenge weak assumptions, verify scope, and summarize remaining risk.".to_string()),
            model_id: None,
            phase: Some("review".to_string()),
            can_write: Some(false),
            tool_access: Some(vec!["workspace".to_string()]),
            mcp_server_ids: None,
            skill_ids: None,
            color: Some("#a855f7".to_string()),
            enabled: Some(true),
        },
    ]
}

fn default_agent_team() -> AgentTeamConfig {
    AgentTeamConfig {
        id: "research-ide".to_string(),
        name: "Research IDE Team".to_string(),
        enabled: Some(true),
        callsites: Some(vec![
            "latex.overlay".to_string(),
            "analysis.workspace".to_string(),
            "chat.workspace".to_string(),
        ]),
        parallelism: Some(2),
        require_plan_approval: Some(false),
        roles: Some(default_team_roles()),
    }
}

fn callsite_supports_team(callsite: &str) -> bool {
    matches!(callsite, "latex.overlay" | "analysis.workspace" | "chat.workspace")
}

pub(super) fn select_agent_team(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    callsite: &str,
) -> Option<AgentTeamConfig> {
    if !callsite_supports_team(callsite) {
        return None;
    }
    let settings = storage::load_settings(db_path, runtime_root).ok()?;
    let prefs = settings.ui_prefs.and_then(|prefs| prefs.agent_team_prefs);
    let enabled = prefs.as_ref().and_then(|prefs| prefs.enabled).unwrap_or(true);
    if !enabled {
        return None;
    }
    let default_team_id = prefs
        .as_ref()
        .and_then(|prefs| prefs.default_team_id.clone())
        .unwrap_or_else(|| "research-ide".to_string());
    let mut teams = prefs.and_then(|prefs| prefs.teams).unwrap_or_default();
    if teams.is_empty() {
        teams.push(default_agent_team());
    }
    teams
        .iter()
        .find(|team| team.id == default_team_id)
        .or_else(|| teams.first())
        .filter(|team| team.enabled.unwrap_or(true))
        .filter(|team| {
            let callsites = team.callsites.clone().unwrap_or_default();
            callsites.is_empty()
                || callsites.iter().any(|item| item == callsite || item == "*")
        })
        .cloned()
}

fn role_tools(role: &AgentTeamRolePrefs) -> Vec<String> {
    role.tool_access.clone().unwrap_or_default()
}

fn role_identity(role: &AgentTeamRolePrefs) -> String {
    role.identity_prompt
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("You are a focused member of an IDE agent team. Stay concise and cite concrete evidence.")
        .to_string()
}

fn build_role_prompt(
    input: &AgentExecuteRequest,
    team: &AgentTeamConfig,
    role: &AgentTeamRolePrefs,
    previous_outputs: &[String],
) -> String {
    let skills = role.skill_ids.clone().unwrap_or_default();
    let mcp = role.mcp_server_ids.clone().unwrap_or_default();
    [
        format!("[team]\nid={}\nname={}", team.id, team.name),
        format!(
            "[role]\nid={}\nname={}\nphase={}\ncan_write={}",
            role.id,
            role.name,
            role.phase.as_deref().unwrap_or("research"),
            role.can_write.unwrap_or(false)
        ),
        format!("tools={}", role_tools(role).join(",")),
        format!("mcp_servers={}", mcp.join(",")),
        format!("skills={}", skills.join(",")),
        "[identity]".to_string(),
        role_identity(role),
        "[user_request]".to_string(),
        input.prompt.clone(),
        if previous_outputs.is_empty() {
            "[team_context]\nNo previous role output yet.".to_string()
        } else {
            format!("[team_context]\n{}", previous_outputs.join("\n\n---\n\n"))
        },
    ]
    .join("\n")
}

fn step_metadata<'a>(workflow_id: &'a str, step_id: &'a str, callsite: &'a str) -> EventMetadata<'a> {
    EventMetadata::base(workflow_id, step_id, callsite)
}

pub(super) fn run_execute_pipeline_team(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    team: AgentTeamConfig,
) -> Result<String, String> {
    let deadline = Instant::now() + Duration::from_millis(timeout_for_workflow(workflow));
    let active_roles = team
        .roles
        .clone()
        .unwrap_or_else(default_team_roles)
        .into_iter()
        .filter(|role| role.enabled.unwrap_or(true))
        .collect::<Vec<_>>();
    if active_roles.is_empty() {
        return run_execute_pipeline_supervisor(db_path, runtime_root, run_id, cancel_flag, input, workflow);
    }

    let plan_content = format!(
        "team={} parallelism={} roles={}",
        team.name,
        team.parallelism.unwrap_or(1).clamp(1, 4),
        active_roles
            .iter()
            .map(|role| format!("{}:{}", role.id, role.phase.as_deref().unwrap_or("research")))
            .collect::<Vec<_>>()
            .join(", ")
    );
    emit_supervisor_trace(
        db_path,
        run_id,
        input,
        workflow,
        "team.plan",
        "success",
        "Agent Team Plan",
        &plan_content,
        EventMetadata {
            phase: Some("plan"),
            node_id: Some("team:plan"),
            team_id: Some(team.id.as_str()),
            team_task_id: Some("team.plan"),
            artifact_refs: Some(input.context_refs.as_slice()),
            ..step_metadata(&workflow.id, "team.plan", &input.callsite)
        },
    )?;

    let mut role_outputs = Vec::<String>::new();
    let mut final_output = String::new();
    for role in active_roles {
        ensure_not_cancelled(cancel_flag)?;
        if Instant::now() >= deadline {
            return Err("agent.run.timeout.total".to_string());
        }
        let role_id = if role.id.trim().is_empty() { "role" } else { role.id.as_str() };
        let role_name = if role.name.trim().is_empty() { role_id } else { role.name.as_str() };
        let role_node_id = format!("team:{role_id}");
        let connection = resolve_model_connection(
            db_path,
            runtime_root,
            &input.callsite,
            workflow,
            input.model_override.as_deref().or(role.model_id.as_deref()),
        )?;
        let mut prompt = build_role_prompt(input, &team, &role, &role_outputs);
        for tool in role_tools(&role) {
            ensure_not_cancelled(cancel_flag)?;
            let (kind, title, source) = match tool.as_str() {
                "workspace" => ("tool.workspace", "Workspace Search", role_id.to_string()),
                "web" => ("tool.search", "Web Search", role_id.to_string()),
                "python" => ("tool.python", "Python Analysis", role_id.to_string()),
                "mcp" => {
                    let server = role
                        .mcp_server_ids
                        .as_ref()
                        .and_then(|items| items.first())
                        .cloned()
                        .unwrap_or_else(|| "stitch".to_string());
                    ("mcp.call", "MCP Call", format!("{server}:tools/list"))
                }
                _ => continue,
            };
            let step_id = format!("team.{role_id}.{tool}");
            let step = WorkflowStep {
                id: step_id.clone(),
                kind: kind.to_string(),
                title: title.to_string(),
                source,
                retryable: Some(true),
                approval_required: Some(false),
            };
            let tool_node_id = format!("{role_node_id}:tool:{tool}");
            let output = run_workflow_step(
                db_path,
                runtime_root,
                run_id,
                input,
                workflow,
                &step,
                &prompt,
                cancel_flag,
                &connection,
                EventMetadata {
                    phase: Some(role.phase.as_deref().unwrap_or("research")),
                    node_id: Some(tool_node_id.as_str()),
                    parent_node_id: Some(role_node_id.as_str()),
                    team_id: Some(team.id.as_str()),
                    team_role_id: Some(role_id),
                    team_role_name: Some(role_name),
                    team_task_id: Some(step_id.as_str()),
                    artifact_refs: Some(input.context_refs.as_slice()),
                    ..step_metadata(&workflow.id, step_id.as_str(), &input.callsite)
                },
            )?;
            if !output.trim().is_empty() {
                prompt = format!("{prompt}\n\n[{} tool output]\n{}", tool, output);
            }
        }

        let provider_step_id = format!("team.{role_id}.respond");
        let provider_step = WorkflowStep {
            id: provider_step_id.clone(),
            kind: "provider.generate".to_string(),
            title: role_name.to_string(),
            source: role_id.to_string(),
            retryable: Some(true),
            approval_required: Some(role.can_write.unwrap_or(false)),
        };
        let role_output = run_workflow_step(
            db_path,
            runtime_root,
            run_id,
            input,
            workflow,
            &provider_step,
            &prompt,
            cancel_flag,
            &connection,
            EventMetadata {
                phase: Some(role.phase.as_deref().unwrap_or("final")),
                node_id: Some(role_node_id.as_str()),
                parent_node_id: Some("team:plan"),
                team_id: Some(team.id.as_str()),
                team_role_id: Some(role_id),
                team_role_name: Some(role_name),
                team_task_id: Some(provider_step_id.as_str()),
                artifact_refs: Some(input.context_refs.as_slice()),
                requires_approval: Some(role.can_write.unwrap_or(false)),
                ..step_metadata(&workflow.id, provider_step_id.as_str(), &input.callsite)
            },
        )?;
        if !role_output.trim().is_empty() {
            final_output = role_output.clone();
            role_outputs.push(format!("[{}]\n{}", role_name, role_output));
        }
    }

    if requires_write_checkpoint(workflow) && !final_output.trim().is_empty() {
        emit_supervisor_trace(
            db_path,
            run_id,
            input,
            workflow,
            "team.checkpoint.write",
            "running",
            "Write Approval Required",
            "This team run produced a mutating result and requires explicit user approval before file changes are finalized.",
            EventMetadata {
                phase: Some("checkpoint"),
                node_id: Some("team:checkpoint:write"),
                parent_node_id: Some("team:plan"),
                team_id: Some(team.id.as_str()),
                team_task_id: Some("team.checkpoint.write"),
                decision: Some("user_approval_required"),
                risk_level: Some("high"),
                artifact_refs: Some(input.context_refs.as_slice()),
                requires_approval: Some(true),
                ..step_metadata(&workflow.id, "team.checkpoint.write", &input.callsite)
            },
        )?;
    }
    Ok(final_output)
}
