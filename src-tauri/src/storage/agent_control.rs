#[derive(Debug)]
struct RawAgentProfile {
    id: String,
    name: String,
    description: String,
    color: String,
    model_id: Option<String>,
    identity_prompt: String,
    skill_ids_json: String,
    mcp_server_ids_json: String,
    tool_ids_json: String,
    read_scopes_json: String,
    write_scopes_json: String,
    tool_call_budget: u32,
    token_budget: u32,
    timeout_ms: u64,
    built_in: bool,
    created_at: String,
    updated_at: String,
}

impl RawAgentProfile {
    fn into_profile(self) -> Result<crate::models::AgentProfile, String> {
        let parse = |raw: &str| serde_json::from_str::<Vec<String>>(raw).map_err(|e| e.to_string());
        Ok(crate::models::AgentProfile {
            id: self.id,
            name: self.name,
            description: self.description,
            color: self.color,
            model_id: self.model_id,
            identity_prompt: self.identity_prompt,
            skill_ids: parse(&self.skill_ids_json)?,
            mcp_server_ids: parse(&self.mcp_server_ids_json)?,
            tool_ids: parse(&self.tool_ids_json)?,
            read_scopes: parse(&self.read_scopes_json)?,
            write_scopes: parse(&self.write_scopes_json)?,
            tool_call_budget: self.tool_call_budget,
            token_budget: self.token_budget,
            timeout_ms: self.timeout_ms,
            built_in: self.built_in,
            created_at: self.created_at,
            updated_at: self.updated_at,
        })
    }
}

fn raw_agent_profile(row: &rusqlite::Row<'_>) -> rusqlite::Result<RawAgentProfile> {
    Ok(RawAgentProfile {
        id: row.get(0)?,
        name: row.get(1)?,
        description: row.get(2)?,
        color: row.get(3)?,
        model_id: row.get(4)?,
        identity_prompt: row.get(5)?,
        skill_ids_json: row.get(6)?,
        mcp_server_ids_json: row.get(7)?,
        tool_ids_json: row.get(8)?,
        read_scopes_json: row.get(9)?,
        write_scopes_json: row.get(10)?,
        tool_call_budget: row.get(11)?,
        token_budget: row.get(12)?,
        timeout_ms: row.get(13)?,
        built_in: row.get(14)?,
        created_at: row.get(15)?,
        updated_at: row.get(16)?,
    })
}

pub fn list_agent_profiles(db_path: &Path) -> Result<Vec<crate::models::AgentProfile>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT profile_id,name,description,color,model_id,identity_prompt,
                    skill_ids_json,mcp_server_ids_json,tool_ids_json,read_scopes_json,
                    write_scopes_json,tool_call_budget,token_budget,timeout_ms,built_in,
                    created_at,updated_at
             FROM agent_profiles ORDER BY built_in DESC,name COLLATE NOCASE,profile_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], raw_agent_profile)
        .map_err(|e| e.to_string())?;
    rows.map(|row| row.map_err(|e| e.to_string())?.into_profile())
        .collect()
}

pub fn get_agent_profile(
    db_path: &Path,
    profile_id: &str,
) -> Result<Option<crate::models::AgentProfile>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let raw = conn
        .query_row(
            "SELECT profile_id,name,description,color,model_id,identity_prompt,
                    skill_ids_json,mcp_server_ids_json,tool_ids_json,read_scopes_json,
                    write_scopes_json,tool_call_budget,token_budget,timeout_ms,built_in,
                    created_at,updated_at
             FROM agent_profiles WHERE profile_id=?1",
            params![profile_id],
            raw_agent_profile,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(RawAgentProfile::into_profile).transpose()
}

