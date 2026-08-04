#[ouroboros::self_referencing]
struct LoadedKnowledgeHnsw {
    io: hnsw_rs::prelude::HnswIo,
    #[borrows(mut io)]
    #[not_covariant]
    hnsw: hnsw_rs::prelude::Hnsw<'this, u8, hnsw_rs::prelude::DistL2>,
}

struct KnowledgeHnswCache {
    key: String,
    index: LoadedKnowledgeHnsw,
}

static KNOWLEDGE_HNSW_CACHE: std::sync::OnceLock<std::sync::Mutex<Option<KnowledgeHnswCache>>> =
    std::sync::OnceLock::new();

fn knowledge_hnsw_file_stamp(path: &Path) -> Result<String, String> {
    let metadata =
        fs::metadata(path).map_err(|_| "knowledge.embedding.index_unavailable".to_string())?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    Ok(format!("{}:{modified}", metadata.len()))
}

fn knowledge_hnsw_cache_key(project_root: &Path) -> Result<String, String> {
    let index_dir = project_root.join(".latotex").join("index");
    let graph = index_dir.join("knowledge-vectors.hnsw.graph");
    let data = index_dir.join("knowledge-vectors.hnsw.data");
    Ok(format!(
        "{}:{}:{}",
        index_dir.to_string_lossy(),
        knowledge_hnsw_file_stamp(&graph)?,
        knowledge_hnsw_file_stamp(&data)?
    ))
}

fn load_knowledge_hnsw(project_root: &Path) -> Result<LoadedKnowledgeHnsw, String> {
    let index_dir = project_root.join(".latotex").join("index");
    LoadedKnowledgeHnswTryBuilder {
        io: hnsw_rs::prelude::HnswIo::new(&index_dir, "knowledge-vectors"),
        hnsw_builder: |io| {
            io.load_hnsw::<u8, hnsw_rs::prelude::DistL2>()
                .map_err(|_| "knowledge.embedding.index_unavailable".to_string())
        },
    }
    .try_build()
}

fn resolve_knowledge_vector_neighbors<I>(
    conn: &Connection,
    neighbors: I,
) -> Result<Vec<(String, f32)>, String>
where
    I: IntoIterator<Item = (usize, f32)>,
{
    let mut evidence = Vec::new();
    let mut resolve = conn
        .prepare(
            "SELECT v.evidence_id
             FROM knowledge_vectors v
             JOIN knowledge_chunks c ON c.evidence_id = v.evidence_id
             JOIN knowledge_items i ON i.item_id = c.item_id
             WHERE v.vector_id = ?1 AND i.index_state = 'ready'",
        )
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    for (vector_id, distance) in neighbors {
        if let Some(evidence_id) = resolve
            .query_row(params![vector_id as i64], |row| row.get::<_, String>(0))
            .optional()
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?
        {
            evidence.push((evidence_id, distance));
        }
    }
    Ok(evidence)
}

fn knowledge_semantic_candidates(
    project_root: &Path,
    runtime_root: &Path,
    query: &str,
    limit: usize,
) -> Result<Vec<(String, f32)>, String> {
    let status = embedding_runtime_status(project_root, runtime_root)?;
    if !status.available {
        return Ok(Vec::new());
    }
    let (model_path, tokenizer_path) = knowledge_embedding_model_paths(runtime_root)?;
    let query_vector =
        embed_knowledge_texts(&model_path, &tokenizer_path, &[query.to_string()], true)?
            .into_iter()
            .next()
            .ok_or_else(knowledge_embedding_error)?;
    let query_vector = knowledge_embedding_to_hnsw(&query_vector);
    let cache_key = knowledge_hnsw_cache_key(project_root)?;
    let cache = KNOWLEDGE_HNSW_CACHE.get_or_init(|| std::sync::Mutex::new(None));
    let mut guard = cache
        .lock()
        .map_err(|_| "knowledge.embedding.index_unavailable".to_string())?;
    let should_reload = guard
        .as_ref()
        .map(|cached| cached.key != cache_key)
        .unwrap_or(true);
    if should_reload {
        *guard = Some(KnowledgeHnswCache {
            key: cache_key,
            index: load_knowledge_hnsw(project_root)?,
        });
    }
    let neighbors = guard
        .as_ref()
        .ok_or_else(|| "knowledge.embedding.index_unavailable".to_string())?
        .index
        .with_hnsw(|hnsw| hnsw.search(&query_vector, limit.clamp(1, 400), 400));
    let conn = open_knowledge_index(project_root)?;
    resolve_knowledge_vector_neighbors(
        &conn,
        neighbors
            .into_iter()
            .map(|neighbor| (neighbor.d_id, neighbor.distance)),
    )
}

#[cfg(test)]
mod knowledge_embedding_search_tests {
    use super::*;
    use hnsw_rs::prelude::{DistL2, Hnsw};

    #[test]
    fn hnsw_write_reload_preserves_vector_to_evidence_mapping() {
        let project_root =
            std::env::temp_dir().join(format!("latotex-hnsw-reload-{}", Uuid::new_v4()));
        fs::create_dir_all(&project_root).expect("create project root");
        let conn = open_knowledge_index(&project_root).expect("open knowledge index");
        conn.execute(
            "INSERT INTO knowledge_items
             (item_id, project_id, relative_path, title, source_kind, content_hash,
              index_state, chunk_count, updated_at, failure_code)
             VALUES ('item-7', 'project-7', 'notes.md', 'Notes', 'markdown', 'hash',
                     'ready', 1, ?1, NULL)",
            params![now_iso()],
        )
        .expect("insert item");
        conn.execute(
            "INSERT INTO knowledge_chunks
             (evidence_id, item_id, chunk_index, anchor_json, text)
             VALUES ('evidence-7', 'item-7', 0, '{}', 'reproducible evidence')",
            [],
        )
        .expect("insert chunk");
        let primary = vec![16_u8; KNOWLEDGE_EMBEDDING_DIMENSIONS];
        conn.execute(
            "INSERT INTO knowledge_vectors (vector_id, evidence_id, embedding)
             VALUES (7, 'evidence-7', ?1)",
            params![primary.clone()],
        )
        .expect("insert vector mapping");

        // Keep this persistence/mapping contract independent of randomized
        // multi-point HNSW layer construction; ranking has separate coverage.
        let hnsw = Hnsw::new(8, 1, 16, 32, DistL2 {});
        hnsw.insert((&primary, 7));
        write_knowledge_hnsw(&project_root, &hnsw).expect("persist hnsw");
        let loaded = load_knowledge_hnsw(&project_root).expect("reload hnsw");
        let neighbors = loaded.with_hnsw(|index| index.search(&primary, 1, 32));
        let evidence = resolve_knowledge_vector_neighbors(
            &conn,
            neighbors
                .into_iter()
                .map(|neighbor| (neighbor.d_id, neighbor.distance)),
        )
        .expect("resolve evidence");

        assert_eq!(
            evidence.first().map(|item| item.0.as_str()),
            Some("evidence-7")
        );
        drop(conn);
        let _ = fs::remove_dir_all(project_root);
    }
}
