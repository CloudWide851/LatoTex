const AGENT_PROFILE_ID_MAX: usize = 64;
const AGENT_PROFILE_TEXT_MAX: usize = 4_096;
const AGENT_GRAPH_NODE_MAX: usize = 8;
const AGENT_GRAPH_PARALLEL_MAX: u32 = 3;

fn valid_agent_control_id(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= AGENT_PROFILE_ID_MAX
        && value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
}

fn valid_agent_scope(value: &str) -> bool {
    let value = value.trim();
    !value.is_empty()
        && value.len() <= 256
        && !value.contains('\0')
        && !value.contains(':')
        && !value.starts_with(['/', '\\'])
        && !value
            .split(['/', '\\'])
            .any(|segment| segment == ".." || segment.is_empty())
}

fn validate_agent_profile(profile: &crate::models::AgentProfile) -> Result<(), String> {
    if !valid_agent_control_id(&profile.id) {
        return Err("agent.profile.invalid_id".to_string());
    }
    if profile.name.trim().is_empty() || profile.name.chars().count() > 120 {
        return Err("agent.profile.invalid_name".to_string());
    }
    if profile.description.chars().count() > 1_000
        || profile.identity_prompt.chars().count() > AGENT_PROFILE_TEXT_MAX
    {
        return Err("agent.profile.text_too_large".to_string());
    }
    if !profile.color.starts_with('#')
        || profile.color.len() != 7
        || !profile.color[1..].chars().all(|ch| ch.is_ascii_hexdigit())
    {
        return Err("agent.profile.invalid_color".to_string());
    }
    if profile.tool_call_budget == 0 || profile.tool_call_budget > 64 {
        return Err("agent.profile.invalid_tool_budget".to_string());
    }
    if !matches!(
        profile.runtime_id.as_str(),
        "native" | "codex-cli" | "claude-code-cli"
    ) || !matches!(
        profile.fallback_runtime_id.as_str(),
        "native" | "codex-cli" | "claude-code-cli"
    ) || (profile.runtime_id != "native" && profile.runtime_id == profile.fallback_runtime_id)
    {
        return Err("agent.profile.invalid_runtime".to_string());
    }
    if profile.token_budget < 1_024 || profile.token_budget > 200_000 {
        return Err("agent.profile.invalid_token_budget".to_string());
    }
    if profile.timeout_ms < 5_000 || profile.timeout_ms > 600_000 {
        return Err("agent.profile.invalid_timeout".to_string());
    }
    if profile.skill_ids.len() > 16
        || profile.mcp_server_ids.len() > 16
        || profile.tool_ids.len() > 8
        || profile.read_scopes.len() > 16
        || profile.write_scopes.len() > 16
    {
        return Err("agent.profile.too_many_capabilities".to_string());
    }
    if profile
        .tool_ids
        .iter()
        .any(|tool| !matches!(tool.as_str(), "workspace" | "web" | "python" | "mcp"))
    {
        return Err("agent.profile.invalid_tool".to_string());
    }
    if profile
        .read_scopes
        .iter()
        .chain(profile.write_scopes.iter())
        .any(|scope| !valid_agent_scope(scope))
    {
        return Err("agent.profile.invalid_scope".to_string());
    }
    if profile
        .write_scopes
        .iter()
        .any(|scope| !scope.ends_with(".tex") && !scope.ends_with(".bib") && scope != "readonly")
    {
        return Err("agent.profile.write_scope_not_allowed".to_string());
    }
    Ok(())
}

pub(crate) fn validate_agent_graph_template(
    graph: &crate::models::AgentGraphTemplate,
) -> Result<(), String> {
    if !valid_agent_control_id(&graph.id) {
        return Err("agent.graph.invalid_id".to_string());
    }
    if graph.name.trim().is_empty() || graph.name.chars().count() > 120 {
        return Err("agent.graph.invalid_name".to_string());
    }
    if graph.nodes.is_empty() || graph.nodes.len() > AGENT_GRAPH_NODE_MAX {
        return Err("agent.graph.invalid_node_count".to_string());
    }
    if !(1..=AGENT_GRAPH_PARALLEL_MAX).contains(&graph.max_parallelism) {
        return Err("agent.graph.invalid_parallelism".to_string());
    }
    let mut ids = std::collections::HashSet::new();
    let allowed_roles = [
        "planner",
        "researcher",
        "analyst",
        "writer",
        "reviewer",
        "synthesizer",
    ];
    for node in &graph.nodes {
        if !valid_agent_control_id(&node.id) || !ids.insert(node.id.as_str()) {
            return Err("agent.graph.invalid_node_id".to_string());
        }
        if !allowed_roles.contains(&node.role.as_str()) {
            return Err("agent.graph.invalid_role".to_string());
        }
        if node.title.trim().is_empty()
            || node.title.chars().count() > 120
            || node.instruction.chars().count() > AGENT_PROFILE_TEXT_MAX
        {
            return Err("agent.graph.invalid_node_text".to_string());
        }
        if node
            .profile_id
            .as_deref()
            .is_some_and(|id| !valid_agent_control_id(id))
        {
            return Err("agent.graph.invalid_profile".to_string());
        }
    }
    let mut incoming = graph
        .nodes
        .iter()
        .map(|node| (node.id.as_str(), 0usize))
        .collect::<std::collections::HashMap<_, _>>();
    let mut outgoing = std::collections::HashMap::<&str, Vec<&str>>::new();
    let mut edges = std::collections::HashSet::new();
    for edge in &graph.edges {
        if edge.from == edge.to
            || !ids.contains(edge.from.as_str())
            || !ids.contains(edge.to.as_str())
            || !edges.insert((edge.from.as_str(), edge.to.as_str()))
        {
            return Err("agent.graph.invalid_edge".to_string());
        }
        *incoming
            .get_mut(edge.to.as_str())
            .ok_or_else(|| "agent.graph.invalid_edge".to_string())? += 1;
        outgoing
            .entry(edge.from.as_str())
            .or_default()
            .push(edge.to.as_str());
    }
    let mut ready = incoming
        .iter()
        .filter_map(|(id, count)| (*count == 0).then_some(*id))
        .collect::<Vec<_>>();
    let mut visited = 0usize;
    while let Some(id) = ready.pop() {
        visited += 1;
        for child in outgoing.get(id).into_iter().flatten() {
            if let Some(count) = incoming.get_mut(child) {
                *count -= 1;
                if *count == 0 {
                    ready.push(child);
                }
            }
        }
    }
    if visited != graph.nodes.len() {
        return Err("agent.graph.cycle".to_string());
    }
    Ok(())
}
