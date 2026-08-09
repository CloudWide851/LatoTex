use crate::models::AgentResourceLock;

const RESEARCH_LOCK_TTL_SECONDS: i64 = 90;

fn research_lock_expiry() -> String {
    (Utc::now() + chrono::Duration::seconds(RESEARCH_LOCK_TTL_SECONDS)).to_rfc3339()
}

fn cleanup_expired_research_resource_locks_in(conn: &Connection) -> Result<usize, String> {
    conn.execute(
        "DELETE FROM research_resource_locks WHERE expires_at <= ?1",
        params![now_iso()],
    )
    .map_err(|_| "research.lock.cleanup_failed".to_string())
}

pub fn cleanup_expired_research_resource_locks(
    db_path: &Path,
    project_id: &str,
) -> Result<usize, String> {
    let conn = open_research_database(db_path, project_id)?;
    cleanup_expired_research_resource_locks_in(&conn)
}

pub fn acquire_research_resource_lock(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    resource_path: &str,
    mode: &str,
) -> Result<AgentResourceLock, String> {
    validate_research_id(run_id)?;
    if !matches!(mode, "read" | "write") {
        return Err("research.lock.mode_invalid".to_string());
    }
    let normalized = normalize_workspace_path(resource_path)?
        .to_string_lossy()
        .replace('\\', "/");
    let mut conn = open_research_database(db_path, project_id)?;
    let transaction = conn
        .transaction()
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    cleanup_expired_research_resource_locks_in(&transaction)?;
    let conflicts: bool = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM research_resource_locks
                WHERE resource_path = ?1 AND run_id != ?2 AND (mode = 'write' OR ?3 = 'write')
            )",
            params![normalized, run_id, mode],
            |row| row.get(0),
        )
        .map_err(|_| "research.lock.query_failed".to_string())?;
    if conflicts {
        return Err("research.lock.conflict".to_string());
    }
    let heartbeat_at = now_iso();
    let expires_at = research_lock_expiry();
    let lock_id = format!("lock-{}", Uuid::new_v4().simple());
    transaction
        .execute(
            "INSERT INTO research_resource_locks
             (lock_id, resource_path, mode, run_id, heartbeat_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(run_id, resource_path) DO UPDATE SET
                lock_id = excluded.lock_id,
                mode = excluded.mode,
                heartbeat_at = excluded.heartbeat_at,
                expires_at = excluded.expires_at",
            params![lock_id, normalized, mode, run_id, heartbeat_at, expires_at],
        )
        .map_err(|_| "research.lock.write_failed".to_string())?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    Ok(AgentResourceLock {
        lock_id,
        project_id: project_id.to_string(),
        resource_path: normalized,
        mode: mode.to_string(),
        run_id: run_id.to_string(),
        heartbeat_at,
        expires_at,
    })
}

pub fn heartbeat_research_resource_locks(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
) -> Result<usize, String> {
    let conn = open_research_database(db_path, project_id)?;
    cleanup_expired_research_resource_locks_in(&conn)?;
    conn.execute(
        "UPDATE research_resource_locks SET heartbeat_at = ?1, expires_at = ?2 WHERE run_id = ?3",
        params![now_iso(), research_lock_expiry(), run_id],
    )
    .map_err(|_| "research.lock.write_failed".to_string())
}

pub fn release_research_resource_locks(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
) -> Result<usize, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.execute(
        "DELETE FROM research_resource_locks WHERE run_id = ?1",
        params![run_id],
    )
    .map_err(|_| "research.lock.release_failed".to_string())
}

pub fn list_research_resource_locks(
    db_path: &Path,
    project_id: &str,
) -> Result<Vec<AgentResourceLock>, String> {
    let conn = open_research_database(db_path, project_id)?;
    cleanup_expired_research_resource_locks_in(&conn)?;
    let mut statement = conn
        .prepare(
            "SELECT lock_id, resource_path, mode, run_id, heartbeat_at, expires_at
             FROM research_resource_locks ORDER BY heartbeat_at DESC",
        )
        .map_err(|_| "research.lock.query_failed".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok(AgentResourceLock {
                lock_id: row.get(0)?,
                project_id: project_id.to_string(),
                resource_path: row.get(1)?,
                mode: row.get(2)?,
                run_id: row.get(3)?,
                heartbeat_at: row.get(4)?,
                expires_at: row.get(5)?,
            })
        })
        .map_err(|_| "research.lock.query_failed".to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|_| "research.lock.query_failed".to_string())
}