fn raw_agent_graph(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<(
    String,
    String,
    String,
    String,
    String,
    u32,
    bool,
    String,
    String,
)> {
    Ok((
        row.get(0)?,
        row.get(1)?,
        row.get(2)?,
        row.get(3)?,
        row.get(4)?,
        row.get(5)?,
        row.get(6)?,
        row.get(7)?,
        row.get(8)?,
    ))
}

fn project_agent_graph(
    raw: (
        String,
        String,
        String,
        String,
        String,
        u32,
        bool,
        String,
        String,
    ),
) -> Result<crate::models::AgentGraphTemplate, String> {
    Ok(crate::models::AgentGraphTemplate {
        id: raw.0,
        name: raw.1,
        description: raw.2,
        nodes: serde_json::from_str(&raw.3).map_err(|e| e.to_string())?,
        edges: serde_json::from_str(&raw.4).map_err(|e| e.to_string())?,
        max_parallelism: raw.5,
        built_in: raw.6,
        created_at: raw.7,
        updated_at: raw.8,
    })
}

pub fn list_agent_graph_templates(
    db_path: &Path,
) -> Result<Vec<crate::models::AgentGraphTemplate>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT graph_template_id,name,description,nodes_json,edges_json,max_parallelism,
                    built_in,created_at,updated_at
             FROM agent_graph_templates ORDER BY built_in DESC,name COLLATE NOCASE,graph_template_id",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], raw_agent_graph)
        .map_err(|e| e.to_string())?;
    rows.map(|row| project_agent_graph(row.map_err(|e| e.to_string())?))
        .collect()
}

pub fn get_agent_graph_template(
    db_path: &Path,
    graph_template_id: &str,
) -> Result<Option<crate::models::AgentGraphTemplate>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let raw = conn
        .query_row(
            "SELECT graph_template_id,name,description,nodes_json,edges_json,max_parallelism,
                    built_in,created_at,updated_at
             FROM agent_graph_templates WHERE graph_template_id=?1",
            params![graph_template_id],
            raw_agent_graph,
        )
        .optional()
        .map_err(|e| e.to_string())?;
    raw.map(project_agent_graph).transpose()
}

fn row_agent_binding(row: &rusqlite::Row<'_>) -> rusqlite::Result<crate::models::AgentBinding> {
    let scope = row.get::<_, String>(0)?;
    Ok(crate::models::AgentBinding {
        project_id: (!scope.is_empty()).then_some(scope),
        callsite: row.get(1)?,
        profile_id: row.get(2)?,
        graph_template_id: row.get(3)?,
        updated_at: row.get(4)?,
    })
}

pub fn list_agent_bindings(
    db_path: &Path,
    project_id: Option<&str>,
) -> Result<Vec<crate::models::AgentBinding>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let project_scope = project_id.map(str::trim).unwrap_or_default();
    let mut stmt = conn
        .prepare(
            "SELECT project_scope,callsite,profile_id,graph_template_id,updated_at
             FROM agent_profile_bindings
             WHERE project_scope='' OR project_scope=?1
             ORDER BY project_scope,callsite",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![project_scope], row_agent_binding)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn list_all_agent_bindings(db_path: &Path) -> Result<Vec<crate::models::AgentBinding>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT project_scope,callsite,profile_id,graph_template_id,updated_at
             FROM agent_profile_bindings
             ORDER BY project_scope,callsite",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], row_agent_binding)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

fn default_agent_binding(callsite: &str) -> Option<crate::models::AgentBinding> {
    agent_callsite_specs()
        .into_iter()
        .find(|(id, _, _)| *id == callsite)
        .map(|(id, profile, graph)| crate::models::AgentBinding {
            project_id: None,
            callsite: id.to_string(),
            profile_id: profile.to_string(),
            graph_template_id: graph.map(str::to_string),
            updated_at: String::new(),
        })
}

pub(crate) fn resolve_agent_binding(
    db_path: &Path,
    project_id: &str,
    callsite: &str,
) -> Result<(crate::models::AgentBinding, String), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    for (scope, source) in [(project_id.trim(), "project"), ("", "global")] {
        let binding = conn
            .query_row(
                "SELECT project_scope,callsite,profile_id,graph_template_id,updated_at
                 FROM agent_profile_bindings WHERE project_scope=?1 AND callsite=?2",
                params![scope, callsite],
                row_agent_binding,
            )
            .optional()
            .map_err(|e| e.to_string())?;
        if let Some(binding) = binding {
            return Ok((binding, source.to_string()));
        }
    }
    default_agent_binding(callsite)
        .map(|binding| (binding, "built_in".to_string()))
        .ok_or_else(|| "agent.binding.unsupported_callsite".to_string())
}

