fn knowledge_scope_relative(scope: &str, path: &str) -> Result<String, String> {
    let normalized = normalize_workspace_path(path)?
        .to_string_lossy()
        .replace('\\', "/");
    match scope {
        "workspace" => Ok(normalized),
        "library" => Ok(format!(".latotex/papers/{normalized}")),
        _ => Err("workspace.scope.unsupported".to_string()),
    }
}

fn impacted_knowledge_items(
    conn: &Connection,
    project_id: &str,
    relative_path: &str,
) -> Result<Vec<crate::models::KnowledgeItem>, String> {
    let prefix = format!("{}/%", relative_path.trim_end_matches('/'));
    let mut stmt = conn
        .prepare(
            "SELECT item_id, project_id, relative_path, title, source_kind,
                    content_hash, index_state, chunk_count, updated_at, failure_code
             FROM knowledge_items
             WHERE project_id = ?1 AND (relative_path = ?2 OR relative_path LIKE ?3)
             ORDER BY relative_path",
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let rows = stmt
        .query_map(
            params![project_id, relative_path, prefix],
            knowledge_item_from_row,
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    rows.map(|row| row.map_err(|_| "knowledge.index.failed".to_string()))
        .collect()
}

fn knowledge_content_version(items: &[crate::models::KnowledgeItem]) -> String {
    let material = items
        .iter()
        .map(|item| format!("{}:{}", item.item_id, item.content_hash))
        .collect::<Vec<_>>()
        .join("|");
    knowledge_hex_sha256(material.as_bytes())
}

pub fn preview_knowledge_mutation(
    db_path: &Path,
    input: &crate::models::KnowledgeMutationPreviewInput,
) -> Result<crate::models::KnowledgeMutationPreview, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let relative_path = knowledge_scope_relative(&input.scope, &input.path)?;
    let conn = open_knowledge_index(&project_root)?;
    let items = impacted_knowledge_items(&conn, &input.project_id, &relative_path)?;
    if items.is_empty() {
        return Ok(crate::models::KnowledgeMutationPreview {
            required: false,
            affected_items: Vec::new(),
            approval: None,
        });
    }
    let token = Uuid::new_v4().to_string();
    let expires_at = knowledge_now_unix_ms() + 5 * 60 * 1000;
    let content_version = knowledge_content_version(&items);
    conn.execute(
        "INSERT INTO knowledge_mutation_approvals
         (token, scope, action, path, target_path, content_version, expires_at_unix_ms, consumed)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 0)",
        params![
            token,
            input.scope,
            input.action,
            input.path,
            input.target_path,
            content_version,
            expires_at as i64
        ],
    )
    .map_err(|_| "knowledge.approval.failed".to_string())?;
    Ok(crate::models::KnowledgeMutationPreview {
        required: true,
        affected_items: items,
        approval: Some(crate::models::KnowledgeMutationApproval {
            token,
            expires_at_unix_ms: expires_at,
            content_version,
        }),
    })
}

pub fn validate_knowledge_mutation(
    db_path: &Path,
    project_id: &str,
    scope: &str,
    action: &str,
    path: &str,
    target_path: Option<&str>,
    token: Option<&str>,
) -> Result<(), String> {
    let project_root = load_project_root(db_path, project_id)?;
    let relative_path = knowledge_scope_relative(scope, path)?;
    let conn = open_knowledge_index(&project_root)?;
    let items = impacted_knowledge_items(&conn, project_id, &relative_path)?;
    if items.is_empty() {
        return Ok(());
    }
    let token = token.ok_or_else(|| "knowledge.mutation.approval_required".to_string())?;
    let row = conn
        .query_row(
            "SELECT scope, action, path, target_path, content_version,
                    expires_at_unix_ms, consumed
             FROM knowledge_mutation_approvals WHERE token = ?1",
            params![token],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, Option<String>>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, i64>(5)?,
                    row.get::<_, i64>(6)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "knowledge.approval.invalid".to_string())?
        .ok_or_else(|| "knowledge.approval.invalid".to_string())?;
    if row.0 != scope
        || row.1 != action
        || row.2 != path
        || row.3.as_deref() != target_path
        || row.4 != knowledge_content_version(&items)
        || row.5 < knowledge_now_unix_ms() as i64
        || row.6 != 0
    {
        return Err("knowledge.approval.invalid".to_string());
    }
    conn.execute(
        "UPDATE knowledge_mutation_approvals SET consumed = 1 WHERE token = ?1 AND consumed = 0",
        params![token],
    )
    .map_err(|_| "knowledge.approval.invalid".to_string())?;
    Ok(())
}

