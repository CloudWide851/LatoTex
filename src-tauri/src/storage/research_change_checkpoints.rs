use crate::models::{
    ResearchChangeCheckpoint, ResearchChangeCheckpointUndoResult, ResearchChangeConflict,
};

struct StoredResearchCheckpoint {
    checkpoint: ResearchChangeCheckpoint,
    old_content_envelope: String,
    applied_content_envelope: Option<String>,
    patch_envelope: Option<String>,
}

fn research_content_hash(content: &str) -> String {
    ring::digest::digest(&ring::digest::SHA256, content.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_latex_checkpoint_path(path: &str) -> Result<String, String> {
    let normalized = normalize_workspace_path(path)?
        .to_string_lossy()
        .replace('\\', "/");
    let extension = Path::new(&normalized)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "tex" | "bib" | "sty" | "cls" | "bst") {
        return Err("research.checkpoint.latex_path_required".to_string());
    }
    Ok(normalized)
}

fn checkpoint_from_row(
    row: &rusqlite::Row<'_>,
    project_id: &str,
) -> rusqlite::Result<StoredResearchCheckpoint> {
    Ok(StoredResearchCheckpoint {
        checkpoint: ResearchChangeCheckpoint {
            checkpoint_id: row.get(0)?,
            project_id: project_id.to_string(),
            run_id: row.get(1)?,
            step_id: row.get(2)?,
            relative_path: row.get(3)?,
            before_hash: row.get(4)?,
            after_hash: row.get(5)?,
            status: row.get(9)?,
            created_at: row.get(10)?,
            applied_at: row.get(11)?,
            undone_at: row.get(12)?,
        },
        old_content_envelope: row.get(6)?,
        applied_content_envelope: row.get(7)?,
        patch_envelope: row.get(8)?,
    })
}

fn load_research_change_checkpoint(
    conn: &Connection,
    project_id: &str,
    checkpoint_id: &str,
) -> Result<StoredResearchCheckpoint, String> {
    conn.query_row(
        "SELECT checkpoint_id, run_id, step_id, relative_path, before_hash, after_hash,
                old_content_envelope, applied_content_envelope, patch_envelope, status,
                created_at, applied_at, undone_at
         FROM research_change_checkpoints WHERE checkpoint_id = ?1",
        params![checkpoint_id],
        |row| checkpoint_from_row(row, project_id),
    )
    .map_err(|_| "research.checkpoint.not_found".to_string())
}

pub fn prepare_research_change_checkpoint(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
    relative_path: &str,
) -> Result<ResearchChangeCheckpoint, String> {
    validate_research_id(run_id)?;
    validate_research_id(step_id)?;
    let relative_path = normalize_latex_checkpoint_path(relative_path)?;
    let current = read_project_file(db_path, project_id, &relative_path)?;
    let conn = open_research_database(db_path, project_id)?;
    if let Some(existing) = conn
        .query_row(
            "SELECT checkpoint_id, run_id, step_id, relative_path, before_hash, after_hash,
                    old_content_envelope, applied_content_envelope, patch_envelope, status,
                    created_at, applied_at, undone_at
             FROM research_change_checkpoints WHERE run_id = ?1 AND step_id = ?2",
            params![run_id, step_id],
            |row| checkpoint_from_row(row, project_id),
        )
        .optional()
        .map_err(|_| "research.checkpoint.query_failed".to_string())?
    {
        if existing.checkpoint.relative_path != relative_path {
            return Err("research.checkpoint.path_mismatch".to_string());
        }
        return Ok(existing.checkpoint);
    }
    let checkpoint_id = format!("checkpoint-{}", Uuid::new_v4().simple());
    let before_hash = research_content_hash(&current.content);
    let old_content_envelope = seal_research_json(
        runtime_root,
        project_id,
        "checkpoint",
        &checkpoint_id,
        "old-content",
        &current.content,
    )?;
    let created_at = now_iso();
    conn.execute(
        "INSERT INTO research_change_checkpoints
         (checkpoint_id, run_id, step_id, relative_path, before_hash, old_content_envelope,
          status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', ?7)",
        params![
            checkpoint_id,
            run_id,
            step_id,
            relative_path,
            before_hash,
            old_content_envelope,
            created_at,
        ],
    )
    .map_err(|_| "research.checkpoint.write_failed".to_string())?;
    Ok(ResearchChangeCheckpoint {
        checkpoint_id,
        project_id: project_id.to_string(),
        run_id: run_id.to_string(),
        step_id: step_id.to_string(),
        relative_path,
        before_hash,
        after_hash: None,
        status: "pending".to_string(),
        created_at,
        applied_at: None,
        undone_at: None,
    })
}

pub fn finalize_research_change_checkpoint(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
) -> Result<ResearchChangeCheckpoint, String> {
    let conn = open_research_database(db_path, project_id)?;
    let stored = conn
        .query_row(
            "SELECT checkpoint_id, run_id, step_id, relative_path, before_hash, after_hash,
                    old_content_envelope, applied_content_envelope, patch_envelope, status,
                    created_at, applied_at, undone_at
             FROM research_change_checkpoints WHERE run_id = ?1 AND step_id = ?2",
            params![run_id, step_id],
            |row| checkpoint_from_row(row, project_id),
        )
        .optional()
        .map_err(|_| "research.checkpoint.query_failed".to_string())?
        .ok_or_else(|| "research.checkpoint.not_found".to_string())?;
    if stored.checkpoint.status == "applied" {
        return Ok(stored.checkpoint);
    }
    if stored.checkpoint.status != "pending" {
        return Err("research.checkpoint.state_invalid".to_string());
    }
    let applied = read_project_file(db_path, project_id, &stored.checkpoint.relative_path)?.content;
    let after_hash = research_content_hash(&applied);
    let applied_content_envelope = seal_research_json(
        runtime_root,
        project_id,
        "checkpoint",
        &stored.checkpoint.checkpoint_id,
        "applied-content",
        &applied,
    )?;
    let patch = json!({
        "kind": "replace",
        "beforeHash": &stored.checkpoint.before_hash,
        "afterHash": &after_hash,
        "afterContent": &applied,
    });
    let patch_envelope = seal_research_json(
        runtime_root,
        project_id,
        "checkpoint",
        &stored.checkpoint.checkpoint_id,
        "patch",
        &patch,
    )?;
    let applied_at = now_iso();
    let changed = conn
        .execute(
            "UPDATE research_change_checkpoints SET after_hash = ?1,
                applied_content_envelope = ?2, patch_envelope = ?3, status = 'applied', applied_at = ?4
             WHERE checkpoint_id = ?5 AND status = 'pending'",
            params![
                after_hash,
                applied_content_envelope,
                patch_envelope,
                applied_at,
                stored.checkpoint.checkpoint_id,
            ],
        )
        .map_err(|_| "research.checkpoint.write_failed".to_string())?;
    if changed != 1 {
        return Err("research.checkpoint.state_changed".to_string());
    }
    Ok(ResearchChangeCheckpoint {
        after_hash: Some(after_hash),
        status: "applied".to_string(),
        applied_at: Some(applied_at),
        ..stored.checkpoint
    })
}

pub fn list_research_change_checkpoints(
    db_path: &Path,
    project_id: &str,
    run_id: Option<&str>,
) -> Result<Vec<ResearchChangeCheckpoint>, String> {
    let conn = open_research_database(db_path, project_id)?;
    let mut statement = conn
        .prepare(
            "SELECT checkpoint_id, run_id, step_id, relative_path, before_hash, after_hash,
                    old_content_envelope, applied_content_envelope, patch_envelope, status,
                    created_at, applied_at, undone_at
             FROM research_change_checkpoints
             WHERE (?1 IS NULL OR run_id = ?1) ORDER BY created_at DESC LIMIT 100",
        )
        .map_err(|_| "research.checkpoint.query_failed".to_string())?;
    let rows = statement
        .query_map(params![run_id], |row| checkpoint_from_row(row, project_id))
        .map_err(|_| "research.checkpoint.query_failed".to_string())?;
    rows.map(|row| {
        row.map(|stored| stored.checkpoint)
            .map_err(|_| "research.checkpoint.query_failed".to_string())
    })
    .collect()
}

pub fn undo_research_change_checkpoint(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    checkpoint_id: &str,
) -> Result<ResearchChangeCheckpointUndoResult, String> {
    validate_research_id(checkpoint_id)?;
    let conn = open_research_database(db_path, project_id)?;
    let stored = load_research_change_checkpoint(&conn, project_id, checkpoint_id)?;
    if !matches!(stored.checkpoint.status.as_str(), "applied" | "conflict") {
        return Err("research.checkpoint.undo_unavailable".to_string());
    }
    let old_content: String = open_research_json(
        runtime_root,
        project_id,
        "checkpoint",
        checkpoint_id,
        "old-content",
        &stored.old_content_envelope,
    )?;
    let applied_content: String = open_research_json(
        runtime_root,
        project_id,
        "checkpoint",
        checkpoint_id,
        "applied-content",
        stored
            .applied_content_envelope
            .as_deref()
            .ok_or_else(|| "research.checkpoint.incomplete".to_string())?,
    )?;
    let patch: Value = open_research_json(
        runtime_root,
        project_id,
        "checkpoint",
        checkpoint_id,
        "patch",
        stored
            .patch_envelope
            .as_deref()
            .ok_or_else(|| "research.checkpoint.incomplete".to_string())?,
    )?;
    let current = read_project_file(db_path, project_id, &stored.checkpoint.relative_path)?.content;
    let after_hash = stored
        .checkpoint
        .after_hash
        .as_deref()
        .ok_or_else(|| "research.checkpoint.incomplete".to_string())?;
    if research_content_hash(&current) != after_hash {
        conn.execute(
            "UPDATE research_change_checkpoints SET status = 'conflict' WHERE checkpoint_id = ?1",
            params![checkpoint_id],
        )
        .map_err(|_| "research.checkpoint.write_failed".to_string())?;
        return Ok(ResearchChangeCheckpointUndoResult {
            checkpoint: ResearchChangeCheckpoint {
                status: "conflict".to_string(),
                ..stored.checkpoint
            },
            outcome: "conflict".to_string(),
            conflict: Some(ResearchChangeConflict {
                base_content: old_content,
                applied_content,
                current_content: current,
                patch,
            }),
        });
    }
    write_project_file(
        db_path,
        FileWriteInput {
            project_id: project_id.to_string(),
            relative_path: stored.checkpoint.relative_path.clone(),
            content: old_content.clone(),
            knowledge_approval_token: None,
        },
    )?;
    let verified =
        read_project_file(db_path, project_id, &stored.checkpoint.relative_path)?.content;
    if research_content_hash(&verified) != stored.checkpoint.before_hash {
        return Err("research.checkpoint.undo_verification_failed".to_string());
    }
    let undone_at = now_iso();
    conn.execute(
        "UPDATE research_change_checkpoints SET status = 'undone', undone_at = ?1
         WHERE checkpoint_id = ?2",
        params![undone_at, checkpoint_id],
    )
    .map_err(|_| "research.checkpoint.write_failed".to_string())?;
    Ok(ResearchChangeCheckpointUndoResult {
        checkpoint: ResearchChangeCheckpoint {
            status: "undone".to_string(),
            undone_at: Some(undone_at),
            ..stored.checkpoint
        },
        outcome: "undone".to_string(),
        conflict: None,
    })
}
