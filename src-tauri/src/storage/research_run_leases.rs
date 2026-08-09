const RESEARCH_RUN_LEASE_TTL_SECONDS: i64 = 90;

fn research_run_lease_expiry() -> String {
    (Utc::now() + chrono::Duration::seconds(RESEARCH_RUN_LEASE_TTL_SECONDS)).to_rfc3339()
}

pub fn cleanup_expired_research_run_leases(
    db_path: &Path,
    project_id: &str,
) -> Result<usize, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.execute(
        "DELETE FROM research_run_leases WHERE expires_at <= ?1",
        params![now_iso()],
    )
    .map_err(|_| "research.run.lease_cleanup_failed".to_string())
}

pub fn claim_research_run_lease(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    owner_id: &str,
) -> Result<Option<String>, String> {
    validate_research_id(run_id)?;
    validate_research_id(owner_id)?;
    let mut conn = open_research_database(db_path, project_id)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    transaction
        .execute(
            "DELETE FROM research_run_leases WHERE expires_at <= ?1",
            params![now_iso()],
        )
        .map_err(|_| "research.run.lease_cleanup_failed".to_string())?;
    let terminal: bool = transaction
        .query_row(
            "SELECT status IN ('completed', 'failed', 'cancelled') FROM research_runs WHERE run_id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.run.not_found".to_string())?;
    if terminal {
        return Err("research.run.terminal".to_string());
    }
    let token = format!("lease-{}", Uuid::new_v4().simple());
    let now = now_iso();
    let changed = transaction
        .execute(
            "INSERT OR IGNORE INTO research_run_leases
             (run_id, owner_id, lease_token, claimed_at, heartbeat_at, expires_at)
             VALUES (?1, ?2, ?3, ?4, ?4, ?5)",
            params![run_id, owner_id, token, now, research_run_lease_expiry()],
        )
        .map_err(|_| "research.run.lease_claim_failed".to_string())?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    Ok((changed == 1).then_some(token))
}

pub fn heartbeat_research_run_lease(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    owner_id: &str,
    lease_token: &str,
) -> Result<(), String> {
    let conn = open_research_database(db_path, project_id)?;
    let now = now_iso();
    let changed = conn
        .execute(
            "UPDATE research_run_leases SET heartbeat_at = ?1, expires_at = ?2
             WHERE run_id = ?3 AND owner_id = ?4 AND lease_token = ?5 AND expires_at > ?1",
            params![
                now,
                research_run_lease_expiry(),
                run_id,
                owner_id,
                lease_token
            ],
        )
        .map_err(|_| "research.run.lease_heartbeat_failed".to_string())?;
    if changed != 1 {
        return Err("research.run.lease_lost".to_string());
    }
    Ok(())
}

pub fn verify_research_run_lease(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    owner_id: &str,
    lease_token: &str,
) -> Result<(), String> {
    let conn = open_research_database(db_path, project_id)?;
    let owned: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM research_run_leases
             WHERE run_id = ?1 AND owner_id = ?2 AND lease_token = ?3 AND expires_at > ?4)",
            params![run_id, owner_id, lease_token, now_iso()],
            |row| row.get(0),
        )
        .map_err(|_| "research.run.lease_query_failed".to_string())?;
    if !owned {
        return Err("research.run.lease_lost".to_string());
    }
    Ok(())
}

pub fn research_run_has_active_lease(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
) -> Result<bool, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM research_run_leases
         WHERE run_id = ?1 AND expires_at > ?2)",
        params![run_id, now_iso()],
        |row| row.get(0),
    )
    .map_err(|_| "research.run.lease_query_failed".to_string())
}

pub fn release_research_run_lease(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    owner_id: &str,
    lease_token: &str,
) -> Result<usize, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.execute(
        "DELETE FROM research_run_leases
         WHERE run_id = ?1 AND owner_id = ?2 AND lease_token = ?3",
        params![run_id, owner_id, lease_token],
    )
    .map_err(|_| "research.run.lease_release_failed".to_string())
}

pub fn cancel_research_run_lease(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
) -> Result<usize, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.execute(
        "DELETE FROM research_run_leases WHERE run_id = ?1",
        params![run_id],
    )
    .map_err(|_| "research.run.lease_release_failed".to_string())
}
