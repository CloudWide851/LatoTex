use crate::models::{AgentApprovalCapability, AgentExecuteRequest, AgentProfile, AppSettings};
use crate::storage;
use std::collections::BTreeSet;
use std::path::Path;

use super::swarm_workflows::WorkflowDefinition;

#[derive(Debug)]
pub(super) enum PermissionPreflight {
    Allowed,
    Pending(Vec<AgentApprovalCapability>),
}

fn normalized_mode(value: Option<&str>, fallback: &str) -> String {
    match value.map(str::trim) {
        Some("allow") => "allow".to_string(),
        Some("ask") => "ask".to_string(),
        Some("deny") => "deny".to_string(),
        _ => fallback.to_string(),
    }
}

fn permission_mode(settings: &AppSettings, capability: &str, resource: &str) -> String {
    let prefs = settings
        .ui_prefs
        .as_ref()
        .and_then(|prefs| prefs.agent_permission_prefs.as_ref());
    match capability {
        "webSearch" => {
            normalized_mode(prefs.and_then(|prefs| prefs.web_search.as_deref()), "allow")
        }
        "workspaceRead" => normalized_mode(
            prefs.and_then(|prefs| prefs.workspace_read.as_deref()),
            "allow",
        ),
        "python" => normalized_mode(prefs.and_then(|prefs| prefs.python.as_deref()), "ask"),
        "mcp" => {
            let specific = prefs
                .and_then(|prefs| prefs.mcp_server_modes.as_ref())
                .and_then(|modes| modes.get(resource))
                .map(String::as_str);
            normalized_mode(
                specific.or_else(|| prefs.and_then(|prefs| prefs.mcp.as_deref())),
                "ask",
            )
        }
        "skills" => normalized_mode(prefs.and_then(|prefs| prefs.skills.as_deref()), "allow"),
        "pluginCommands" => normalized_mode(
            prefs.and_then(|prefs| prefs.plugin_commands.as_deref()),
            "ask",
        ),
        "nonLatexWrites" => normalized_mode(
            prefs.and_then(|prefs| prefs.non_latex_writes.as_deref()),
            "ask",
        ),
        _ => "deny".to_string(),
    }
}

fn resource_from_source(source: &str, fallback: &str) -> String {
    source
        .split(':')
        .next()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(fallback)
        .to_string()
}

fn insert_requirement(
    requirements: &mut BTreeSet<(String, String)>,
    capability: &str,
    resource: impl Into<String>,
) {
    requirements.insert((capability.to_string(), resource.into()));
}

fn collect_workflow_requirements(
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    requirements: &mut BTreeSet<(String, String)>,
) {
    for step in &workflow.steps {
        match step.kind.as_str() {
            "tool.search" => insert_requirement(requirements, "webSearch", "web"),
            "tool.workspace" => insert_requirement(requirements, "workspaceRead", "workspace"),
            "tool.python" => insert_requirement(requirements, "python", "managed"),
            "mcp.call" => insert_requirement(
                requirements,
                "mcp",
                resource_from_source(&step.source, "stitch"),
            ),
            kind if kind.starts_with("plugin.") => insert_requirement(
                requirements,
                "pluginCommands",
                resource_from_source(&step.source, "plugin"),
            ),
            _ => {}
        }
    }
    let mut write_resources = input
        .context_refs
        .iter()
        .filter_map(|reference| reference.strip_prefix("file:"))
        .filter(|path| !super::swarm_workflows::is_latex_related_path(path))
        .map(str::to_string)
        .collect::<Vec<_>>();
    write_resources.sort();
    write_resources.dedup();
    if workflow
        .constraints
        .writable_scopes
        .iter()
        .any(|scope| scope != "readonly")
    {
        for resource in write_resources {
            insert_requirement(requirements, "nonLatexWrites", resource);
        }
    }
}

fn collect_profile_requirements(
    profile: &AgentProfile,
    requirements: &mut BTreeSet<(String, String)>,
) {
    for tool in &profile.tool_ids {
        match tool.as_str() {
            "web" => insert_requirement(requirements, "webSearch", "web"),
            "workspace" => insert_requirement(requirements, "workspaceRead", "workspace"),
            "python" => insert_requirement(requirements, "python", "managed"),
            "mcp" => {
                for server in &profile.mcp_server_ids {
                    insert_requirement(requirements, "mcp", server.clone());
                }
            }
            _ => {}
        }
    }
    for skill in &profile.skill_ids {
        insert_requirement(requirements, "skills", skill.clone());
    }
}

fn legacy_tool_disabled(settings: &AppSettings, capability: &str) -> bool {
    let prefs = settings
        .ui_prefs
        .as_ref()
        .and_then(|prefs| prefs.agent_tool_prefs.as_ref());
    match capability {
        "webSearch" => prefs.and_then(|prefs| prefs.web_search_enabled) == Some(false),
        "workspaceRead" => prefs.and_then(|prefs| prefs.workspace_read_enabled) == Some(false),
        "python" => prefs.and_then(|prefs| prefs.python_enabled) == Some(false),
        "mcp" => prefs.and_then(|prefs| prefs.mcp_enabled) == Some(false),
        _ => false,
    }
}

pub(super) fn preflight_permissions(
    db_path: &Path,
    runtime_root: &Path,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
    selection: &storage::AgentExecutionSelection,
) -> Result<PermissionPreflight, String> {
    let settings = storage::load_settings(db_path, runtime_root)?;
    let mut requirements = BTreeSet::<(String, String)>::new();
    collect_workflow_requirements(input, workflow, &mut requirements);
    collect_profile_requirements(&selection.profile, &mut requirements);
    if let Some(graph) = &selection.graph_template {
        for node in &graph.nodes {
            let profile = node
                .profile_id
                .as_deref()
                .and_then(|id| storage::get_agent_profile(db_path, id).ok().flatten())
                .unwrap_or_else(|| selection.profile.clone());
            collect_profile_requirements(&profile, &mut requirements);
        }
    }
    let mut pending = Vec::new();
    for (capability, resource) in requirements {
        if legacy_tool_disabled(&settings, &capability) {
            return Err(format!("agent.permission.denied:{capability}:{resource}"));
        }
        match permission_mode(&settings, &capability, &resource).as_str() {
            "allow" => {}
            "deny" => return Err(format!("agent.permission.denied:{capability}:{resource}")),
            _ => {
                if !storage::has_agent_permission_grant(
                    db_path,
                    &input.project_id,
                    &capability,
                    &resource,
                )? {
                    pending.push(AgentApprovalCapability {
                        capability,
                        resource,
                    });
                }
            }
        }
    }
    if pending.is_empty() {
        Ok(PermissionPreflight::Allowed)
    } else {
        Ok(PermissionPreflight::Pending(pending))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalized_mode_fails_closed_for_unknown_values() {
        assert_eq!(normalized_mode(Some("deny"), "allow"), "deny");
        assert_eq!(normalized_mode(Some("unexpected"), "ask"), "ask");
    }
}
