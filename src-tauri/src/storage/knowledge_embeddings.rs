const KNOWLEDGE_EMBEDDING_DIMENSIONS: usize = 384;
const KNOWLEDGE_EMBEDDING_MAX_TOKENS: usize = 512;

type KnowledgeRunnableModel =
    tract_onnx::prelude::TypedRunnableModel<tract_onnx::prelude::TypedModel>;

struct KnowledgeEmbeddingRunner {
    tokenizer: tokenizers::Tokenizer,
    model: KnowledgeRunnableModel,
    input_names: Vec<String>,
    input_types: Vec<tract_onnx::prelude::DatumType>,
}

struct KnowledgeEmbeddingRunnerCache {
    model_path: PathBuf,
    tokenizer_path: PathBuf,
    runner: KnowledgeEmbeddingRunner,
}

static KNOWLEDGE_EMBEDDING_RUNNER: std::sync::OnceLock<
    std::sync::Mutex<Option<KnowledgeEmbeddingRunnerCache>>,
> = std::sync::OnceLock::new();

fn knowledge_embedding_error() -> String {
    "knowledge.embedding.runtime_failed".to_string()
}

impl KnowledgeEmbeddingRunner {
    fn load(model_path: &Path, tokenizer_path: &Path) -> Result<Self, String> {
        use tract_onnx::prelude::Framework;
        use tract_onnx::prelude::InferenceModelExt;

        let mut tokenizer = tokenizers::Tokenizer::from_file(tokenizer_path)
            .map_err(|_| knowledge_embedding_error())?;
        tokenizer
            .with_truncation(Some(tokenizers::TruncationParams {
                max_length: KNOWLEDGE_EMBEDDING_MAX_TOKENS,
                ..Default::default()
            }))
            .map_err(|_| knowledge_embedding_error())?;
        tokenizer.with_padding(Some(tokenizers::PaddingParams {
            strategy: tokenizers::PaddingStrategy::BatchLongest,
            ..Default::default()
        }));

        let model = tract_onnx::onnx()
            .model_for_path(model_path)
            .map_err(|_| knowledge_embedding_error())?
            .into_optimized()
            .map_err(|_| knowledge_embedding_error())?;
        let input_outlets = model
            .input_outlets()
            .map_err(|_| knowledge_embedding_error())?
            .to_vec();
        let mut input_names = Vec::with_capacity(input_outlets.len());
        let mut input_types = Vec::with_capacity(input_outlets.len());
        for outlet in input_outlets {
            input_names.push(model.node(outlet.node).name.clone());
            input_types.push(
                model
                    .outlet_fact(outlet)
                    .map_err(|_| knowledge_embedding_error())?
                    .datum_type,
            );
        }
        let model = model
            .into_runnable()
            .map_err(|_| knowledge_embedding_error())?;
        Ok(Self {
            tokenizer,
            model,
            input_names,
            input_types,
        })
    }