pub(crate) struct AgentExecutionSelection {
    pub profile: crate::models::AgentProfile,
    pub graph_template: Option<crate::models::AgentGraphTemplate>,
}

pub(crate) fn resolve_agent_execution_selection(
    db_path: &Path,
    input: &crate::models::AgentExecuteRequest,
) -> Result<AgentExecutionSelection, String> {
    let (binding, _) = resolve_agent_binding(db_path, &input.project_id, &input.callsite)?;
    let profile_id = input.profile_id.as_deref().unwrap_or(&binding.profile_id);
    let profile = get_agent_profile(db_path, profile_id)?
        .or_else(|| {
            default_agent_binding(&input.callsite).and_then(|fallback| {
                get_agent_profile(db_path, &fallback.profile_id)
                    .ok()
                    .flatten()
            })
        })
        .ok_or_else(|| "agent.profile.not_found".to_string())?;
    let graph_id = input
        .graph_template_id
        .as_deref()
        .or(binding.graph_template_id.as_deref());
    let graph_template = graph_id
        .map(|id| {
            get_agent_graph_template(db_path, id)?
                .ok_or_else(|| "agent.graph.not_found".to_string())
        })
        .transpose()?;
    Ok(AgentExecutionSelection {
        profile,
        graph_template,
    })
}

