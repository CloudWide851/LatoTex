pub fn delete_agent_profile(
    db_path: &Path,
    profile_id: &str,
) -> Result<crate::models::AgentControlDeleteResponse, String> {
    let profile = get_agent_profile(db_path, profile_id)?
        .ok_or_else(|| "agent.profile.not_found".to_string())?;
    if profile.built_in {
        return Err("agent.profile.builtin_readonly".to_string());
    }
    let affected = list_all_agent_bindings(db_path)?
        .into_iter()
        .filter(|binding| binding.profile_id == profile_id)
        .collect::<Vec<_>>();
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for binding in &affected {
        let fallback = default_agent_binding(&binding.callsite)
            .ok_or_else(|| "agent.binding.unsupported_callsite".to_string())?;
        tx.execute(
            "UPDATE agent_profile_bindings SET profile_id=?3,updated_at=?4
             WHERE project_scope=?1 AND callsite=?2",
            params![
                binding.project_id.as_deref().unwrap_or_default(),
                binding.callsite,
                fallback.profile_id,
                now_iso(),
            ],
        )
        .map_err(|e| e.to_string())?;
    }
    let mut stmt = tx
        .prepare("SELECT graph_template_id,nodes_json FROM agent_graph_templates WHERE built_in=0")
        .map_err(|e| e.to_string())?;
    let graph_rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    drop(stmt);
    for (graph_id, nodes_json) in graph_rows {
        let mut nodes = serde_json::from_str::<Vec<crate::models::AgentGraphNode>>(&nodes_json)
            .map_err(|e| e.to_string())?;
        let mut changed = false;
        for node in &mut nodes {
            if node.profile_id.as_deref() == Some(profile_id) {
                node.profile_id = Some("builtin-researcher".to_string());
                changed = true;
            }
        }
        if changed {
            tx.execute(
                "UPDATE agent_graph_templates SET nodes_json=?2,updated_at=?3
                 WHERE graph_template_id=?1",
                params![
                    graph_id,
                    serde_json::to_string(&nodes).map_err(|e| e.to_string())?,
                    now_iso(),
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    let deleted = tx
        .execute(
            "DELETE FROM agent_profiles WHERE profile_id=?1 AND built_in=0",
            params![profile_id],
        )
        .map_err(|e| e.to_string())?
        > 0;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(crate::models::AgentControlDeleteResponse {
        deleted,
        fallback_profile_id: Some("builtin-researcher".to_string()),
        affected_bindings: affected,
    })
}

pub fn delete_agent_graph_template(
    db_path: &Path,
    graph_template_id: &str,
) -> Result<crate::models::AgentControlDeleteResponse, String> {
    let graph = get_agent_graph_template(db_path, graph_template_id)?
        .ok_or_else(|| "agent.graph.not_found".to_string())?;
    if graph.built_in {
        return Err("agent.graph.builtin_readonly".to_string());
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE agent_profile_bindings SET graph_template_id=NULL,updated_at=?2
         WHERE graph_template_id=?1",
        params![graph_template_id, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    let deleted = conn
        .execute(
            "DELETE FROM agent_graph_templates WHERE graph_template_id=?1 AND built_in=0",
            params![graph_template_id],
        )
        .map_err(|e| e.to_string())?
        > 0;
    Ok(crate::models::AgentControlDeleteResponse {
        deleted,
        fallback_profile_id: None,
        affected_bindings: Vec::new(),
    })
}