    fn encode_batch(&self, texts: &[String], query: bool) -> Result<Vec<Vec<i8>>, String> {
        use tract_onnx::prelude::{DatumType, IntoTValue, TValue, TVec, Tensor};

        if texts.is_empty() {
            return Ok(Vec::new());
        }
        let prefix = if query { "query: " } else { "passage: " };
        let prepared = texts
            .iter()
            .map(|text| format!("{prefix}{}", text.trim()))
            .collect::<Vec<_>>();
        let encodings = self
            .tokenizer
            .encode_batch(prepared, true)
            .map_err(|_| knowledge_embedding_error())?;
        let batch = encodings.len();
        let sequence = encodings
            .first()
            .map(|encoding| encoding.get_ids().len())
            .ok_or_else(knowledge_embedding_error)?;
        if sequence == 0
            || encodings
                .iter()
                .any(|encoding| encoding.get_ids().len() != sequence)
        {
            return Err(knowledge_embedding_error());
        }
        let mut ids = Vec::with_capacity(batch * sequence);
        let mut masks = Vec::with_capacity(batch * sequence);
        let mut token_types = Vec::with_capacity(batch * sequence);
        for encoding in &encodings {
            ids.extend(encoding.get_ids().iter().map(|value| *value as i64));
            masks.extend(
                encoding
                    .get_attention_mask()
                    .iter()
                    .map(|value| *value as i64),
            );
            token_types.extend(encoding.get_type_ids().iter().map(|value| *value as i64));
        }
        let mut inputs = TVec::<TValue>::new();
        for (name, datum_type) in self.input_names.iter().zip(&self.input_types) {
            let values = if name.contains("attention_mask") {
                &masks
            } else if name.contains("token_type") {
                &token_types
            } else if name.contains("input_ids") {
                &ids
            } else {
                return Err("knowledge.embedding.model_unsupported".to_string());
            };
            let tensor = match *datum_type {
                DatumType::I64 => Tensor::from_shape(&[batch, sequence], values)
                    .map_err(|_| knowledge_embedding_error())?,
                DatumType::I32 => {
                    let values = values.iter().map(|value| *value as i32).collect::<Vec<_>>();
                    Tensor::from_shape(&[batch, sequence], &values)
                        .map_err(|_| knowledge_embedding_error())?
                }
                _ => return Err("knowledge.embedding.model_unsupported".to_string()),
            };
            inputs.push(tensor.into_tvalue());
        }
        let outputs = self
            .model
            .run(inputs)
            .map_err(|_| knowledge_embedding_error())?;
        let output = outputs
            .first()
            .ok_or_else(knowledge_embedding_error)?
            .to_array_view::<f32>()
            .map_err(|_| knowledge_embedding_error())?;
        let shape = output.shape();
        let pooled = match shape {
            [output_batch, dimensions]
                if *output_batch == batch && *dimensions == KNOWLEDGE_EMBEDDING_DIMENSIONS =>
            {
                (0..batch)
                    .map(|row| {
                        (0..KNOWLEDGE_EMBEDDING_DIMENSIONS)
                            .map(|column| output[[row, column]])
                            .collect::<Vec<_>>()
                    })
                    .collect::<Vec<_>>()
            }
            [output_batch, output_sequence, dimensions]
                if *output_batch == batch
                    && *output_sequence == sequence
                    && *dimensions == KNOWLEDGE_EMBEDDING_DIMENSIONS =>
            {
                let mut pooled = Vec::with_capacity(batch);
                for row in 0..batch {
                    let mut vector = vec![0.0_f32; KNOWLEDGE_EMBEDDING_DIMENSIONS];
                    let mut count = 0.0_f32;
                    for token in 0..sequence {
                        if masks[row * sequence + token] == 0 {
                            continue;
                        }
                        count += 1.0;
                        for dimension in 0..KNOWLEDGE_EMBEDDING_DIMENSIONS {
                            vector[dimension] += output[[row, token, dimension]];
                        }
                    }
                    if count == 0.0 {
                        return Err(knowledge_embedding_error());
                    }
                    for value in &mut vector {
                        *value /= count;
                    }
                    pooled.push(vector);
                }
                pooled
            }
            _ => return Err("knowledge.embedding.model_unsupported".to_string()),
        };
        pooled
            .into_iter()
            .map(quantize_knowledge_embedding)
            .collect()
    }
}

fn quantize_knowledge_embedding(mut vector: Vec<f32>) -> Result<Vec<i8>, String> {
    if vector.len() != KNOWLEDGE_EMBEDDING_DIMENSIONS
        || vector.iter().any(|value| !value.is_finite())
    {
        return Err(knowledge_embedding_error());
    }
    let norm = vector.iter().map(|value| value * value).sum::<f32>().sqrt();
    if norm <= f32::EPSILON {
        return Err(knowledge_embedding_error());
    }
    for value in &mut vector {
        *value /= norm;
    }
    Ok(vector
        .into_iter()
        .map(|value| (value * 127.0).round().clamp(-127.0, 127.0) as i8)
        .collect())
}

fn embed_knowledge_texts(
    model_path: &Path,
    tokenizer_path: &Path,
    texts: &[String],
    query: bool,
) -> Result<Vec<Vec<i8>>, String> {
    let cache = KNOWLEDGE_EMBEDDING_RUNNER.get_or_init(|| std::sync::Mutex::new(None));
    let mut guard = cache.lock().map_err(|_| knowledge_embedding_error())?;
    let should_reload = guard
        .as_ref()
        .map(|cached| cached.model_path != model_path || cached.tokenizer_path != tokenizer_path)
        .unwrap_or(true);
    if should_reload {
        *guard = Some(KnowledgeEmbeddingRunnerCache {
            model_path: model_path.to_path_buf(),
            tokenizer_path: tokenizer_path.to_path_buf(),
            runner: KnowledgeEmbeddingRunner::load(model_path, tokenizer_path)?,
        });
    }
    guard
        .as_ref()
        .ok_or_else(knowledge_embedding_error)?
        .runner
        .encode_batch(texts, query)
}