pub fn upsert_agent_profile(
    db_path: &Path,
    mut profile: crate::models::AgentProfile,
) -> Result<crate::models::AgentProfile, String> {
    validate_agent_profile(&profile)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let existing_builtin = conn
        .query_row(
            "SELECT built_in FROM agent_profiles WHERE profile_id=?1",
            params![profile.id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if existing_builtin || profile.built_in {
        return Err("agent.profile.builtin_readonly".to_string());
    }
    if let Some(model_id) = profile
        .model_id
        .as_deref()
        .filter(|value| !value.is_empty())
    {
        let exists = conn
            .query_row(
                "SELECT 1 FROM model_catalog WHERE id=?1",
                params![model_id],
                |_| Ok(true),
            )
            .optional()
            .map_err(|e| e.to_string())?
            .unwrap_or(false);
        if !exists {
            return Err("agent.profile.model_not_found".to_string());
        }
    }
    let now = now_iso();
    let created_at = conn
        .query_row(
            "SELECT created_at FROM agent_profiles WHERE profile_id=?1",
            params![profile.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| now.clone());
    profile.built_in = false;
    profile.created_at = created_at;
    profile.updated_at = now;
    insert_agent_profile_with_conn(&conn, &profile, true)?;
    Ok(profile)
}

pub fn upsert_agent_graph_template(
    db_path: &Path,
    mut graph: crate::models::AgentGraphTemplate,
) -> Result<crate::models::AgentGraphTemplate, String> {
    validate_agent_graph_template(&graph)?;
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let existing_builtin = conn
        .query_row(
            "SELECT built_in FROM agent_graph_templates WHERE graph_template_id=?1",
            params![graph.id],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    if existing_builtin || graph.built_in {
        return Err("agent.graph.builtin_readonly".to_string());
    }
    for node in &graph.nodes {
        if let Some(profile_id) = node.profile_id.as_deref() {
            if get_agent_profile(db_path, profile_id)?.is_none() {
                return Err("agent.graph.profile_not_found".to_string());
            }
        }
    }
    let now = now_iso();
    graph.created_at = conn
        .query_row(
            "SELECT created_at FROM agent_graph_templates WHERE graph_template_id=?1",
            params![graph.id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or_else(|| now.clone());
    graph.updated_at = now;
    graph.built_in = false;
    insert_agent_graph_with_conn(&conn, &graph, true)?;
    Ok(graph)
}

pub fn upsert_agent_binding(
    db_path: &Path,
    mut binding: crate::models::AgentBinding,
) -> Result<crate::models::AgentBinding, String> {
    if !agent_callsite_specs()
        .iter()
        .any(|(callsite, _, _)| *callsite == binding.callsite)
    {
        return Err("agent.binding.unsupported_callsite".to_string());
    }
    if get_agent_profile(db_path, &binding.profile_id)?.is_none() {
        return Err("agent.profile.not_found".to_string());
    }
    if let Some(graph_id) = binding.graph_template_id.as_deref() {
        if get_agent_graph_template(db_path, graph_id)?.is_none() {
            return Err("agent.graph.not_found".to_string());
        }
    }
    let project_scope = binding
        .project_id
        .as_deref()
        .map(str::trim)
        .unwrap_or_default()
        .to_string();
    if project_scope.len() > 128 || project_scope.contains('\0') {
        return Err("agent.binding.invalid_project".to_string());
    }
    binding.project_id = (!project_scope.is_empty()).then(|| project_scope.clone());
    binding.updated_at = now_iso();
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agent_profile_bindings(project_scope,callsite,profile_id,graph_template_id,updated_at)
         VALUES(?1,?2,?3,?4,?5)
         ON CONFLICT(project_scope,callsite) DO UPDATE SET
           profile_id=excluded.profile_id,graph_template_id=excluded.graph_template_id,
           updated_at=excluded.updated_at",
        params![
            project_scope,
            binding.callsite,
            binding.profile_id,
            binding.graph_template_id,
            binding.updated_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(binding)
}

pub fn delete_agent_binding(
    db_path: &Path,
    project_id: Option<&str>,
    callsite: &str,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM agent_profile_bindings WHERE project_scope=?1 AND callsite=?2",
        params![project_id.map(str::trim).unwrap_or_default(), callsite],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn list_recent_agent_runs(
    db_path: &Path,
    project_id: Option<&str>,
) -> Result<Vec<crate::models::AgentRunSummary>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut sql = "SELECT run_id,project_id,callsite,status,created_at,updated_at
                   FROM agent_runs"
        .to_string();
    let scope = project_id.map(str::trim).filter(|value| !value.is_empty());
    if scope.is_some() {
        sql.push_str(" WHERE project_id=?1");
    }
    sql.push_str(" ORDER BY updated_at DESC LIMIT 12");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let map = |row: &rusqlite::Row<'_>| {
        Ok(crate::models::AgentRunSummary {
            run_id: row.get(0)?,
            project_id: row.get(1)?,
            callsite: row.get(2)?,
            status: row.get(3)?,
            created_at: row.get(4)?,
            updated_at: row.get(5)?,
        })
    };
    let rows = if let Some(project_id) = scope {
        stmt.query_map(params![project_id], map)
    } else {
        stmt.query_map([], map)
    }
    .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn agent_control_catalog(
    db_path: &Path,
    project_id: Option<&str>,
) -> Result<crate::models::AgentControlCatalogResponse, String> {
    let profiles = list_agent_profiles(db_path)?;
    let graph_templates = list_agent_graph_templates(db_path)?;
    let bindings = list_agent_bindings(db_path, project_id)?;
    let callsites = agent_callsite_specs()
        .into_iter()
        .map(|(id, profile, graph)| {
            let (effective, source) =
                resolve_agent_binding(db_path, project_id.unwrap_or_default(), id)?;
            Ok(crate::models::AgentCallsiteDescriptor {
                id: id.to_string(),
                label_key: format!("agents.callsite.{id}.label"),
                description_key: format!("agents.callsite.{id}.description"),
                supports_graph: true,
                default_profile_id: profile.to_string(),
                default_graph_template_id: graph.map(str::to_string),
                effective_profile_id: effective.profile_id,
                effective_graph_template_id: effective.graph_template_id,
                binding_source: source,
            })
        })
        .collect::<Result<Vec<_>, String>>()?;
    Ok(crate::models::AgentControlCatalogResponse {
        profiles,
        bindings,
        graph_templates,
        callsites,
        recent_runs: list_recent_agent_runs(db_path, project_id)?,
    })
}

#[cfg(test)]
mod agent_control_tests {
    include!("agent_control_tests.rs");
}
