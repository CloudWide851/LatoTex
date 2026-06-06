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
         WHERE run_id = ?1
           AND status NOT IN ('completed', 'failed', 'cancelled')",
        params![run_id, status, lease_id, now, terminal],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn get_agent_run_record(
    db_path: &Path,
    run_id: &str,
) -> Result<Option<AgentRunRecord>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT run_id, project_id, workflow_id, callsite, request_json, status, recovered_count
         FROM agent_runs
         WHERE run_id = ?1
         LIMIT 1",
        params![run_id],
        |row| {
            Ok(AgentRunRecord {
                run_id: row.get(0)?,
                project_id: row.get(1)?,
                workflow_id: row.get(2)?,
                callsite: row.get(3)?,
                request_json: row.get(4)?,
                status: row.get(5)?,
                recovered_count: row.get(6)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn agent_run_status_is_terminal(db_path: &Path, run_id: &str) -> Result<bool, String> {
    let Some(record) = get_agent_run_record(db_path, run_id)? else {
        return Ok(false);
    };
    Ok(matches!(
        record.status.as_str(),
        "completed" | "failed" | "cancelled"
    ))
}

pub fn terminalize_agent_run_if_open(
    db_path: &Path,
    run_id: &str,
    status: &str,
    lease_id: Option<&str>,
) -> Result<bool, String> {
    if !matches!(status, "completed" | "failed" | "cancelled") {
        return Err(format!("agent.run.invalid_terminal_status: {status}"));
    }
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let now = now_iso();
    let changed = conn
        .execute(
            "UPDATE agent_runs
             SET status = ?2,
                 lease_id = ?3,
                 updated_at = ?4,
                 finished_at = ?4
             WHERE run_id = ?1
               AND status NOT IN ('completed', 'failed', 'cancelled')",
            params![run_id, status, lease_id, now],
        )
        .map_err(|e| e.to_string())?;
    Ok(changed > 0)
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

#[cfg(test)]
mod agent_runs_tests {
    use super::*;
    use crate::models::AgentExecuteRequest;

    fn temp_db_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "latotex-agent-runs-{name}-{}.sqlite3",
            uuid::Uuid::new_v4()
        ));
        path
    }

    fn sample_request(project_id: &str) -> AgentExecuteRequest {
        AgentExecuteRequest {
            project_id: project_id.to_string(),
            workflow_id: "analysis.synthesize".to_string(),
            callsite: "analysis.workspace".to_string(),
            prompt: "Analyze".to_string(),
            context_refs: vec![],
            model_override: None,
            bypass_cache: false,
            team_mode: None,
            harness_profile_id: None,
        }
    }

    #[test]
    fn terminalize_agent_run_if_open_does_not_overwrite_terminal_status() {
        let db_path = temp_db_path("terminalize");
        initialize_database(&db_path).unwrap();
        insert_agent_run(&db_path, "run-1", &sample_request("project-1")).unwrap();

        assert!(terminalize_agent_run_if_open(&db_path, "run-1", "cancelled", None).unwrap());
        let record = get_agent_run_record(&db_path, "run-1").unwrap().unwrap();
        assert_eq!(record.status, "cancelled");

        assert!(!terminalize_agent_run_if_open(&db_path, "run-1", "completed", None).unwrap());
        let record = get_agent_run_record(&db_path, "run-1").unwrap().unwrap();
        assert_eq!(record.status, "cancelled");

        let _ = std::fs::remove_file(db_path);
    }

    #[test]
    fn agent_run_status_is_terminal_reads_cancelled_runs() {
        let db_path = temp_db_path("terminal-status");
        initialize_database(&db_path).unwrap();
        insert_agent_run(&db_path, "run-2", &sample_request("project-1")).unwrap();
        assert!(!agent_run_status_is_terminal(&db_path, "run-2").unwrap());

        terminalize_agent_run_if_open(&db_path, "run-2", "cancelled", None).unwrap();
        assert!(agent_run_status_is_terminal(&db_path, "run-2").unwrap());

        let _ = std::fs::remove_file(db_path);
    }
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
