use crate::models::{ResearchAgentRun, ResearchPlanApproval};

const TERMINAL_RESEARCH_RUN_STATUSES: &[&str] = &["completed", "failed", "cancelled"];

fn load_research_run_from_row(
    row: &rusqlite::Row<'_>,
    runtime_root: &Path,
    project_id: &str,
) -> Result<ResearchAgentRun, String> {
    let run_id = row
        .get::<_, String>(0)
        .map_err(|_| "research.run.query_failed".to_string())?;
    let last_operation_envelope = row
        .get::<_, Option<String>>(8)
        .map_err(|_| "research.run.query_failed".to_string())?;
    let last_operation = last_operation_envelope
        .as_deref()
        .map(|value| {
            open_research_json(
                runtime_root,
                project_id,
                "run",
                &run_id,
                "last-operation",
                value,
            )
        })
        .transpose()?;
    Ok(ResearchAgentRun {
        run_id,
        project_id: project_id.to_string(),
        task_id: row
            .get(1)
            .map_err(|_| "research.run.query_failed".to_string())?,
        plan_version: row
            .get(2)
            .map_err(|_| "research.run.query_failed".to_string())?,
        status: row
            .get(3)
            .map_err(|_| "research.run.query_failed".to_string())?,
        current_step_id: row
            .get(4)
            .map_err(|_| "research.run.query_failed".to_string())?,
        completed_steps: row
            .get(5)
            .map_err(|_| "research.run.query_failed".to_string())?,
        total_steps: row
            .get(6)
            .map_err(|_| "research.run.query_failed".to_string())?,
        evidence_count: row
            .get(7)
            .map_err(|_| "research.run.query_failed".to_string())?,
        last_operation,
        diagnostic_code: row
            .get(9)
            .map_err(|_| "research.run.query_failed".to_string())?,
        started_at: row
            .get(10)
            .map_err(|_| "research.run.query_failed".to_string())?,
        updated_at: row
            .get(11)
            .map_err(|_| "research.run.query_failed".to_string())?,
        finished_at: row
            .get(12)
            .map_err(|_| "research.run.query_failed".to_string())?,
    })
}

const RESEARCH_RUN_SELECT: &str =
    "SELECT run_id, task_id, plan_version, status, current_step_id, completed_steps,
            total_steps, evidence_count, last_operation_envelope, diagnostic_code,
            started_at, updated_at, finished_at FROM research_runs";

pub fn create_research_plan_run(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    task_id: &str,
    version: i64,
) -> Result<(ResearchAgentRun, ResearchPlanVersion), String> {
    let mut conn = open_research_database(db_path, project_id)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "research.storage.transaction_failed".to_string())?;
    let plan = load_research_plans_from(&transaction, runtime_root, project_id)?
        .into_iter()
        .find(|plan| plan.task_id == task_id && plan.version == version)
        .ok_or_else(|| "research.plan.not_found".to_string())?;
    if plan.approval_status != "approved" {
        return Err("research.plan.not_approved".to_string());
    }
    let active_exists: bool = transaction
        .query_row(
            "SELECT EXISTS(
                SELECT 1 FROM research_runs
                WHERE task_id = ?1 AND status NOT IN ('completed', 'failed', 'cancelled')
            )",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.run.query_failed".to_string())?;
    if active_exists {
        return Err("research.run.already_active".to_string());
    }
    let run_id = format!("research-run-{}", Uuid::new_v4().simple());
    let total_steps = plan.steps.iter().filter(|step| step.enabled).count() as i64;
    let started_at = now_iso();
    transaction
        .execute(
            "INSERT INTO research_runs
         (run_id, task_id, plan_version, status, total_steps, started_at, updated_at)
         VALUES (?1, ?2, ?3, 'running', ?4, ?5, ?5)",
            params![run_id, task_id, version, total_steps, started_at],
        )
        .map_err(|_| "research.run.write_failed".to_string())?;
    let run_ids_json: String = transaction
        .query_row(
            "SELECT run_ids_json FROM research_tasks WHERE id = ?1",
            params![task_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.task.not_found".to_string())?;
    let mut run_ids: Vec<String> = serde_json::from_str(&run_ids_json)
        .map_err(|_| "research.storage.metadata_invalid".to_string())?;
    if !run_ids.contains(&run_id) {
        run_ids.push(run_id.clone());
    }
    transaction
        .execute(
            "UPDATE research_tasks
         SET status = 'execution', run_ids_json = ?1, updated_at = ?2 WHERE id = ?3",
            params![
                serde_json::to_string(&run_ids)
                    .map_err(|_| "research.storage.serialize_failed".to_string())?,
                started_at,
                task_id,
            ],
        )
        .map_err(|_| "research.run.write_failed".to_string())?;
    transaction
        .commit()
        .map_err(|_| "research.storage.commit_failed".to_string())?;
    Ok((
        ResearchAgentRun {
            run_id,
            project_id: project_id.to_string(),
            task_id: task_id.to_string(),
            plan_version: version,
            status: "running".to_string(),
            current_step_id: None,
            completed_steps: 0,
            total_steps,
            last_operation: None,
            evidence_count: 0,
            diagnostic_code: None,
            started_at: started_at.clone(),
            updated_at: started_at,
            finished_at: None,
        },
        plan,
    ))
}

pub fn get_research_plan_run(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
) -> Result<ResearchAgentRun, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.query_row(
        &format!("{RESEARCH_RUN_SELECT} WHERE run_id = ?1"),
        params![run_id],
        |row| {
            load_research_run_from_row(row, runtime_root, project_id).map_err(|error| {
                rusqlite::Error::FromSqlConversionFailure(
                    0,
                    rusqlite::types::Type::Text,
                    Box::new(std::io::Error::new(std::io::ErrorKind::InvalidData, error)),
                )
            })
        },
    )
    .map_err(|_| "research.run.not_found".to_string())
}

