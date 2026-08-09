fn agent_callsite_specs() -> [(&'static str, &'static str, Option<&'static str>); 4] {
    [
        (
            "latex.overlay",
            "builtin-writer",
            Some("builtin-research-workflow"),
        ),
        (
            "analysis.workspace",
            "builtin-analyst",
            Some("builtin-research-workflow"),
        ),
        (
            "chat.workspace",
            "builtin-researcher",
            Some("builtin-research-workflow"),
        ),
        ("research.workbench", "builtin-planner", None),
    ]
}

fn built_in_agent_profiles(now: &str) -> Vec<crate::models::AgentProfile> {
    let create = |id: &str,
                  name: &str,
                  description: &str,
                  color: &str,
                  identity_prompt: &str,
                  skill_ids: &[&str],
                  tool_ids: &[&str],
                  write_scopes: &[&str]| {
        crate::models::AgentProfile {
            id: id.to_string(),
            name: name.to_string(),
            description: description.to_string(),
            color: color.to_string(),
            model_id: None,
            runtime_id: "native".to_string(),
            fallback_runtime_id: "native".to_string(),
            identity_prompt: identity_prompt.to_string(),
            skill_ids: skill_ids.iter().map(|value| (*value).to_string()).collect(),
            mcp_server_ids: Vec::new(),
            tool_ids: tool_ids.iter().map(|value| (*value).to_string()).collect(),
            read_scopes: vec![".".to_string()],
            write_scopes: write_scopes
                .iter()
                .map(|value| (*value).to_string())
                .collect(),
            tool_call_budget: 16,
            token_budget: 48_000,
            timeout_ms: 180_000,
            built_in: true,
            created_at: now.to_string(),
            updated_at: now.to_string(),
        }
    };
    vec![
        create(
            "builtin-planner",
            "Research Planner",
            "Turns a research request into explicit questions, constraints, and checkpoints.",
            "#2563EB",
            "Plan the work, name assumptions, and identify missing evidence before execution.",
            &["research-reproducibility"],
            &["workspace"],
            &["readonly"],
        ),
        create(
            "builtin-researcher",
            "Literature Researcher",
            "Finds and evaluates academic evidence without inventing unsupported conclusions.",
            "#0F766E",
            "Gather traceable evidence. Separate facts, metadata support, inference, and uncertainty.",
            &["literature-search", "systematic-review"],
            &["workspace", "web"],
            &["readonly"],
        ),
        create(
            "builtin-analyst",
            "Statistical Analyst",
            "Inspects datasets and produces reproducible statistical analysis.",
            "#7C3AED",
            "Use validated data and deterministic methods. Report exclusions, effects, intervals, and limits.",
            &["statistical-analysis", "research-reproducibility"],
            &["workspace", "python"],
            &["readonly"],
        ),
        create(
            "builtin-writer",
            "Scientific Writer",
            "Converts evidence into concise scientific prose and LaTeX-safe proposals.",
            "#16A34A",
            "Synthesize only supported claims and keep edits scoped to the requested scientific artifact.",
            &["systematic-review", "research-reproducibility"],
            &["workspace"],
            &["*.tex", "*.bib"],
        ),
        create(
            "builtin-reviewer",
            "Method Reviewer",
            "Challenges weak evidence, statistical errors, and reproducibility gaps.",
            "#D97706",
            "Review the direct dependency outputs. Request one targeted repair only when a concrete defect remains.",
            &["systematic-review", "statistical-analysis"],
            &["workspace"],
            &["readonly"],
        ),
        create(
            "builtin-synthesizer",
            "Research Synthesizer",
            "Produces the final answer from reviewed evidence and analysis.",
            "#DB2777",
            "Produce a compact final result with evidence boundaries, limitations, and next actions.",
            &["research-reproducibility"],
            &["workspace"],
            &["readonly"],
        ),
    ]
}

pub(crate) fn built_in_research_graph(now: &str) -> crate::models::AgentGraphTemplate {
    let node = |id: &str, role: &str, title: &str, profile: &str, instruction: &str| {
        crate::models::AgentGraphNode {
            id: id.to_string(),
            role: role.to_string(),
            title: title.to_string(),
            profile_id: Some(profile.to_string()),
            instruction: instruction.to_string(),
            optional: false,
        }
    };
    crate::models::AgentGraphTemplate {
        id: "builtin-research-workflow".to_string(),
        name: "Research evidence workflow".to_string(),
        description: "Plans, gathers evidence, analyzes, writes, reviews, and synthesizes with bounded parallelism."
            .to_string(),
        nodes: vec![
            node(
                "plan",
                "planner",
                "Plan",
                "builtin-planner",
                "Define the research question, evidence needs, and validation gates.",
            ),
            node(
                "research",
                "researcher",
                "Evidence",
                "builtin-researcher",
                "Collect academic and workspace evidence required by the plan.",
            ),
            node(
                "analysis",
                "analyst",
                "Analysis",
                "builtin-analyst",
                "Analyze available data and evidence; state when inferential analysis is not justified.",
            ),
            node(
                "write",
                "writer",
                "Draft",
                "builtin-writer",
                "Prepare a supported draft from the evidence and analysis.",
            ),
            node(
                "review",
                "reviewer",
                "Review",
                "builtin-reviewer",
                "Audit claims and methods. Use REPAIR_REQUIRED:<node-id> only for one concrete repair.",
            ),
            node(
                "synthesize",
                "synthesizer",
                "Conclusion",
                "builtin-synthesizer",
                "Produce the reviewed final answer with limitations and unresolved uncertainty.",
            ),
        ],
        edges: vec![
            ("plan", "research"),
            ("plan", "analysis"),
            ("research", "write"),
            ("analysis", "write"),
            ("write", "review"),
            ("review", "synthesize"),
        ]
        .into_iter()
        .map(|(from, to)| crate::models::AgentGraphEdge {
            from: from.to_string(),
            to: to.to_string(),
        })
        .collect(),
        max_parallelism: 2,
        built_in: true,
        created_at: now.to_string(),
        updated_at: now.to_string(),
    }
}

fn insert_agent_profile_with_conn(
    conn: &Connection,
    profile: &crate::models::AgentProfile,
    replace_custom: bool,
) -> Result<(), String> {
    let update = if replace_custom {
        "ON CONFLICT(profile_id) DO UPDATE SET
           name=excluded.name, description=excluded.description, color=excluded.color,
           model_id=excluded.model_id, runtime_id=excluded.runtime_id,
           fallback_runtime_id=excluded.fallback_runtime_id, identity_prompt=excluded.identity_prompt,
           skill_ids_json=excluded.skill_ids_json, mcp_server_ids_json=excluded.mcp_server_ids_json,
           tool_ids_json=excluded.tool_ids_json, read_scopes_json=excluded.read_scopes_json,
           write_scopes_json=excluded.write_scopes_json, tool_call_budget=excluded.tool_call_budget,
           token_budget=excluded.token_budget, timeout_ms=excluded.timeout_ms,
           updated_at=excluded.updated_at
         WHERE agent_profiles.built_in = 0"
    } else {
        "ON CONFLICT(profile_id) DO NOTHING"
    };
    conn.execute(
        &format!(
            "INSERT INTO agent_profiles (
               profile_id, name, description, color, model_id, runtime_id, fallback_runtime_id, identity_prompt,
               skill_ids_json, mcp_server_ids_json, tool_ids_json, read_scopes_json,
               write_scopes_json, tool_call_budget, token_budget, timeout_ms,
               built_in, created_at, updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13,?14,?15,?16,?17,?18,?19)
             {update}"
        ),
        params![
            profile.id,
            profile.name,
            profile.description,
            profile.color,
            profile.model_id,
            profile.runtime_id,
            profile.fallback_runtime_id,
            profile.identity_prompt,
            serde_json::to_string(&profile.skill_ids).map_err(|e| e.to_string())?,
            serde_json::to_string(&profile.mcp_server_ids).map_err(|e| e.to_string())?,
            serde_json::to_string(&profile.tool_ids).map_err(|e| e.to_string())?,
            serde_json::to_string(&profile.read_scopes).map_err(|e| e.to_string())?,
            serde_json::to_string(&profile.write_scopes).map_err(|e| e.to_string())?,
            profile.tool_call_budget,
            profile.token_budget,
            profile.timeout_ms,
            profile.built_in,
            profile.created_at,
            profile.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn insert_agent_graph_with_conn(
    conn: &Connection,
    graph: &crate::models::AgentGraphTemplate,
    replace_custom: bool,
) -> Result<(), String> {
    let update = if replace_custom {
        "ON CONFLICT(graph_template_id) DO UPDATE SET
           name=excluded.name, description=excluded.description, nodes_json=excluded.nodes_json,
           edges_json=excluded.edges_json, max_parallelism=excluded.max_parallelism,
           updated_at=excluded.updated_at
         WHERE agent_graph_templates.built_in = 0"
    } else {
        "ON CONFLICT(graph_template_id) DO NOTHING"
    };
    conn.execute(
        &format!(
            "INSERT INTO agent_graph_templates (
               graph_template_id, name, description, nodes_json, edges_json,
               max_parallelism, built_in, created_at, updated_at
             ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9) {update}"
        ),
        params![
            graph.id,
            graph.name,
            graph.description,
            serde_json::to_string(&graph.nodes).map_err(|e| e.to_string())?,
            serde_json::to_string(&graph.edges).map_err(|e| e.to_string())?,
            graph.max_parallelism,
            graph.built_in,
            graph.created_at,
            graph.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn seed_agent_control_registry(conn: &Connection) -> Result<(), String> {
    let now = now_iso();
    for profile in built_in_agent_profiles(&now) {
        validate_agent_profile(&profile)?;
        insert_agent_profile_with_conn(conn, &profile, false)?;
    }
    let graph = built_in_research_graph(&now);
    validate_agent_graph_template(&graph)?;
    insert_agent_graph_with_conn(conn, &graph, false)
}

fn legacy_agent_id(value: &str, fallback: &str) -> String {
    let normalized = value
        .trim()
        .to_ascii_lowercase()
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    let normalized = normalized.trim_matches('-');
    if normalized.is_empty() {
        fallback.to_string()
    } else {
        normalized.chars().take(36).collect()
    }
}

fn migrate_legacy_agent_teams(conn: &Connection) -> Result<(), String> {
    let migrated = conn
        .query_row(
            "SELECT meta_value FROM agent_control_meta WHERE meta_key='legacy-team-migration'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .is_some();
    if migrated {
        return Ok(());
    }
    let raw = conn
        .query_row(
            "SELECT ui_prefs_json FROM app_settings WHERE id=1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .flatten()
        .unwrap_or_default();
    let root = serde_json::from_str::<serde_json::Value>(&raw).unwrap_or_default();
    let teams = root
        .get("agentTeamPrefs")
        .and_then(|value| value.get("teams"))
        .and_then(serde_json::Value::as_array)
        .cloned()
        .unwrap_or_default();
    let now = now_iso();
    for (team_index, team) in teams.iter().enumerate() {
        let team_id = legacy_agent_id(
            team.get("id")
                .and_then(serde_json::Value::as_str)
                .unwrap_or(""),
            &format!("team-{}", team_index + 1),
        );
        let roles = team
            .get("roles")
            .and_then(serde_json::Value::as_array)
            .cloned()
            .unwrap_or_default();
        let mut nodes = Vec::new();
        let mut edges = Vec::new();
        for (role_index, role) in roles.iter().take(AGENT_GRAPH_NODE_MAX).enumerate() {
            let role_id = legacy_agent_id(
                role.get("id")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or(""),
                &format!("role-{}", role_index + 1),
            );
            let profile_id = format!("legacy-{team_id}-{role_id}");
            let role_kind = match role
                .get("phase")
                .and_then(serde_json::Value::as_str)
                .unwrap_or("research")
            {
                "plan" => "planner",
                "review" => "reviewer",
                "final" => "synthesizer",
                "edit" => "writer",
                _ => "researcher",
            };
            let profile = crate::models::AgentProfile {
                id: profile_id.clone(),
                name: role
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Migrated Agent")
                    .to_string(),
                description: role
                    .get("description")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                color: role
                    .get("color")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("#64748B")
                    .to_ascii_uppercase(),
                model_id: role
                    .get("modelId")
                    .and_then(serde_json::Value::as_str)
                    .filter(|value| !value.is_empty())
                    .map(str::to_string),
                runtime_id: "native".to_string(),
                fallback_runtime_id: "native".to_string(),
                identity_prompt: role
                    .get("identityPrompt")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("")
                    .to_string(),
                skill_ids: role
                    .get("skillIds")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .filter(|value| *value != "stitch")
                    .map(str::to_string)
                    .collect(),
                mcp_server_ids: role
                    .get("mcpServerIds")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .filter(|value| *value != "stitch")
                    .map(str::to_string)
                    .collect(),
                tool_ids: role
                    .get("toolAccess")
                    .and_then(serde_json::Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(serde_json::Value::as_str)
                    .map(str::to_string)
                    .collect(),
                read_scopes: vec![".".to_string()],
                write_scopes: if role
                    .get("canWrite")
                    .and_then(serde_json::Value::as_bool)
                    .unwrap_or(false)
                {
                    vec!["*.tex".to_string(), "*.bib".to_string()]
                } else {
                    vec!["readonly".to_string()]
                },
                tool_call_budget: 16,
                token_budget: 48_000,
                timeout_ms: 180_000,
                built_in: false,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            if validate_agent_profile(&profile).is_ok() {
                insert_agent_profile_with_conn(conn, &profile, false)?;
                nodes.push(crate::models::AgentGraphNode {
                    id: role_id.clone(),
                    role: role_kind.to_string(),
                    title: profile.name.clone(),
                    profile_id: Some(profile_id),
                    instruction: profile.identity_prompt.clone(),
                    optional: false,
                });
                if let Some(previous) = nodes.get(role_index.wrapping_sub(1)) {
                    edges.push(crate::models::AgentGraphEdge {
                        from: previous.id.clone(),
                        to: role_id,
                    });
                }
            }
        }
        if !nodes.is_empty() {
            let graph = crate::models::AgentGraphTemplate {
                id: format!("legacy-{team_id}"),
                name: team
                    .get("name")
                    .and_then(serde_json::Value::as_str)
                    .unwrap_or("Migrated workflow")
                    .to_string(),
                description: "Migrated from the legacy Agent Team settings.".to_string(),
                nodes,
                edges,
                max_parallelism: team
                    .get("parallelism")
                    .and_then(serde_json::Value::as_u64)
                    .unwrap_or(1)
                    .clamp(1, AGENT_GRAPH_PARALLEL_MAX as u64)
                    as u32,
                built_in: false,
                created_at: now.clone(),
                updated_at: now.clone(),
            };
            if validate_agent_graph_template(&graph).is_ok() {
                insert_agent_graph_with_conn(conn, &graph, false)?;
            }
        }
    }
    conn.execute(
        "INSERT INTO agent_control_meta(meta_key,meta_value,updated_at)
         VALUES('legacy-team-migration','1',?1)
         ON CONFLICT(meta_key) DO UPDATE SET meta_value='1',updated_at=excluded.updated_at",
        params![now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}
