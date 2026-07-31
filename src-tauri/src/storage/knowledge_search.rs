fn knowledge_now_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|value| value.as_millis() as u64)
        .unwrap_or_default()
}

fn knowledge_item_from_row(
    row: &rusqlite::Row<'_>,
) -> rusqlite::Result<crate::models::KnowledgeItem> {
    Ok(crate::models::KnowledgeItem {
        item_id: row.get(0)?,
        project_id: row.get(1)?,
        relative_path: row.get(2)?,
        title: row.get(3)?,
        source_kind: row.get(4)?,
        content_hash: row.get(5)?,
        index_state: row.get(6)?,
        chunk_count: row.get::<_, i64>(7)? as u32,
        locked: true,
        updated_at: row.get(8)?,
        failure_code: row.get(9)?,
    })
}

pub fn list_knowledge_items(
    db_path: &Path,
    input: &crate::models::KnowledgeListInput,
) -> Result<Vec<crate::models::KnowledgeItem>, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    register_existing_papers(&project_root, &input.project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let mut stmt = conn
        .prepare(
            "SELECT item_id, project_id, relative_path, title, source_kind,
                    content_hash, index_state, chunk_count, updated_at, failure_code
             FROM knowledge_items ORDER BY title COLLATE NOCASE, relative_path COLLATE NOCASE",
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let rows = stmt
        .query_map([], knowledge_item_from_row)
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let mut items = Vec::new();
    for row in rows {
        let item = row.map_err(|_| "knowledge.index.failed".to_string())?;
        if input
            .source_kind
            .as_deref()
            .is_some_and(|value| value != item.source_kind)
            || input
                .index_state
                .as_deref()
                .is_some_and(|value| value != item.index_state)
        {
            continue;
        }
        items.push(item);
    }
    Ok(items)
}

fn register_existing_papers(project_root: &Path, project_id: &str) -> Result<(), String> {
    let papers_root = ensure_mutation_path(project_root, ".latotex/papers")?;
    fs::create_dir_all(&papers_root).map_err(|_| "knowledge.index.unavailable".to_string())?;
    let mut files = Vec::new();
    let mut pending = vec![papers_root.clone()];
    while files.len() < 50_000 {
        let Some(directory) = pending.pop() else {
            break;
        };
        for entry in
            fs::read_dir(&directory).map_err(|_| "knowledge.index.unavailable".to_string())?
        {
            let entry = entry.map_err(|_| "knowledge.index.unavailable".to_string())?;
            let path = entry.path();
            if workspace_path_is_link_or_reparse(&path)? {
                continue;
            }
            let metadata = entry
                .metadata()
                .map_err(|_| "knowledge.index.unavailable".to_string())?;
            if metadata.is_dir() {
                pending.push(path);
            } else if metadata.is_file() && knowledge_source_kind(&path.to_string_lossy()).is_ok() {
                files.push((path, metadata.len()));
            }
            if files.len() >= 50_000 {
                break;
            }
        }
    }
    let mut conn = open_knowledge_index(project_root)?;
    let tx = conn
        .transaction()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    for (path, size) in files {
        let relative_path = path
            .strip_prefix(project_root)
            .map_err(|_| "knowledge.path.invalid".to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let exists = tx
            .query_row(
                "SELECT 1 FROM knowledge_items WHERE relative_path = ?1",
                params![relative_path],
                |_| Ok(()),
            )
            .optional()
            .map_err(|_| "knowledge.index.failed".to_string())?
            .is_some();
        if exists {
            continue;
        }
        tx.execute(
            "INSERT INTO knowledge_items (
               item_id, project_id, relative_path, title, source_kind, content_hash,
               index_state, chunk_count, updated_at, failure_code
             ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', 0, ?7, NULL)",
            params![
                Uuid::new_v4().to_string(),
                project_id,
                relative_path,
                knowledge_title_from_path(&relative_path),
                knowledge_source_kind(&relative_path)?,
                format!("pending:{size}"),
                now_iso()
            ],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    }
    tx.commit()
        .map_err(|_| "knowledge.index.failed".to_string())
}

pub fn unarchive_knowledge_item(
    db_path: &Path,
    project_id: &str,
    item_id: &str,
) -> Result<Ack, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let mut conn = open_knowledge_index(&project_root)?;
    let tx = conn
        .transaction()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_chunks_fts WHERE evidence_id IN
         (SELECT evidence_id FROM knowledge_chunks WHERE item_id = ?1)",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_chunks_trigram WHERE evidence_id IN
         (SELECT evidence_id FROM knowledge_chunks WHERE item_id = ?1)",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_chunks WHERE item_id = ?1",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_links WHERE source_item_id = ?1",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    remove_knowledge_topic_links(&tx, item_id)?;
    let changed = tx
        .execute(
            "DELETE FROM knowledge_items WHERE item_id = ?1 AND project_id = ?2",
            params![item_id, project_id],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    if changed == 0 {
        return Err("knowledge.item.not_found".to_string());
    }
    invalidate_knowledge_embeddings(&tx)?;
    tx.commit()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    Ok(Ack {
        ok: true,
        message: "knowledge.unarchived".to_string(),
    })
}

pub fn embedding_runtime_status(
    project_root: &Path,
    runtime_root: &Path,
) -> Result<crate::models::EmbeddingRuntimeStatus, String> {
    let model_path = crate::commands::runtime_assets::find_runtime_asset_entry(
        runtime_root,
        "knowledge-embedding-model",
    )
    .unwrap_or_else(|| {
        runtime_root
            .join("tools")
            .join("embeddings")
            .join("multilingual-e5-small")
            .join("model_quantized.onnx")
    });
    let tokenizer_path = model_path.parent().map(|parent| {
        parent.join(crate::commands::plugins_trusted_recipes::KNOWLEDGE_TOKENIZER_ENTRY)
    });
    let installed = model_path.is_file()
        && fs::metadata(&model_path)
            .map(|metadata| {
                metadata.len() == crate::commands::plugins_trusted_recipes::KNOWLEDGE_EMBEDDING_SIZE
            })
            .unwrap_or(false)
        && tokenizer_path
            .as_ref()
            .and_then(|path| fs::metadata(path).ok())
            .map(|metadata| {
                metadata.len() == crate::commands::plugins_trusted_recipes::KNOWLEDGE_TOKENIZER_SIZE
            })
            .unwrap_or(false);
    let conn = open_knowledge_index(project_root)?;
    let index_fingerprint = conn
        .query_row(
            "SELECT meta_value FROM knowledge_meta WHERE meta_key = 'embedding_fingerprint'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let index_generation = conn
        .query_row(
            "SELECT meta_value FROM knowledge_meta WHERE meta_key = 'embedding_generation'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let ready_generation = conn
        .query_row(
            "SELECT generation FROM knowledge_embedding_jobs
             WHERE job_id = 1 AND state = 'ready'",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let index_dir = project_root.join(".latotex").join("index");
    let index_files_ready = index_dir.join("knowledge-vectors.hnsw.graph").is_file()
        && index_dir.join("knowledge-vectors.hnsw.data").is_file();
    let index_matches = index_fingerprint.as_deref() == Some(KNOWLEDGE_EMBEDDING_FINGERPRINT)
        && index_generation.is_some()
        && index_generation == ready_generation
        && index_files_ready;
    let rebuild_required = installed && !index_matches;
    Ok(crate::models::EmbeddingRuntimeStatus {
        plugin_id: KNOWLEDGE_EMBEDDING_PLUGIN_ID.to_string(),
        installed,
        available: installed && index_matches,
        model_fingerprint: installed.then(|| KNOWLEDGE_EMBEDDING_FINGERPRINT.to_string()),
        index_fingerprint,
        rebuild_required,
        mode: if installed && index_matches {
            "hybrid".to_string()
        } else {
            "lexical".to_string()
        },
    })
}

fn knowledge_match_query(query: &str) -> Option<String> {
    let tokens = query
        .split(|ch: char| ch.is_whitespace() || ch.is_ascii_punctuation())
        .map(str::trim)
        .filter(|value| value.chars().count() >= 2)
        .take(12)
        .map(|value| format!("\"{}\"", value.replace('"', "\"\"")))
        .collect::<Vec<_>>();
    (!tokens.is_empty()).then(|| tokens.join(" OR "))
}

fn knowledge_snippet(text: &str, query: &str, max_chars: usize) -> String {
    let lower = text.to_lowercase();
    let query_lower = query.to_lowercase();
    let byte_start = lower.find(&query_lower).unwrap_or(0);
    let match_char_start = lower
        .get(..byte_start)
        .map(|prefix| prefix.chars().count())
        .unwrap_or_default();
    let char_start = match_char_start.saturating_sub(max_chars / 4);
    text.chars().skip(char_start).take(max_chars).collect()
}

pub fn search_knowledge(
    db_path: &Path,
    runtime_root: &Path,
    input: &crate::models::KnowledgeSearchInput,
) -> Result<crate::models::KnowledgeSearchResponse, String> {
    let started = std::time::Instant::now();
    let run_id = knowledge_search_run_id(input.run_id.as_deref())?;
    let run = KnowledgeSearchRunGuard::register(run_id)?;
    let query = input.query.trim();
    if query.is_empty() || query.chars().count() > 512 {
        return Err("knowledge.search.query_invalid".to_string());
    }
    let semantic_enabled = input.semantic.unwrap_or(true);
    let deep_enabled = semantic_enabled && input.deep.unwrap_or(false);
    let limit = input.limit.unwrap_or(20).clamp(1, 100) as usize;
    let project_root = load_project_root(db_path, &input.project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let mut candidates =
        std::collections::HashMap::<String, (f64, std::collections::BTreeSet<String>)>::new();
    let like = format!(
        "%{}%",
        query
            .to_lowercase()
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    );
    let mut exact = conn
        .prepare(
            "SELECT c.evidence_id
             FROM knowledge_items i JOIN knowledge_chunks c
               ON c.item_id = i.item_id AND c.chunk_index = 0
             WHERE i.index_state = 'ready' AND (
               lower(i.title) LIKE ?1 ESCAPE '\\' OR
               lower(i.relative_path) LIKE ?1 ESCAPE '\\' OR
               lower(i.content_hash) = lower(?2)
             )
             ORDER BY i.title COLLATE NOCASE, c.chunk_index
             LIMIT 400",
        )
        .map_err(|_| "knowledge.search.failed".to_string())?;
    let exact_rows = exact
        .query_map(params![like, query], |row| row.get::<_, String>(0))
        .map_err(|_| "knowledge.search.failed".to_string())?;
    for (rank, row) in exact_rows.enumerate() {
        let evidence_id = row.map_err(|_| "knowledge.search.failed".to_string())?;
        let entry = candidates
            .entry(evidence_id)
            .or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
        entry.0 += 4.0 + 1.0 / (60.0 + rank as f64);
        entry.1.insert("exact".to_string());
    }
    let phrase_query = format!("\"{}\"", query.replace('"', "\"\""));
    let mut phrase = conn
        .prepare(
            "SELECT evidence_id, bm25(knowledge_chunks_fts)
             FROM knowledge_chunks_fts
             WHERE knowledge_chunks_fts MATCH ?1
             ORDER BY bm25(knowledge_chunks_fts) LIMIT 400",
        )
        .map_err(|_| "knowledge.search.failed".to_string())?;
    if let Ok(rows) = phrase.query_map(params![phrase_query], |row| {
        Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
    }) {
        for (rank, row) in rows.enumerate() {
            let (evidence_id, _) = row.map_err(|_| "knowledge.search.failed".to_string())?;
            let entry = candidates
                .entry(evidence_id)
                .or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
            entry.0 += 4.0 + 1.0 / (60.0 + rank as f64);
            entry.1.insert("exact".to_string());
        }
    }
    if query.chars().count() >= 3 {
        let trigram_query = format!("\"{}\"", query.replace('"', "\"\""));
        let mut trigram = conn
            .prepare(
                "SELECT evidence_id, bm25(knowledge_chunks_trigram)
                 FROM knowledge_chunks_trigram
                 WHERE knowledge_chunks_trigram MATCH ?1
                 ORDER BY bm25(knowledge_chunks_trigram) LIMIT 400",
            )
            .map_err(|_| "knowledge.search.failed".to_string())?;
        if let Ok(rows) = trigram.query_map(params![trigram_query], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
        }) {
            for (rank, row) in rows.enumerate() {
                let (evidence_id, _) = row.map_err(|_| "knowledge.search.failed".to_string())?;
                let entry = candidates
                    .entry(evidence_id)
                    .or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
                entry.0 += 4.0 + 1.0 / (60.0 + rank as f64);
                entry.1.insert("exact".to_string());
            }
        };
    }
    if let Some(match_query) = knowledge_match_query(query) {
        let mut fts = conn
            .prepare(
                "SELECT evidence_id, bm25(knowledge_chunks_fts)
                 FROM knowledge_chunks_fts
                 WHERE knowledge_chunks_fts MATCH ?1
                 ORDER BY bm25(knowledge_chunks_fts) LIMIT 400",
            )
            .map_err(|_| "knowledge.search.failed".to_string())?;
        let rows = fts
            .query_map(params![match_query], |row| {
                Ok((row.get::<_, String>(0)?, row.get::<_, f64>(1)?))
            })
            .map_err(|_| "knowledge.search.failed".to_string())?;
        for (rank, row) in rows.enumerate() {
            let (evidence_id, _) = row.map_err(|_| "knowledge.search.failed".to_string())?;
            let entry = candidates
                .entry(evidence_id)
                .or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
            entry.0 += 2.0 + 1.0 / (60.0 + rank as f64);
            entry.1.insert("bm25".to_string());
        }
    }
    run.ensure_active()?;
    let lexical_elapsed_ms = started.elapsed().as_millis() as u64;
    let semantic_started = std::time::Instant::now();
    let semantic = if semantic_enabled {
        knowledge_semantic_candidates(&project_root, runtime_root, query, 100)
    } else {
        Ok(Vec::new())
    };
    run.ensure_active()?;
    let semantic_elapsed_ms = semantic_enabled
        .then(|| semantic_started.elapsed().as_millis() as u64)
        .unwrap_or_default();
    for (rank, (evidence_id, _distance)) in semantic
        .as_ref()
        .map(Vec::as_slice)
        .unwrap_or_default()
        .iter()
        .enumerate()
    {
        let entry = candidates
            .entry(evidence_id.clone())
            .or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
        entry.0 += 1.5 + 1.0 / (60.0 + rank as f64);
        entry.1.insert("semantic".to_string());
    }
    if deep_enabled {
        let seeds = ranked_knowledge_seed_ids(&candidates, 40);
        for evidence_id in seeds {
            run.ensure_active()?;
            let row = conn
                .query_row(
                    "SELECT item_id, chunk_index FROM knowledge_chunks WHERE evidence_id = ?1",
                    params![evidence_id],
                    |row| Ok((row.get::<_, String>(0)?, row.get::<_, i64>(1)?)),
                )
                .optional()
                .map_err(|_| "knowledge.search.failed".to_string())?;
            let Some((item_id, chunk_index)) = row else {
                continue;
            };
            for neighbor in [chunk_index - 1, chunk_index + 1] {
                if neighbor < 0 {
                    continue;
                }
                if let Some(neighbor_id) = conn
                    .query_row(
                        "SELECT evidence_id FROM knowledge_chunks
                         WHERE item_id = ?1 AND chunk_index = ?2",
                        params![item_id, neighbor],
                        |row| row.get::<_, String>(0),
                    )
                    .optional()
                    .map_err(|_| "knowledge.search.failed".to_string())?
                {
                    let entry = candidates
                        .entry(neighbor_id)
                        .or_insert_with(|| (0.0, std::collections::BTreeSet::new()));
                    add_knowledge_match_once(entry, 0.5, "adjacent");
                }
            }
        }
    }
    let mut ranked = candidates.into_iter().collect::<Vec<_>>();
    ranked.sort_by(|left, right| {
        compare_knowledge_candidates(&left.0, left.1 .0, &right.0, right.1 .0)
    });
    let mut hits = Vec::new();
    run.ensure_active()?;
    let mut detail = conn
        .prepare(
            "SELECT c.evidence_id, c.item_id, c.anchor_json, c.text,
                    i.title, i.relative_path, i.source_kind
             FROM knowledge_chunks c JOIN knowledge_items i ON i.item_id = c.item_id
             WHERE c.evidence_id = ?1",
        )
        .map_err(|_| "knowledge.search.failed".to_string())?;
    for (evidence_id, (score, kinds)) in ranked.into_iter().take(limit) {
        run.ensure_active()?;
        let hit = detail
            .query_row(params![evidence_id], |row| {
                let evidence_id = row.get::<_, String>(0)?;
                let item_id = row.get::<_, String>(1)?;
                let anchor_json = row.get::<_, String>(2)?;
                let text = row.get::<_, String>(3)?;
                let title = row.get::<_, String>(4)?;
                let relative_path = row.get::<_, String>(5)?;
                let source_kind = row.get::<_, String>(6)?;
                let anchor = serde_json::from_str::<crate::models::KnowledgeAnchor>(&anchor_json)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
                let snippet = knowledge_snippet(&text, query, 520);
                let citation = crate::models::KnowledgeCitation {
                    citation_id: evidence_id.clone(),
                    project_id: input.project_id.clone(),
                    item_id: item_id.clone(),
                    title: title.clone(),
                    relative_path: relative_path.clone(),
                    source_kind: source_kind.clone(),
                    anchor: anchor.clone(),
                    snippet: snippet.clone(),
                    url: None,
                };
                Ok(crate::models::KnowledgeSearchHit {
                    evidence_id,
                    project_id: input.project_id.clone(),
                    item_id,
                    title,
                    relative_path,
                    source_kind,
                    anchor,
                    snippet,
                    score,
                    match_kinds: kinds.iter().cloned().collect(),
                    citation,
                })
            })
            .map_err(|_| "knowledge.search.failed".to_string())?;
        hits.push(hit);
    }
    let semantic_matched = hits
        .iter()
        .any(|hit| hit.match_kinds.iter().any(|kind| kind == "semantic"));
    let strategy = match (semantic_matched, deep_enabled) {
        (true, true) => "exact+bm25+semantic+graph-adjacent",
        (true, false) => "exact+bm25+semantic",
        (false, true) => "exact+bm25+graph-adjacent",
        (false, false) => "exact+bm25",
    };
    let mut embedding = embedding_runtime_status(&project_root, runtime_root)?;
    if semantic.is_err() {
        embedding.available = false;
        embedding.mode = "lexical".to_string();
    }
    Ok(crate::models::KnowledgeSearchResponse {
        run_id: run.run_id().to_string(),
        hits,
        strategy: strategy.to_string(),
        embedding,
        lexical_elapsed_ms,
        semantic_elapsed_ms,
        elapsed_ms: started.elapsed().as_millis() as u64,
    })
}

pub fn fetch_knowledge_evidence(
    db_path: &Path,
    input: &crate::models::KnowledgeFetchInput,
) -> Result<crate::models::KnowledgeFetchResponse, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let max_chars = input.max_chars.unwrap_or(4_000).clamp(200, 16_000) as usize;
    conn.query_row(
        "SELECT c.evidence_id, c.item_id, c.anchor_json, c.text,
                i.title, i.relative_path, i.source_kind
         FROM knowledge_chunks c JOIN knowledge_items i ON i.item_id = c.item_id
         WHERE c.evidence_id = ?1 AND i.project_id = ?2",
        params![input.evidence_id, input.project_id],
        |row| {
            let evidence_id = row.get::<_, String>(0)?;
            let item_id = row.get::<_, String>(1)?;
            let anchor =
                serde_json::from_str::<crate::models::KnowledgeAnchor>(&row.get::<_, String>(2)?)
                    .map_err(|_| rusqlite::Error::InvalidQuery)?;
            let text = row.get::<_, String>(3)?;
            let title = row.get::<_, String>(4)?;
            let relative_path = row.get::<_, String>(5)?;
            let source_kind = row.get::<_, String>(6)?;
            let bounded = text.chars().take(max_chars).collect::<String>();
            Ok(crate::models::KnowledgeFetchResponse {
                evidence_id: evidence_id.clone(),
                text: bounded.clone(),
                citation: crate::models::KnowledgeCitation {
                    citation_id: evidence_id,
                    project_id: input.project_id.clone(),
                    item_id,
                    title,
                    relative_path,
                    source_kind,
                    anchor,
                    snippet: bounded.chars().take(520).collect(),
                    url: None,
                },
            })
        },
    )
    .map_err(|_| "knowledge.evidence.not_found".to_string())
}