pub fn list_research_plan_runs(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    include_terminal: bool,
) -> Result<Vec<ResearchAgentRun>, String> {
    let conn = open_research_database(db_path, project_id)?;
    let filter = if include_terminal {
        ""
    } else {
        " WHERE status NOT IN ('completed', 'failed', 'cancelled')"
    };
    let sql = format!("{RESEARCH_RUN_SELECT}{filter} ORDER BY updated_at DESC LIMIT 100");
    let mut statement = conn
        .prepare(&sql)
        .map_err(|_| "research.run.query_failed".to_string())?;
    let mut rows = statement
        .query([])
        .map_err(|_| "research.run.query_failed".to_string())?;
    let mut runs = Vec::new();
    while let Some(row) = rows
        .next()
        .map_err(|_| "research.run.query_failed".to_string())?
    {
        runs.push(load_research_run_from_row(row, runtime_root, project_id)?);
    }
    Ok(runs)
}

pub fn update_research_run_progress(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    status: &str,
    current_step_id: Option<&str>,
    completed_steps: i64,
    last_operation: Option<&str>,
    diagnostic_code: Option<&str>,
) -> Result<(), String> {
    let conn = open_research_database(db_path, project_id)?;
    let last_operation_envelope = last_operation
        .map(|value| {
            seal_research_json(
                runtime_root,
                project_id,
                "run",
                run_id,
                "last-operation",
                &value,
            )
        })
        .transpose()?;
    let terminal = TERMINAL_RESEARCH_RUN_STATUSES.contains(&status);
    conn.execute(
        "UPDATE research_runs SET status = ?1, current_step_id = ?2, completed_steps = ?3,
            last_operation_envelope = COALESCE(?4, last_operation_envelope), diagnostic_code = ?5,
            updated_at = ?6, finished_at = CASE WHEN ?7 THEN ?6 ELSE NULL END
         WHERE run_id = ?8",
        params![
            status,
            current_step_id,
            completed_steps,
            last_operation_envelope,
            diagnostic_code,
            now_iso(),
            terminal,
            run_id,
        ],
    )
    .map_err(|_| "research.run.write_failed".to_string())?;
    let task_status = match status {
        "waiting_approval" => "approval_paused",
        "validating" => "validation",
        "completed" => "completed",
        "failed" => "failed",
        "cancelled" => "cancelled",
        _ => "execution",
    };
    conn.execute(
        "UPDATE research_tasks SET status = ?1, updated_at = ?2
         WHERE id = (SELECT task_id FROM research_runs WHERE run_id = ?3)",
        params![task_status, now_iso(), run_id],
    )
    .map_err(|_| "research.run.write_failed".to_string())?;
    Ok(())
}

pub fn store_research_step_result(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
    status: &str,
    result: Option<&serde_json::Value>,
    diagnostic_code: Option<&str>,
) -> Result<(), String> {
    let conn = open_research_database(db_path, project_id)?;
    let result_envelope = result
        .map(|value| {
            seal_research_json(
                runtime_root,
                project_id,
                "run-step",
                &format!("{run_id}:{step_id}"),
                "result",
                value,
            )
        })
        .transpose()?;
    let now = now_iso();
    conn.execute(
        "INSERT INTO research_step_results
         (run_id, step_id, status, result_envelope, diagnostic_code, started_at, finished_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?6)
         ON CONFLICT(run_id, step_id) DO UPDATE SET status = excluded.status,
            result_envelope = excluded.result_envelope,
            diagnostic_code = excluded.diagnostic_code,
            finished_at = excluded.finished_at",
        params![
            run_id,
            step_id,
            status,
            result_envelope,
            diagnostic_code,
            now
        ],
    )
    .map_err(|_| "research.run.step_write_failed".to_string())?;
    Ok(())
}

