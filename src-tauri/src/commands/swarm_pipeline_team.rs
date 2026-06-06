use crate::models::{AgentExecuteRequest, AgentTeamConfig, AgentTeamRolePrefs};
use crate::storage;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use std::time::{Duration, Instant};

use super::swarm_events::{emit_stage_event, EventMetadata};
use super::swarm_pipeline::{resolve_model_connection, run_provider_step};
use super::swarm_tool_mcp;
use super::swarm_tool_search;
use super::swarm_tool_skills;
use super::swarm_workflows::{timeout_for_workflow, WorkflowDefinition, WorkflowStep};

fn ensure_not_cancelled(cancel_flag: &Arc<AtomicBool>) -> Result<(), String> {
    if cancel_flag.load(Ordering::Relaxed) {
        return Err("agent.run.cancelled".to_string());
    }
    Ok(())
}

fn callsite_supports_team(callsite: &str) -> bool {
    matches!(
        callsite,
        "latex.overlay" | "analysis.workspace" | "chat.workspace"
    )
}

fn default_team_roles() -> Vec<AgentTeamRolePrefs> {
    vec![
        AgentTeamRolePrefs {
            id: "planner".to_string(),
            name: "Planner".to_string(),
            description: Some("Break the request into constraints, tasks, and risks.".to_string()),
            identity_prompt: Some(
                "Plan the work. Keep assumptions explicit and identify missing evidence."
                    .to_string(),
            ),
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
            description: Some("Collect workspace, web, MCP, and skill context.".to_string()),
            identity_prompt: Some(
                "Gather evidence first. Prefer concrete files and tool output over guesses."
                    .to_string(),
            ),
            model_id: None,
            phase: Some("research".to_string()),
            can_write: Some(false),
            tool_access: Some(vec![
                "workspace".to_string(),
                "web".to_string(),
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
            description: Some("Turn evidence into the final answer or proposal.".to_string()),
            identity_prompt: Some(
                "Produce the minimal actionable answer and name affected files or workflows."
                    .to_string(),
            ),
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
            description: Some("Check regressions, edge cases, and validation gaps.".to_string()),
            identity_prompt: Some(
                "Challenge weak assumptions and list remaining risk clearly.".to_string(),
            ),
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
    if prefs
        .as_ref()
        .and_then(|prefs| prefs.enabled)
        .unwrap_or(true)
        == false
    {
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
            callsites.is_empty() || callsites.iter().any(|item| item == callsite || item == "*")
        })
        .cloned()
}

fn role_id(role: &AgentTeamRolePrefs) -> &str {
    if role.id.trim().is_empty() {
        "role"
    } else {
        role.id.as_str()
    }
}

fn role_name<'a>(role: &'a AgentTeamRolePrefs, fallback: &'a str) -> &'a str {
    if role.name.trim().is_empty() {
        fallback
    } else {
        role.name.as_str()
    }
}

fn role_tools(role: &AgentTeamRolePrefs) -> Vec<String> {
    role.tool_access.clone().unwrap_or_default()
}

fn workflow_requires_write(workflow: &WorkflowDefinition) -> bool {
    workflow
        .constraints
        .writable_scopes
        .iter()
        .any(|scope| scope != "readonly")
}

fn build_role_prompt(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    input: &AgentExecuteRequest,
    team: &AgentTeamConfig,
    role: &AgentTeamRolePrefs,
    previous_outputs: &[String],
) -> String {
    let role_id = role_id(role);
    let mut skills = swarm_tool_skills::enabled_skill_ids(db_path, runtime_root);
    if !skills.is_empty() {
        for skill in role.skill_ids.clone().unwrap_or_default() {
            if let Some(normalized) = swarm_tool_skills::normalize_skill_id(&skill) {
                if !skills.iter().any(|item| item == &normalized) {
                    skills.push(normalized);
                }
            }
        }
    }
    let mcp = role.mcp_server_ids.clone().unwrap_or_default();
    [
        format!("[team]\nid={}\nname={}", team.id, team.name),
        format!(
            "[role]\nid={role_id}\nname={}\nphase={}\ncan_write={}",
            role_name(role, role_id),
            role.phase.as_deref().unwrap_or("research"),
            role.can_write.unwrap_or(false)
        ),
        format!("tools={}", role_tools(role).join(",")),
        format!("mcp_servers={}", mcp.join(",")),
        format!("skills={}", skills.join(",")),
        "[identity]".to_string(),
        role.identity_prompt
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("You are a focused member of an IDE agent team. Stay concise and cite concrete evidence.")
            .to_string(),
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

fn step_metadata<'a>(
    workflow_id: &'a str,
    step_id: &'a str,
    input: &'a AgentExecuteRequest,
    phase: &'a str,
    node_id: &'a str,
) -> EventMetadata<'a> {
    EventMetadata {
        phase: Some(phase),
        node_id: Some(node_id),
        artifact_refs: Some(input.context_refs.as_slice()),
        harness_profile_id: input.harness_profile_id.as_deref(),
        ..EventMetadata::base(workflow_id, step_id, &input.callsite)
    }
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
        return Ok(String::new());
    }

    let plan_content = format!(
        "team={} parallelism={} harness={} discussion=roles_then_synthesizer roles={}",
        team.name,
        team.parallelism.unwrap_or(1).clamp(1, 4),
        input.harness_profile_id.as_deref().unwrap_or("auto"),
        active_roles
            .iter()
            .map(|role| format!(
                "{}:{}",
                role.id,
                role.phase.as_deref().unwrap_or("research")
            ))
            .collect::<Vec<_>>()
            .join(", ")
    );
    emit_stage_event(
        db_path,
        run_id,
        &input.project_id,
        &workflow.id,
        "team",
        "team.plan",
        "success",
        "Agent Team Plan",
        &plan_content,
        EventMetadata {
            team_id: Some(team.id.as_str()),
            team_task_id: Some("team.plan"),
            ..step_metadata(&workflow.id, "team.plan", input, "plan", "team:plan")
        },
    )?;

    let mut role_outputs = Vec::<String>::new();
    let mut final_output = String::new();
    for role in active_roles {
        ensure_not_cancelled(cancel_flag)?;
        if Instant::now() >= deadline {
            return Err("agent.run.timeout.total".to_string());
        }
        let role_id = role_id(&role).to_string();
        let role_name = role_name(&role, &role_id).to_string();
        let role_node_id = format!("team:{role_id}");
        let connection = resolve_model_connection(
            db_path,
            runtime_root,
            &input.callsite,
            workflow,
            input.model_override.as_deref().or(role.model_id.as_deref()),
        )?;
        let mut prompt =
            build_role_prompt(db_path, runtime_root, input, &team, &role, &role_outputs);
        if role_tools(&role).iter().any(|tool| tool == "web") {
            let search_step_id = format!("team.{role_id}.web");
            let search_node_id = format!("{role_node_id}:tool:web");
            let search_output = swarm_tool_search::run_stage_tool_search(
                db_path,
                runtime_root,
                run_id,
                &input.project_id,
                &workflow.id,
                &search_step_id,
                &role_id,
                "Team Web Search",
                &prompt,
                &input.context_refs,
                cancel_flag,
                &connection.protocol_id,
                &connection.base_url,
                &connection.api_key,
                &connection.model_name,
                input.bypass_cache,
                EventMetadata {
                    parent_node_id: Some(role_node_id.as_str()),
                    team_id: Some(team.id.as_str()),
                    team_role_id: Some(role_id.as_str()),
                    team_role_name: Some(role_name.as_str()),
                    team_task_id: Some(search_step_id.as_str()),
                    ..step_metadata(
                        &workflow.id,
                        &search_step_id,
                        input,
                        "research",
                        search_node_id.as_str(),
                    )
                },
            )?;
            if !search_output.trim().is_empty() {
                prompt = format!("{prompt}\n\n[web tool output]\n{search_output}");
            }
        }
        if role_tools(&role).iter().any(|tool| tool == "mcp") {
            let server = role
                .mcp_server_ids
                .as_ref()
                .and_then(|items| items.first())
                .cloned()
                .unwrap_or_else(|| "stitch".to_string());
            let mcp_step_id = format!("team.{role_id}.mcp");
            let mcp_source = format!("{server}:tools/list");
            let mcp_node_id = format!("{role_node_id}:tool:mcp");
            let mcp_output = swarm_tool_mcp::run_stage_mcp_call(
                db_path,
                runtime_root,
                run_id,
                &input.project_id,
                &workflow.id,
                &mcp_step_id,
                &mcp_source,
                "Team MCP Probe",
                cancel_flag,
                EventMetadata {
                    parent_node_id: Some(role_node_id.as_str()),
                    team_id: Some(team.id.as_str()),
                    team_role_id: Some(role_id.as_str()),
                    team_role_name: Some(role_name.as_str()),
                    team_task_id: Some(mcp_step_id.as_str()),
                    ..step_metadata(
                        &workflow.id,
                        &mcp_step_id,
                        input,
                        "research",
                        mcp_node_id.as_str(),
                    )
                },
            );
            match mcp_output {
                Ok(output) if !output.trim().is_empty() => {
                    prompt = format!("{prompt}\n\n[mcp tool output]\n{output}");
                }
                Ok(_) => {}
                Err(error)
                    if error == "mcp.disabled_by_settings"
                        || error.starts_with("mcp.server.not_configured:") =>
                {
                    prompt =
                        format!("{prompt}\n\n[mcp tool output]\n[mcp.skipped]\nreason={error}");
                }
                Err(error) => return Err(error),
            }
        }

        let provider_step_id = format!("team.{role_id}.respond");
        let provider_step = WorkflowStep {
            id: provider_step_id.clone(),
            kind: "provider.generate".to_string(),
            title: role_name.clone(),
            source: role_id.clone(),
        };
        let output = run_provider_step(
            db_path,
            run_id,
            &input.project_id,
            &workflow.id,
            &provider_step,
            &prompt,
            &input.context_refs,
            cancel_flag,
            &connection,
            input.bypass_cache,
            EventMetadata {
                parent_node_id: Some("team:plan"),
                team_id: Some(team.id.as_str()),
                team_role_id: Some(role_id.as_str()),
                team_role_name: Some(role_name.as_str()),
                team_task_id: Some(provider_step_id.as_str()),
                requires_approval: Some(role.can_write.unwrap_or(false)),
                ..step_metadata(
                    &workflow.id,
                    &provider_step_id,
                    input,
                    role.phase.as_deref().unwrap_or("final"),
                    role_node_id.as_str(),
                )
            },
        )?;
        if !output.trim().is_empty() {
            final_output = output.clone();
            role_outputs.push(format!("[{}]\n{}", role_name, output));
        }
    }

    if role_outputs.len() > 1 {
        let connection = resolve_model_connection(
            db_path,
            runtime_root,
            &input.callsite,
            workflow,
            input.model_override.as_deref(),
        )?;
        let combined = role_outputs.join("\n\n---\n\n");
        let prompt = [
            "[team_synthesis]",
            "Combine the team outputs into one concise final answer. Preserve evidence, risks, and validation gaps.",
            "[user_request]",
            input.prompt.as_str(),
            "[role_outputs]",
            combined.as_str(),
        ]
        .join("\n");
        let synth_step = WorkflowStep {
            id: "team.synthesize".to_string(),
            kind: "provider.generate".to_string(),
            title: "Team Synthesizer".to_string(),
            source: "team.synthesizer".to_string(),
        };
        let output = run_provider_step(
            db_path,
            run_id,
            &input.project_id,
            &workflow.id,
            &synth_step,
            &prompt,
            &input.context_refs,
            cancel_flag,
            &connection,
            input.bypass_cache,
            EventMetadata {
                parent_node_id: Some("team:plan"),
                team_id: Some(team.id.as_str()),
                team_role_id: Some("synthesizer"),
                team_role_name: Some("Team Synthesizer"),
                team_task_id: Some("team.synthesize"),
                requires_approval: Some(workflow_requires_write(workflow)),
                ..step_metadata(
                    &workflow.id,
                    "team.synthesize",
                    input,
                    "final",
                    "team:synthesizer",
                )
            },
        )?;
        if !output.trim().is_empty() {
            final_output = output;
        }
    }

    Ok(final_output)
}