fn knowledge_embedding_to_hnsw(vector: &[i8]) -> Vec<u8> {
    vector
        .iter()
        .map(|value| (*value as i16 + 128) as u8)
        .collect()
}

fn knowledge_embedding_model_paths(runtime_root: &Path) -> Result<(PathBuf, PathBuf), String> {
    let model_path = crate::commands::runtime_assets::find_runtime_asset_entry(
        runtime_root,
        "knowledge-embedding-model",
    )
    .ok_or_else(|| "knowledge.embedding.model_missing".to_string())?;
    let tokenizer_path = model_path
        .parent()
        .map(|parent| {
            parent.join(crate::commands::plugins_trusted_recipes::KNOWLEDGE_TOKENIZER_ENTRY)
        })
        .ok_or_else(|| "knowledge.embedding.model_missing".to_string())?;
    let model_size = fs::metadata(&model_path)
        .map_err(|_| "knowledge.embedding.model_missing".to_string())?
        .len();
    let tokenizer_size = fs::metadata(&tokenizer_path)
        .map_err(|_| "knowledge.embedding.model_missing".to_string())?
        .len();
    if model_size != crate::commands::plugins_trusted_recipes::KNOWLEDGE_EMBEDDING_SIZE
        || tokenizer_size != crate::commands::plugins_trusted_recipes::KNOWLEDGE_TOKENIZER_SIZE
    {
        return Err("knowledge.embedding.integrity_failed".to_string());
    }
    Ok((model_path, tokenizer_path))
}

fn knowledge_embedding_generation(conn: &Connection) -> Result<(String, u64), String> {
    let mut digest = ring::digest::Context::new(&ring::digest::SHA256);
    digest.update(KNOWLEDGE_EMBEDDING_FINGERPRINT.as_bytes());
    let mut total = 0_u64;
    let mut stmt = conn
        .prepare("SELECT evidence_id, text FROM knowledge_chunks ORDER BY evidence_id")
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    for row in rows {
        let (evidence_id, text) =
            row.map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        digest.update(evidence_id.as_bytes());
        digest.update(&[0]);
        digest.update(text.as_bytes());
        digest.update(&[0xff]);
        total = total.saturating_add(1);
    }
    let generation = digest
        .finish()
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect();
    Ok((generation, total))
}

pub fn invalidate_knowledge_embeddings(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "DELETE FROM knowledge_meta
         WHERE meta_key IN ('embedding_fingerprint', 'embedding_generation')",
        [],
    )
    .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    Ok(())
}

fn knowledge_embedding_pause_requested(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT pause_requested FROM knowledge_embedding_jobs WHERE job_id = 1",
        [],
        |row| row.get::<_, i64>(0),
    )
    .optional()
    .map_err(|_| "knowledge.embedding.index_failed".to_string())
    .map(|value| value.unwrap_or_default() != 0)
}

fn write_knowledge_hnsw(
    project_root: &Path,
    hnsw: &hnsw_rs::prelude::Hnsw<'static, u8, hnsw_rs::prelude::DistL2>,
) -> Result<(), String> {
    use hnsw_rs::prelude::AnnT;

    let index_dir = ensure_mutation_path(project_root, ".latotex/index")?;
    fs::create_dir_all(&index_dir).map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    let temporary_base = format!(".knowledge-vectors-{}", Uuid::new_v4().simple());
    let dumped_base = hnsw
        .file_dump(&index_dir, &temporary_base)
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    let temporary_graph = index_dir.join(format!("{dumped_base}.hnsw.graph"));
    let temporary_data = index_dir.join(format!("{dumped_base}.hnsw.data"));
    let target_graph = index_dir.join("knowledge-vectors.hnsw.graph");
    let target_data = index_dir.join("knowledge-vectors.hnsw.data");
    let replace_result = (|| {
        for path in [&temporary_graph, &temporary_data] {
            fs::OpenOptions::new()
                .read(true)
                .write(true)
                .open(path)
                .and_then(|file| file.sync_all())
                .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        }
        atomic_replace_file(&temporary_graph, &target_graph)
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        atomic_replace_file(&temporary_data, &target_data)
            .map_err(|_| "knowledge.embedding.index_failed".to_string())
    })();
    if replace_result.is_err() {
        let _ = fs::remove_file(temporary_graph);
        let _ = fs::remove_file(temporary_data);
    }
    replace_result
}