pub fn request_research_plan_approval(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
    risk_level: &str,
    command_summary: &str,
) -> Result<ResearchPlanApproval, String> {
    let conn = open_research_database(db_path, project_id)?;
    if let Some(existing) =
        get_research_plan_approval(&conn, runtime_root, project_id, run_id, step_id)?
    {
        return Ok(existing);
    }
    let approval_id = format!("approval-{}", Uuid::new_v4().simple());
    let created_at = now_iso();
    let summary = seal_research_json(
        runtime_root,
        project_id,
        "approval",
        &approval_id,
        "command-summary",
        &command_summary,
    )?;
    conn.execute(
        "INSERT INTO research_plan_approvals
         (approval_id, run_id, step_id, risk_level, command_summary_envelope, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, 'pending', ?6)",
        params![
            approval_id,
            run_id,
            step_id,
            risk_level,
            summary,
            created_at
        ],
    )
    .map_err(|_| "research.approval.write_failed".to_string())?;
    Ok(ResearchPlanApproval {
        approval_id,
        project_id: project_id.to_string(),
        run_id: run_id.to_string(),
        step_id: step_id.to_string(),
        risk_level: risk_level.to_string(),
        command_summary: command_summary.to_string(),
        status: "pending".to_string(),
        created_at,
        resolved_at: None,
    })
}

fn get_research_plan_approval(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
) -> Result<Option<ResearchPlanApproval>, String> {
    let row = conn
        .query_row(
            "SELECT approval_id, risk_level, command_summary_envelope, status, created_at, resolved_at
             FROM research_plan_approvals WHERE run_id = ?1 AND step_id = ?2",
            params![run_id, step_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, Option<String>>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "research.approval.query_failed".to_string())?;
    let Some((approval_id, risk_level, summary, status, created_at, resolved_at)) = row else {
        return Ok(None);
    };
    Ok(Some(ResearchPlanApproval {
        command_summary: open_research_json(
            runtime_root,
            project_id,
            "approval",
            &approval_id,
            "command-summary",
            &summary,
        )?,
        approval_id,
        project_id: project_id.to_string(),
        run_id: run_id.to_string(),
        step_id: step_id.to_string(),
        risk_level,
        status,
        created_at,
        resolved_at,
    }))
}

pub fn list_research_plan_approvals(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
) -> Result<Vec<ResearchPlanApproval>, String> {
    let conn = open_research_database(db_path, project_id)?;
    let mut statement = conn
        .prepare("SELECT run_id, step_id FROM research_plan_approvals WHERE status = 'pending' ORDER BY created_at")
        .map_err(|_| "research.approval.query_failed".to_string())?;
    let pairs = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|_| "research.approval.query_failed".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "research.approval.query_failed".to_string())?;
    let mut approvals = Vec::new();
    for (run_id, step_id) in pairs {
        if let Some(approval) =
            get_research_plan_approval(&conn, runtime_root, project_id, &run_id, &step_id)?
        {
            approvals.push(approval);
        }
    }
    Ok(approvals)
}

pub fn resolve_research_plan_approval(
    db_path: &Path,
    project_id: &str,
    approval_id: &str,
    decision: &str,
) -> Result<(String, String), String> {
    if !matches!(decision, "approved" | "rejected") {
        return Err("research.approval.decision_invalid".to_string());
    }
    let conn = open_research_database(db_path, project_id)?;
    let context: (String, String, String) = conn
        .query_row(
            "SELECT run_id, step_id, status FROM research_plan_approvals WHERE approval_id = ?1",
            params![approval_id],
            |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)),
        )
        .map_err(|_| "research.approval.not_found".to_string())?;
    if context.2 != "pending" {
        return Err("research.approval.already_resolved".to_string());
    }
    conn.execute(
        "UPDATE research_plan_approvals SET status = ?1, resolved_at = ?2 WHERE approval_id = ?3",
        params![decision, now_iso(), approval_id],
    )
    .map_err(|_| "research.approval.write_failed".to_string())?;
    Ok((context.0, context.1))
}

pub fn research_step_is_approved(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
) -> Result<bool, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM research_plan_approvals
            WHERE run_id = ?1 AND step_id = ?2 AND status = 'approved'
        )",
        params![run_id, step_id],
        |row| row.get(0),
    )
    .map_err(|_| "research.approval.query_failed".to_string())
}

pub fn research_step_is_completed(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
) -> Result<bool, String> {
    let conn = open_research_database(db_path, project_id)?;
    conn.query_row(
        "SELECT EXISTS(
            SELECT 1 FROM research_step_results
            WHERE run_id = ?1 AND step_id = ?2 AND status = 'completed'
        )",
        params![run_id, step_id],
        |row| row.get(0),
    )
    .map_err(|_| "research.run.query_failed".to_string())
}

pub fn refresh_research_run_evidence_count(
    db_path: &Path,
    project_id: &str,
    run_id: &str,
) -> Result<i64, String> {
    let conn = open_research_database(db_path, project_id)?;
    let count: i64 = conn
        .query_row(
            "SELECT COUNT(*) FROM research_evidence_packets WHERE run_id = ?1",
            params![run_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.evidence.query_failed".to_string())?;
    conn.execute(
        "UPDATE research_runs SET evidence_count = ?1, updated_at = ?2 WHERE run_id = ?3",
        params![count, now_iso(), run_id],
    )
    .map_err(|_| "research.run.write_failed".to_string())?;
    Ok(count)
}
