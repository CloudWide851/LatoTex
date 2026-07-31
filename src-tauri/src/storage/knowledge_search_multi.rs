pub fn search_knowledge_scoped(
    db_path: &Path,
    runtime_root: &Path,
    input: &crate::models::KnowledgeSearchInput,
) -> Result<crate::models::KnowledgeSearchResponse, String> {
    let Some(requested) = input.project_ids.as_ref() else {
        return search_knowledge(db_path, runtime_root, input);
    };
    let run_id = knowledge_search_run_id(input.run_id.as_deref())?;
    let run = KnowledgeSearchRunGuard::register(run_id.clone())?;
    let mut project_ids = requested
        .iter()
        .map(|project_id| project_id.trim().to_string())
        .filter(|project_id| !project_id.is_empty())
        .collect::<Vec<_>>();
    project_ids.sort();
    project_ids.dedup();
    if project_ids.is_empty() || project_ids.len() > 64 {
        return Err("knowledge.search.project_scope_invalid".to_string());
    }
    let allowed = list_projects(db_path)?
        .into_iter()
        .map(|project| project.id)
        .collect::<std::collections::HashSet<_>>();
    if project_ids
        .iter()
        .any(|project_id| !allowed.contains(project_id))
    {
        return Err("knowledge.search.project_scope_invalid".to_string());
    }
    let started = std::time::Instant::now();
    let mut responses = Vec::with_capacity(project_ids.len());
    for batch in project_ids.chunks(4) {
        run.ensure_active()?;
        let batch_responses = std::thread::scope(|scope| {
            let handles = batch
                .iter()
                .map(|project_id| {
                    let mut project_input = input.clone();
                    project_input.project_id = project_id.clone();
                    project_input.project_ids = None;
                    project_input.run_id = Some(run_id.clone());
                    scope.spawn(move || search_knowledge(db_path, runtime_root, &project_input))
                })
                .collect::<Vec<_>>();
            handles
                .into_iter()
                .map(|handle| {
                    handle
                        .join()
                        .map_err(|_| "knowledge.search.failed".to_string())?
                })
                .collect::<Result<Vec<_>, String>>()
        })?;
        responses.extend(batch_responses);
    }
    run.ensure_active()?;
    let limit = input.limit.unwrap_or(20).clamp(1, 100) as usize;
    let lexical_elapsed_ms = responses
        .iter()
        .map(|response| response.lexical_elapsed_ms)
        .max()
        .unwrap_or_default();
    let semantic_elapsed_ms = responses
        .iter()
        .map(|response| response.semantic_elapsed_ms)
        .max()
        .unwrap_or_default();
    let mut ranked = Vec::new();
    let mut embedding = responses
        .first()
        .map(|response| response.embedding.clone())
        .ok_or_else(|| "knowledge.search.project_scope_invalid".to_string())?;
    embedding.available = responses
        .iter()
        .any(|response| response.embedding.available);
    embedding.rebuild_required = responses
        .iter()
        .any(|response| response.embedding.rebuild_required);
    embedding.mode = if embedding.available {
        "hybrid".to_string()
    } else {
        "lexical".to_string()
    };
    for response in responses {
        for (rank, mut hit) in response.hits.into_iter().enumerate() {
            hit.score += 1.0 / (60.0 + rank as f64);
            ranked.push(hit);
        }
    }
    ranked.sort_by(|left, right| {
        right
            .score
            .partial_cmp(&left.score)
            .unwrap_or(std::cmp::Ordering::Equal)
            .then_with(|| left.project_id.cmp(&right.project_id))
            .then_with(|| left.evidence_id.cmp(&right.evidence_id))
    });
    ranked.truncate(limit);
    let semantic = ranked
        .iter()
        .any(|hit| hit.match_kinds.iter().any(|kind| kind == "semantic"));
    Ok(crate::models::KnowledgeSearchResponse {
        run_id,
        hits: ranked,
        strategy: if semantic {
            "multi-project+exact+bm25+semantic+graph-adjacent".to_string()
        } else {
            "multi-project+exact+bm25+graph-adjacent".to_string()
        },
        embedding,
        lexical_elapsed_ms,
        semantic_elapsed_ms,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

#[cfg(test)]
mod knowledge_search_multi_tests {
    use super::*;

    #[test]
    fn explicit_project_scope_merges_at_most_four_authorized_indices() {
        let root =
            std::env::temp_dir().join(format!("latotex-knowledge-global-{}", Uuid::new_v4()));
        let db_path = root.join("runtime").join("latotex.db");
        let projects_root = root.join("projects");
        fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&projects_root).unwrap();
        initialize_database(&db_path).unwrap();
        let first = create_project(&db_path, &projects_root, "First").unwrap();
        let second = create_project(&db_path, &projects_root, "Second").unwrap();
        for (project_id, marker) in [(&first.summary.id, "first"), (&second.summary.id, "second")] {
            let project_root = load_project_root(&db_path, project_id).unwrap();
            fs::write(
                project_root.join(format!("{marker}.txt")),
                format!("shared evidence from {marker}"),
            )
            .unwrap();
            archive_knowledge_item(&db_path, project_id, &format!("{marker}.txt"), None).unwrap();
        }
        let response = search_knowledge_scoped(
            &db_path,
            &root,
            &crate::models::KnowledgeSearchInput {
                project_id: first.summary.id.clone(),
                project_ids: Some(vec![first.summary.id.clone(), second.summary.id.clone()]),
                query: "shared evidence".to_string(),
                limit: Some(20),
                deep: Some(false),
                run_id: Some("knowledge-multi-test".to_string()),
                semantic: Some(false),
            },
        )
        .unwrap();
        let projects = response
            .hits
            .iter()
            .map(|hit| hit.project_id.as_str())
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(projects.len(), 2);
        assert_eq!(response.run_id, "knowledge-multi-test");
        assert!(response.strategy.starts_with("multi-project+"));
        let _ = fs::remove_dir_all(root);
    }
}
