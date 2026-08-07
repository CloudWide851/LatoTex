use crate::models::{AgentAppCommand, ResearchUiCommand, ResearchUiCommandResolveInput};

pub fn list_pending_research_ui_commands(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
) -> Result<Vec<ResearchUiCommand>, String> {
    let conn = open_research_database(db_path, project_id)?;
    let mut statement = conn
        .prepare(
            "SELECT result.run_id, result.step_id, result.result_envelope, result.started_at
             FROM research_step_results result
             INNER JOIN research_runs run ON run.run_id = result.run_id
             WHERE result.status = 'waiting_ui' AND run.status = 'waiting_ui'
             ORDER BY result.started_at ASC",
        )
        .map_err(|_| "research.ui_command.query_failed".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "research.ui_command.query_failed".to_string())?;
    let mut commands = Vec::new();
    for row in rows {
        let (run_id, step_id, envelope, created_at) =
            row.map_err(|_| "research.ui_command.query_failed".to_string())?;
        let command: AgentAppCommand = open_research_json(
            runtime_root,
            project_id,
            "run-step",
            &format!("{run_id}:{step_id}"),
            "result",
            &envelope,
        )?;
        let capability = serde_json::to_value(&command)
            .ok()
            .and_then(|value| {
                value
                    .get("command")
                    .and_then(Value::as_str)
                    .map(str::to_string)
            })
            .ok_or_else(|| "research.ui_command.decode_failed".to_string())?;
        commands.push(ResearchUiCommand {
            project_id: project_id.to_string(),
            run_id,
            step_id,
            capability,
            command,
            created_at,
        });
    }
    Ok(commands)
}

fn validate_ui_diagnostic_code(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 160
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("research.ui_command.diagnostic_invalid".to_string());
    }
    Ok(Some(value.to_string()))
}

pub fn resolve_research_ui_command(
    db_path: &Path,
    runtime_root: &Path,
    input: &ResearchUiCommandResolveInput,
) -> Result<i64, String> {
    validate_research_id(&input.run_id)?;
    validate_research_id(&input.step_id)?;
    if !matches!(input.status.as_str(), "completed" | "failed") {
        return Err("research.ui_command.status_invalid".to_string());
    }
    let diagnostic_code = validate_ui_diagnostic_code(input.diagnostic_code.as_deref())?;
    if input.status == "failed" && diagnostic_code.is_none() {
        return Err("research.ui_command.diagnostic_required".to_string());
    }
    let result_envelope = input
        .result
        .as_ref()
        .map(|value| {
            seal_research_json(
                runtime_root,
                &input.project_id,
                "run-step",
                &format!("{}:{}", input.run_id, input.step_id),
                "result",
                value,
            )
        })
        .transpose()?;
    let conn = open_research_database(db_path, &input.project_id)?;
    let run_state = conn
        .query_row(
            "SELECT run.status, run.current_step_id, step.capability, step.risk_level,
                    result.started_at
             FROM research_runs run
             INNER JOIN research_plan_versions plan
                ON plan.task_id = run.task_id AND plan.version = run.plan_version
             INNER JOIN research_plan_steps step
                ON step.plan_version_id = plan.id AND step.id = ?2
             INNER JOIN research_step_results result
                ON result.run_id = run.run_id AND result.step_id = step.id
             WHERE run.run_id = ?1",
            params![input.run_id, input.step_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, Option<String>>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "research.ui_command.query_failed".to_string())?
        .ok_or_else(|| "research.run.not_found".to_string())?;
    if run_state.0 != "waiting_ui" || run_state.1.as_deref() != Some(input.step_id.as_str()) {
        return Err("research.ui_command.not_pending".to_string());
    }
    let now = now_iso();
    let changed = conn
        .execute(
            "UPDATE research_step_results
             SET status = ?1, result_envelope = ?2, diagnostic_code = ?3, finished_at = ?4
             WHERE run_id = ?5 AND step_id = ?6 AND status = 'waiting_ui'",
            params![
                input.status,
                result_envelope,
                diagnostic_code,
                now,
                input.run_id,
                input.step_id,
            ],
        )
        .map_err(|_| "research.ui_command.write_failed".to_string())?;
    if changed != 1 {
        return Err("research.ui_command.not_pending".to_string());
    }
    let completed_steps = conn
        .query_row(
            "SELECT COUNT(*) FROM research_step_results WHERE run_id = ?1 AND status = 'completed'",
            params![input.run_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.ui_command.query_failed".to_string())?;
    let duration_ms = chrono::DateTime::parse_from_rfc3339(&run_state.4)
        .ok()
        .map(|started| {
            (Utc::now() - started.with_timezone(&Utc))
                .num_milliseconds()
                .max(0)
        });
    drop(conn);
    append_research_capability_audit(
        db_path,
        runtime_root,
        &input.project_id,
        &input.run_id,
        &input.step_id,
        &input.status,
        &run_state.3,
        &json!({ "capability": run_state.2 }),
        Some(&json!({ "status": input.status })),
        duration_ms,
        diagnostic_code.as_deref(),
    )?;
    Ok(completed_steps)
}