fn rebuild_knowledge_embeddings_inner(
    project_root: &Path,
    runtime_root: &Path,
) -> Result<crate::models::KnowledgeEmbeddingJobStatus, String> {
    use hnsw_rs::prelude::{DistL2, Hnsw};

    let (model_path, tokenizer_path) = knowledge_embedding_model_paths(runtime_root)?;
    let mut conn = open_knowledge_index(project_root)?;
    let (generation, total) = knowledge_embedding_generation(&conn)?;
    let paused = conn
        .query_row(
            "SELECT state = 'paused' OR pause_requested != 0
             FROM knowledge_embedding_jobs WHERE job_id = 1",
            [],
            |row| row.get::<_, bool>(0),
        )
        .optional()
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?
        .unwrap_or(false);
    if paused {
        return knowledge_embedding_job_status_for_root(&conn);
    }
    let existing_generation = conn
        .query_row(
            "SELECT generation FROM knowledge_embedding_jobs WHERE job_id = 1",
            [],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    if existing_generation.as_deref() != Some(generation.as_str()) {
        conn.execute("DELETE FROM knowledge_vectors_build", [])
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    }
    invalidate_knowledge_embeddings(&conn)?;
    let processed = conn
        .query_row("SELECT count(*) FROM knowledge_vectors_build", [], |row| {
            row.get::<_, i64>(0)
        })
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?
        .max(0) as u64;
    conn.execute(
        "INSERT INTO knowledge_embedding_jobs
         (job_id, state, generation, processed, total, pause_requested, failure_code, updated_at)
         VALUES (1, 'indexing', ?1, ?2, ?3, 0, NULL, ?4)
         ON CONFLICT(job_id) DO UPDATE SET
           state='indexing', generation=excluded.generation, processed=excluded.processed,
           total=excluded.total, pause_requested=0, failure_code=NULL,
           updated_at=excluded.updated_at",
        params![generation, processed as i64, total as i64, now_iso()],
    )
    .map_err(|_| "knowledge.embedding.index_failed".to_string())?;

    let hnsw = Hnsw::new(24, total.max(1) as usize, 16, 200, DistL2 {});
    {
        let mut stmt = conn
            .prepare("SELECT vector_id, embedding FROM knowledge_vectors_build ORDER BY vector_id")
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        let rows = stmt
            .query_map([], |row| {
                Ok((row.get::<_, i64>(0)?, row.get::<_, Vec<u8>>(1)?))
            })
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        for row in rows {
            let (vector_id, bytes) =
                row.map_err(|_| "knowledge.embedding.index_failed".to_string())?;
            let vector = bytes
                .iter()
                .map(|byte| (*byte as i8 as i16 + 128) as u8)
                .collect::<Vec<_>>();
            if vector.len() != KNOWLEDGE_EMBEDDING_DIMENSIONS {
                return Err("knowledge.embedding.index_corrupt".to_string());
            }
            hnsw.insert((&vector, vector_id.max(0) as usize));
        }
    }
    let mut next_vector_id = conn
        .query_row(
            "SELECT COALESCE(max(vector_id), -1) + 1 FROM knowledge_vectors_build",
            [],
            |row| row.get::<_, i64>(0),
        )
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    loop {
        if knowledge_embedding_pause_requested(&conn)? {
            conn.execute(
                "UPDATE knowledge_embedding_jobs
                 SET state='paused', updated_at=?1 WHERE job_id=1",
                params![now_iso()],
            )
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
            return knowledge_embedding_job_status_for_root(&conn);
        }
        let batch = {
            let mut stmt = conn
                .prepare(
                    "SELECT c.evidence_id, c.text
                     FROM knowledge_chunks c
                     LEFT JOIN knowledge_vectors_build v ON v.evidence_id = c.evidence_id
                     WHERE v.evidence_id IS NULL
                     ORDER BY c.evidence_id LIMIT 16",
                )
                .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
            let rows = stmt
                .query_map([], |row| {
                    Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
                })
                .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
            rows.collect::<Result<Vec<_>, _>>()
                .map_err(|_| "knowledge.embedding.index_failed".to_string())?
        };
        if batch.is_empty() {
            break;
        }
        let texts = batch
            .iter()
            .map(|(_, text)| text.clone())
            .collect::<Vec<_>>();
        let vectors = embed_knowledge_texts(&model_path, &tokenizer_path, &texts, false)?;
        let tx = conn
            .transaction()
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        for ((evidence_id, _), vector) in batch.iter().zip(&vectors) {
            tx.execute(
                "INSERT INTO knowledge_vectors_build (vector_id, evidence_id, embedding)
                 VALUES (?1, ?2, ?3)",
                params![
                    next_vector_id,
                    evidence_id,
                    vector.iter().map(|value| *value as u8).collect::<Vec<_>>()
                ],
            )
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
            hnsw.insert((
                &knowledge_embedding_to_hnsw(vector),
                next_vector_id.max(0) as usize,
            ));
            next_vector_id += 1;
        }
        tx.execute(
            "UPDATE knowledge_embedding_jobs SET processed=?1, updated_at=?2 WHERE job_id=1",
            params![next_vector_id, now_iso()],
        )
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
        tx.commit()
            .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    }
    write_knowledge_hnsw(project_root, &hnsw)?;
    let tx = conn
        .transaction()
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    tx.execute("DELETE FROM knowledge_vectors", [])
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    tx.execute(
        "INSERT INTO knowledge_vectors (vector_id, evidence_id, embedding)
         SELECT vector_id, evidence_id, embedding
         FROM knowledge_vectors_build ORDER BY vector_id",
        [],
    )
    .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    tx.execute("DELETE FROM knowledge_vectors_build", [])
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    for (key, value) in [
        ("embedding_fingerprint", KNOWLEDGE_EMBEDDING_FINGERPRINT),
        ("embedding_generation", generation.as_str()),
    ] {
        tx.execute(
            "INSERT INTO knowledge_meta (meta_key, meta_value, updated_at)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(meta_key) DO UPDATE SET
               meta_value=excluded.meta_value, updated_at=excluded.updated_at",
            params![key, value, now_iso()],
        )
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    }
    tx.execute(
        "UPDATE knowledge_embedding_jobs SET
           state='ready', processed=total, pause_requested=0,
           failure_code=NULL, updated_at=?1 WHERE job_id=1",
        params![now_iso()],
    )
    .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    tx.commit()
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?;
    knowledge_embedding_job_status_for_root(&conn)
}

fn knowledge_embedding_job_status_for_root(
    conn: &Connection,
) -> Result<crate::models::KnowledgeEmbeddingJobStatus, String> {
    conn.query_row(
        "SELECT state, processed, total, generation, failure_code
         FROM knowledge_embedding_jobs WHERE job_id=1",
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
    .map_err(|_| "knowledge.embedding.index_failed".to_string())
}

pub fn rebuild_knowledge_embeddings(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
) -> Result<crate::models::KnowledgeEmbeddingJobStatus, String> {
    let project_root = load_project_root(db_path, project_id)?;
    match rebuild_knowledge_embeddings_inner(&project_root, runtime_root) {
        Ok(status) => Ok(status),
        Err(error) => {
            if let Ok(conn) = open_knowledge_index(&project_root) {
                let _ = conn.execute(
                    "INSERT INTO knowledge_embedding_jobs
                     (job_id, state, generation, processed, total, pause_requested,
                      failure_code, updated_at)
                     VALUES (1, 'failed', '', 0, 0, 0, ?1, ?2)
                     ON CONFLICT(job_id) DO UPDATE SET
                       state='failed', pause_requested=0, failure_code=excluded.failure_code,
                       updated_at=excluded.updated_at",
                    params![error, now_iso()],
                );
            }
            Err(error)
        }
    }
}
