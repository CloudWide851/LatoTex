pub fn knowledge_graph(
    db_path: &Path,
    input: &crate::models::KnowledgeGraphInput,
) -> Result<crate::models::KnowledgeGraphResponse, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let limit = input.limit.unwrap_or(2_000).clamp(1, 2_000) as usize;
    let query_like = input
        .query
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("%{}%", value.to_lowercase()));
    let mut nodes = Vec::new();
    let mut item_ids = std::collections::HashSet::new();
    let mut stmt = conn
        .prepare(
            "SELECT item_id, title FROM knowledge_items
             WHERE project_id = ?1
               AND (?2 IS NULL OR item_id = ?2)
               AND (?3 IS NULL OR lower(title) LIKE ?3)
             ORDER BY title COLLATE NOCASE LIMIT ?4",
        )
        .map_err(|_| "knowledge.graph.failed".to_string())?;
    let rows = stmt
        .query_map(
            params![input.project_id, input.item_id, query_like, limit as i64],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .map_err(|_| "knowledge.graph.failed".to_string())?;
    for row in rows {
        let (id, label) = row.map_err(|_| "knowledge.graph.failed".to_string())?;
        item_ids.insert(id.clone());
        nodes.push(crate::models::KnowledgeGraphNode {
            id: id.clone(),
            kind: "document".to_string(),
            label,
            confidence: 1.0,
            item_id: Some(id),
        });
    }
    let mut edges = Vec::new();
    let mut link_stmt = conn
        .prepare(
            "SELECT link_id, source_item_id, target_ref, kind, confidence
             FROM knowledge_links ORDER BY source_item_id, link_id LIMIT ?1",
        )
        .map_err(|_| "knowledge.graph.failed".to_string())?;
    let link_rows = link_stmt
        .query_map(params![limit as i64 * 4], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|_| "knowledge.graph.failed".to_string())?;
    let mut topic_ids = std::collections::HashSet::new();
    for row in link_rows {
        let (id, source, target_ref, kind, confidence) =
            row.map_err(|_| "knowledge.graph.failed".to_string())?;
        if !item_ids.contains(&source) {
            continue;
        }
        let target = format!(
            "topic:{}",
            knowledge_hex_sha256(target_ref.as_bytes())[..16].to_string()
        );
        if topic_ids.insert(target.clone()) && nodes.len() < limit {
            nodes.push(crate::models::KnowledgeGraphNode {
                id: target.clone(),
                kind: if kind == "doi" { "citation" } else { "topic" }.to_string(),
                label: target_ref,
                confidence,
                item_id: None,
            });
        }
        edges.push(crate::models::KnowledgeGraphEdge {
            id,
            source,
            target,
            kind,
            confidence,
        });
    }
    let mut topic_stmt = conn
        .prepare(
            "SELECT t.topic_id, t.label, t.confidence, l.item_id, l.confidence
             FROM knowledge_topics t
             JOIN knowledge_topic_links l ON l.topic_id = t.topic_id
             WHERE t.hidden = 0
             ORDER BY t.label COLLATE NOCASE, l.item_id LIMIT ?1",
        )
        .map_err(|_| "knowledge.graph.failed".to_string())?;
    let topic_rows = topic_stmt
        .query_map(params![limit as i64 * 4], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, f64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, f64>(4)?,
            ))
        })
        .map_err(|_| "knowledge.graph.failed".to_string())?;
    for row in topic_rows {
        let (topic_id, label, topic_confidence, item_id, edge_confidence) =
            row.map_err(|_| "knowledge.graph.failed".to_string())?;
        if !item_ids.contains(&item_id) {
            continue;
        }
        if topic_ids.insert(topic_id.clone()) && nodes.len() < limit {
            nodes.push(crate::models::KnowledgeGraphNode {
                id: topic_id.clone(),
                kind: "topic".to_string(),
                label,
                confidence: topic_confidence,
                item_id: None,
            });
        }
        edges.push(crate::models::KnowledgeGraphEdge {
            id: format!("topic-link:{item_id}:{topic_id}"),
            source: item_id,
            target: topic_id,
            kind: "topic".to_string(),
            confidence: edge_confidence,
        });
    }
    let total_nodes = nodes.len() as u32;
    Ok(crate::models::KnowledgeGraphResponse {
        nodes,
        edges,
        aggregated: total_nodes as usize >= limit,
        total_nodes,
    })
}