pub fn sync_knowledge_after_fs_operation(
    db_path: &Path,
    project_id: &str,
    scope: &str,
    action: &str,
    path: &str,
    target_path: Option<&str>,
) -> Result<(), String> {
    let project_root = load_project_root(db_path, project_id)?;
    let source = knowledge_scope_relative(scope, path)?;
    let conn = open_knowledge_index(&project_root)?;
    let items = impacted_knowledge_items(&conn, project_id, &source)?;
    let has_impacted_items = !items.is_empty();
    if action == "rename" || action == "move" {
        let target = knowledge_scope_relative(
            scope,
            target_path.ok_or_else(|| "workspace.target.required".to_string())?,
        )?;
        for item in items {
            let suffix = item.relative_path.strip_prefix(&source).unwrap_or("");
            let rewritten = format!("{}{}", target.trim_end_matches('/'), suffix);
            conn.execute(
                "UPDATE knowledge_items
                 SET relative_path = ?1, index_state = 'stale', updated_at = ?2,
                     failure_code = 'knowledge.source_moved'
                 WHERE item_id = ?3",
                params![rewritten, now_iso(), item.item_id],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
        }
    } else if action == "delete" {
        let now = knowledge_now_unix_ms() as i64;
        for item in items {
            conn.execute(
                "INSERT OR REPLACE INTO knowledge_tombstones
                 (item_id, previous_path, content_hash, deleted_at_unix_ms)
                 VALUES (?1, ?2, ?3, ?4)",
                params![item.item_id, item.relative_path, item.content_hash, now],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
            conn.execute(
                "DELETE FROM knowledge_chunks_fts WHERE evidence_id IN
                 (SELECT evidence_id FROM knowledge_chunks WHERE item_id = ?1)",
                params![item.item_id],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
            conn.execute(
                "DELETE FROM knowledge_chunks_trigram WHERE evidence_id IN
                 (SELECT evidence_id FROM knowledge_chunks WHERE item_id = ?1)",
                params![item.item_id],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
            conn.execute(
                "DELETE FROM knowledge_chunks WHERE item_id = ?1",
                params![item.item_id],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
            conn.execute(
                "DELETE FROM knowledge_links WHERE source_item_id = ?1",
                params![item.item_id],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
            remove_knowledge_topic_links(&conn, &item.item_id)?;
            conn.execute(
                "DELETE FROM knowledge_items WHERE item_id = ?1",
                params![item.item_id],
            )
            .map_err(|_| "knowledge.index.failed".to_string())?;
        }
        if has_impacted_items {
            invalidate_knowledge_embeddings(&conn)?;
        }
    }
    Ok(())
}

pub fn mark_knowledge_source_stale(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<(), String> {
    let project_root = load_project_root(db_path, project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let changed = conn
        .execute(
            "UPDATE knowledge_items
         SET index_state = 'stale', updated_at = ?1,
             failure_code = 'knowledge.source_changed'
         WHERE project_id = ?2 AND relative_path = ?3",
            params![now_iso(), project_id, relative_path],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    if changed > 0 {
        invalidate_knowledge_embeddings(&conn)?;
    }
    Ok(())
}

pub fn knowledge_path_is_archived(
    project_root: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<bool, String> {
    if !knowledge_index_path(project_root).is_file() {
        return Ok(false);
    }
    let conn = open_knowledge_index(project_root)?;
    conn.query_row(
        "SELECT 1 FROM knowledge_items WHERE project_id = ?1 AND relative_path = ?2",
        params![project_id, relative_path],
        |_| Ok(()),
    )
    .optional()
    .map(|value| value.is_some())
    .map_err(|_| "knowledge.index.failed".to_string())
}

pub fn enrich_tree_with_knowledge(
    project_root: &Path,
    nodes: &mut [crate::models::ResourceNode],
    relative_prefix: &str,
) -> Result<(), String> {
    let path = knowledge_index_path(project_root);
    if !path.is_file() {
        return Ok(());
    }
    let conn = open_knowledge_index(project_root)?;
    let mut states = std::collections::HashMap::<String, String>::new();
    let mut stmt = conn
        .prepare("SELECT relative_path, index_state FROM knowledge_items")
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "knowledge.index.failed".to_string())?;
    for row in rows {
        let (path, state) = row.map_err(|_| "knowledge.index.failed".to_string())?;
        states.insert(path, state);
    }
    fn walk(
        nodes: &mut [crate::models::ResourceNode],
        prefix: &str,
        states: &std::collections::HashMap<String, String>,
    ) {
        for node in nodes {
            let lookup = if prefix.is_empty() {
                node.relative_path.clone()
            } else {
                format!("{}/{}", prefix.trim_end_matches('/'), node.relative_path)
            };
            if let Some(state) = states.get(&lookup) {
                node.knowledge_state = Some(state.clone());
                node.knowledge_locked = Some(true);
            }
            walk(&mut node.children, prefix, states);
        }
    }
    walk(nodes, relative_prefix, &states);
    Ok(())
}

pub fn validate_research_answer(
    db_path: &Path,
    envelope: &crate::models::ResearchAnswerEnvelope,
) -> Result<crate::models::ResearchAnswerValidation, String> {
    let project_root = load_project_root(db_path, &envelope.project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let mut invalid = std::collections::BTreeSet::new();
    let mut unsupported = Vec::new();
    for (index, claim) in envelope.claims.iter().enumerate() {
        if claim.text.trim().is_empty() {
            unsupported.push(index as u32);
            continue;
        }
        let mut valid_count = 0;
        for citation_id in &claim.citation_ids {
            let exists = conn
                .query_row(
                    "SELECT 1 FROM knowledge_chunks c JOIN knowledge_items i ON i.item_id = c.item_id
                     WHERE c.evidence_id = ?1 AND i.project_id = ?2",
                    params![citation_id, envelope.project_id],
                    |_| Ok(()),
                )
                .optional()
                .map_err(|_| "knowledge.index.failed".to_string())?
                .is_some();
            if exists {
                valid_count += 1;
            } else {
                invalid.insert(citation_id.clone());
            }
        }
        if claim.kind == "fact" && valid_count == 0 {
            unsupported.push(index as u32);
        }
    }
    Ok(crate::models::ResearchAnswerValidation {
        valid: unsupported.is_empty() && invalid.is_empty(),
        unsupported_claims: unsupported,
        invalid_citation_ids: invalid.into_iter().collect(),
    })
}

#[cfg(test)]
mod knowledge_index_tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf, String) {
        let root = std::env::temp_dir().join(format!("latotex-knowledge-{}", Uuid::new_v4()));
        let db_path = root.join("runtime").join("latotex.db");
        let projects = root.join("projects");
        fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&projects).unwrap();
        initialize_database(&db_path).unwrap();
        let snapshot = create_project(&db_path, &projects, "Knowledge").unwrap();
        (root, db_path, snapshot.summary.id)
    }

    #[test]
    fn archives_searches_and_unarchives_markdown_without_copying_source() {
        let (root, db_path, project_id) = fixture();
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(
            project_root.join("notes.md"),
            "# Reproducibility\n\nA fixed seed makes bootstrap intervals reproducible.",
        )
        .unwrap();
        let item = archive_knowledge_item(&db_path, &project_id, "notes.md", None).unwrap();
        assert!(project_root.join("notes.md").is_file());
        let response = search_knowledge(
            &db_path,
            &root,
            &crate::models::KnowledgeSearchInput {
                project_id: project_id.clone(),
                project_ids: None,
                query: "fixed seed".to_string(),
                limit: Some(20),
                deep: Some(true),
                run_id: Some("knowledge-lexical-test".to_string()),
                semantic: Some(false),
            },
        )
        .unwrap();
        assert_eq!(response.run_id, "knowledge-lexical-test");
        assert_eq!(response.strategy, "exact+bm25");
        assert_eq!(response.semantic_elapsed_ms, 0);
        assert_eq!(response.hits.len(), 1);
        assert_eq!(response.hits[0].citation.anchor.line_start, Some(1));
        unarchive_knowledge_item(&db_path, &project_id, &item.item_id).unwrap();
        assert!(project_root.join("notes.md").is_file());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn mutation_approval_is_bound_and_single_use() {
        let (root, db_path, project_id) = fixture();
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(project_root.join("locked.txt"), "archived evidence").unwrap();
        archive_knowledge_item(&db_path, &project_id, "locked.txt", None).unwrap();
        let preview = preview_knowledge_mutation(
            &db_path,
            &crate::models::KnowledgeMutationPreviewInput {
                project_id: project_id.clone(),
                scope: "workspace".to_string(),
                action: "delete".to_string(),
                path: "locked.txt".to_string(),
                target_path: None,
            },
        )
        .unwrap();
        let token = preview.approval.unwrap().token;
        validate_knowledge_mutation(
            &db_path,
            &project_id,
            "workspace",
            "delete",
            "locked.txt",
            None,
            Some(&token),
        )
        .unwrap();
        assert_eq!(
            validate_knowledge_mutation(
                &db_path,
                &project_id,
                "workspace",
                "delete",
                "locked.txt",
                None,
                Some(&token),
            )
            .unwrap_err(),
            "knowledge.approval.invalid"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn rejects_unsupported_and_unsafe_archive_paths() {
        let (root, db_path, project_id) = fixture();
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(project_root.join("legacy.doc"), "legacy").unwrap();
        assert_eq!(
            archive_knowledge_item(&db_path, &project_id, "legacy.doc", None).unwrap_err(),
            "knowledge.archive.format_unsupported"
        );
        assert_eq!(
            archive_knowledge_item(&db_path, &project_id, "../outside.txt", None).unwrap_err(),
            "workspace.path.outside_root"
        );
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn pdf_page_chunks_keep_tail_evidence_and_literal_wildcards() {
        let (root, db_path, project_id) = fixture();
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(project_root.join("paper.pdf"), b"%PDF-1.7 fixture").unwrap();
        let page_text = format!(
            "{} tail-recall-marker",
            "reproducible evidence ".repeat(240)
        );
        archive_knowledge_item(
            &db_path,
            &project_id,
            "paper.pdf",
            Some(vec![(7, page_text)]),
        )
        .unwrap();
        let result = search_knowledge(
            &db_path,
            &root,
            &crate::models::KnowledgeSearchInput {
                project_id: project_id.clone(),
                project_ids: None,
                query: "tail-recall-marker".to_string(),
                limit: Some(20),
                deep: Some(false),
                run_id: None,
                semantic: Some(false),
            },
        )
        .unwrap();
        assert_eq!(result.hits.len(), 1);
        assert_eq!(result.hits[0].anchor.page, Some(7));
        let wildcard = search_knowledge(
            &db_path,
            &root,
            &crate::models::KnowledgeSearchInput {
                project_id,
                project_ids: None,
                query: "%".to_string(),
                limit: Some(20),
                deep: Some(false),
                run_id: None,
                semantic: Some(false),
            },
        )
        .unwrap();
        assert!(wildcard.hits.is_empty());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn trigram_index_recalls_cjk_sentences_exactly() {
        let (root, db_path, project_id) = fixture();
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(
            project_root.join("中文笔记.md"),
            "# 方法\n\n方法部分说明这是一个可重复的中文检索基准，结论明确。",
        )
        .unwrap();
        archive_knowledge_item(&db_path, &project_id, "中文笔记.md", None).unwrap();
        let result = search_knowledge(
            &db_path,
            &root,
            &crate::models::KnowledgeSearchInput {
                project_id,
                project_ids: None,
                query: "可重复的中文检索基准".to_string(),
                limit: Some(20),
                deep: Some(false),
                run_id: None,
                semantic: Some(false),
            },
        )
        .unwrap();
        assert_eq!(result.hits.len(), 1);
        assert!(result.hits[0]
            .match_kinds
            .iter()
            .any(|kind| kind == "exact"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn existing_index_backfills_trigrams_once_during_schema_migration() {
        let (root, db_path, project_id) = fixture();
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        fs::write(
            project_root.join("迁移笔记.txt"),
            "旧索引也必须召回这一段唯一中文证据。",
        )
        .unwrap();
        archive_knowledge_item(&db_path, &project_id, "迁移笔记.txt", None).unwrap();
        let conn = open_knowledge_index(&project_root).unwrap();
        conn.execute("DELETE FROM knowledge_chunks_trigram", [])
            .unwrap();
        conn.execute(
            "UPDATE knowledge_meta SET meta_value = '0' WHERE meta_key = 'schema_version'",
            [],
        )
        .unwrap();
        drop(conn);

        let migrated = open_knowledge_index(&project_root).unwrap();
        let count = migrated
            .query_row(
                "SELECT count(*) FROM knowledge_chunks_trigram
                 WHERE knowledge_chunks_trigram MATCH '\"唯一中文证据\"'",
                [],
                |row| row.get::<_, i64>(0),
            )
            .unwrap();
        let version = migrated
            .query_row(
                "SELECT meta_value FROM knowledge_meta WHERE meta_key = 'schema_version'",
                [],
                |row| row.get::<_, String>(0),
            )
            .unwrap();
        assert_eq!(count, 1);
        assert_eq!(version, KNOWLEDGE_SCHEMA_VERSION.to_string());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unicode_casefold_snippet_keeps_character_boundaries() {
        let snippet = knowledge_snippet("İ prefix TARGET marker", "target", 20);
        assert!(snippet.contains("TARGET"));
    }
}
