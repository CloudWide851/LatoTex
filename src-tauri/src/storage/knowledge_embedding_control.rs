pub fn knowledge_embedding_job_status(
    db_path: &Path,
    project_id: &str,
) -> Result<crate::models::KnowledgeEmbeddingJobStatus, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    conn.query_row(
        "SELECT state, processed, total, generation, failure_code
         FROM knowledge_embedding_jobs WHERE job_id = 1",
        [],
        |row| {
            Ok(crate::models::KnowledgeEmbeddingJobStatus {
                state: row.get(0)?,
                processed: row.get::<_, i64>(1)?.max(0) as u64,
                total: row.get::<_, i64>(2)?.max(0) as u64,
                generation: row.get(3)?,
                failure_code: row.get(4)?,
            })
        },
    )
    .optional()
    .map_err(|_| "knowledge.embedding.index_failed".to_string())
    .map(|status| {
        status.unwrap_or(crate::models::KnowledgeEmbeddingJobStatus {
            state: "idle".to_string(),
            processed: 0,
            total: 0,
            generation: None,
            failure_code: None,
        })
    })
}

pub fn pause_knowledge_embeddings(
    db_path: &Path,
    project_id: &str,
) -> Result<crate::models::KnowledgeEmbeddingJobStatus, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    conn.execute(
        "UPDATE knowledge_embedding_jobs
         SET pause_requested = 1,
             state = CASE WHEN state = 'queued' THEN 'paused' ELSE state END,
             updated_at = ?1
         WHERE job_id = 1 AND state IN ('queued', 'indexing')",
        params![now_iso()],
    )
    .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    knowledge_embedding_job_status(db_path, project_id)
}

pub fn queue_knowledge_embeddings(
    db_path: &Path,
    project_id: &str,
) -> Result<(crate::models::KnowledgeEmbeddingJobStatus, bool), String> {
    let project_root = load_project_root(db_path, project_id)?;
    let conn = open_knowledge_index(&project_root)?;
    let queued = conn
        .execute(
            "INSERT INTO knowledge_embedding_jobs
             (job_id, state, generation, processed, total, pause_requested,
              failure_code, updated_at)
             VALUES (1, 'queued', '', 0, 0, 0, NULL, ?1)
             ON CONFLICT(job_id) DO UPDATE SET
               state='queued', pause_requested=0, failure_code=NULL,
               updated_at=excluded.updated_at
             WHERE knowledge_embedding_jobs.state NOT IN ('queued', 'indexing')",
            params![now_iso()],
        )
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?
        > 0;
    Ok((knowledge_embedding_job_status(db_path, project_id)?, queued))
}

#[cfg(test)]
mod knowledge_embedding_tests {
    use super::*;

    fn fixture() -> (PathBuf, PathBuf, String) {
        let root =
            std::env::temp_dir().join(format!("latotex-knowledge-embedding-{}", Uuid::new_v4()));
        let db_path = root.join("runtime").join("latotex.db");
        let projects = root.join("projects");
        fs::create_dir_all(db_path.parent().unwrap()).unwrap();
        fs::create_dir_all(&projects).unwrap();
        initialize_database(&db_path).unwrap();
        let snapshot = create_project(&db_path, &projects, "Knowledge embeddings").unwrap();
        (root, db_path, snapshot.summary.id)
    }

    #[test]
    fn quantization_is_bounded_and_normalized() {
        let mut vector = vec![0.0_f32; KNOWLEDGE_EMBEDDING_DIMENSIONS];
        vector[0] = 3.0;
        vector[1] = 4.0;
        let quantized = quantize_knowledge_embedding(vector).unwrap();
        assert_eq!(quantized.len(), KNOWLEDGE_EMBEDDING_DIMENSIONS);
        assert_eq!(quantized[0], 76);
        assert_eq!(quantized[1], 102);
        assert_eq!(knowledge_embedding_to_hnsw(&quantized)[0], 204);
    }

    #[test]
    fn embedding_queue_is_single_flight_and_can_pause_before_start() {
        let (root, db_path, project_id) = fixture();
        let (first, first_started) = queue_knowledge_embeddings(&db_path, &project_id).unwrap();
        let (_, second_started) = queue_knowledge_embeddings(&db_path, &project_id).unwrap();
        assert!(first_started);
        assert!(!second_started);
        assert_eq!(first.state, "queued");
        let paused = pause_knowledge_embeddings(&db_path, &project_id).unwrap();
        assert_eq!(paused.state, "paused");
        let (_, resumed) = queue_knowledge_embeddings(&db_path, &project_id).unwrap();
        assert!(resumed);
        let _ = fs::remove_dir_all(root);
    }
}
