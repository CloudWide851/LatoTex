#[derive(Debug, Clone)]
pub struct AgentRunRecord {
    pub run_id: String,
    pub project_id: String,
    pub workflow_id: String,
    pub callsite: String,
    pub request_json: String,
    pub status: String,
    pub recovered_count: i64,
}

pub fn insert_agent_run(
    db_path: &Path,
    run_id: &str,
    request: &crate::models::AgentExecuteRequest,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let now = now_iso();
    let request_json = serde_json::to_string(request).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agent_runs (
            run_id, project_id, workflow_id, callsite, request_json, status,
            lease_id, recovered_count, created_at, updated_at, started_at, finished_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, 'accepted', NULL, 0, ?6, ?6, NULL, NULL)
         ON CONFLICT(run_id) DO UPDATE SET
            request_json = excluded.request_json,
            status = excluded.status,
            updated_at = excluded.updated_at,
            finished_at = NULL",
        params![
            run_id,
            request.project_id,
            request.workflow_id,
            request.callsite,
            request_json,
            now,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn update_agent_run_status(
    db_path: &Path,
    run_id: &str,
    status: &str,
    lease_id: Option<&str>,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let now = now_iso();
    let terminal = matches!(status, "completed" | "failed" | "cancelled");
    conn.execute(
        "UPDATE agent_runs
         SET status = ?2,
             lease_id = ?3,
             updated_at = ?4,
             started_at = CASE WHEN started_at IS NULL AND ?2 = 'running' THEN ?4 ELSE started_at END,
             finished_at = CASE WHEN ?5 THEN ?4 ELSE finished_at END
         WHERE run_id = ?1",
        params![run_id, status, lease_id, now, terminal],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn mark_agent_run_recovering(
    db_path: &Path,
    run_id: &str,
    lease_id: &str,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let now = now_iso();
    conn.execute(
        "UPDATE agent_runs
         SET status = 'recovering',
             lease_id = ?2,
             recovered_count = recovered_count + 1,
             updated_at = ?3
         WHERE run_id = ?1",
        params![run_id, lease_id, now],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn list_recoverable_agent_runs(
    db_path: &Path,
    project_id: Option<&str>,
) -> Result<Vec<AgentRunRecord>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut sql = String::from(
        "SELECT run_id, project_id, workflow_id, callsite, request_json, status, recovered_count
         FROM agent_runs
         WHERE status IN ('accepted', 'running', 'recovering')",
    );
    let mut values: Vec<rusqlite::types::Value> = Vec::new();
    if let Some(project_id) = project_id.map(str::trim).filter(|value| !value.is_empty()) {
        sql.push_str(" AND project_id = ?1");
        values.push(project_id.to_string().into());
    }
    sql.push_str(" ORDER BY updated_at ASC LIMIT 24");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values.iter()), |row| {
            Ok(AgentRunRecord {
                run_id: row.get(0)?,
                project_id: row.get(1)?,
                workflow_id: row.get(2)?,
                callsite: row.get(3)?,
                request_json: row.get(4)?,
                status: row.get(5)?,
                recovered_count: row.get(6)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut out = Vec::new();
    for row in rows {
        out.push(row.map_err(|e| e.to_string())?);
    }
    Ok(out)
}

pub fn agent_run_has_terminal_event(db_path: &Path, run_id: &str) -> Result<bool, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let found = conn
        .query_row(
            "SELECT 1 FROM swarm_events
             WHERE run_id = ?1 AND kind IN ('agent.run.completed', 'agent.run.failed', 'agent.run.cancelled')
             LIMIT 1",
            params![run_id],
            |_| Ok(true),
        )
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(false);
    Ok(found)
}
