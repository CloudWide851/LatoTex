fn validate_research_audit_code(value: Option<&str>) -> Result<Option<String>, String> {
    let Some(value) = value.map(str::trim).filter(|value| !value.is_empty()) else {
        return Ok(None);
    };
    if value.len() > 160
        || !value
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-'))
    {
        return Err("research.audit.diagnostic_invalid".to_string());
    }
    Ok(Some(value.to_string()))
}

pub fn append_research_capability_audit(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    run_id: &str,
    step_id: &str,
    stage: &str,
    risk_level: &str,
    input_summary: &Value,
    result_summary: Option<&Value>,
    duration_ms: Option<i64>,
    diagnostic_code: Option<&str>,
) -> Result<(), String> {
    validate_research_id(run_id)?;
    validate_research_id(step_id)?;
    if stage.is_empty()
        || stage.len() > 64
        || !stage
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))
        || !matches!(risk_level, "read" | "write" | "high")
    {
        return Err("research.audit.input_invalid".to_string());
    }
    let audit_id = format!("audit-{}", Uuid::new_v4().simple());
    let input_envelope = seal_research_json(
        runtime_root,
        project_id,
        "audit",
        &audit_id,
        "input-summary",
        input_summary,
    )?;
    let result_envelope = result_summary
        .map(|summary| {
            seal_research_json(
                runtime_root,
                project_id,
                "audit",
                &audit_id,
                "result-summary",
                summary,
            )
        })
        .transpose()?;
    let conn = open_research_database(db_path, project_id)?;
    conn.execute(
        "INSERT INTO research_capability_audit
         (audit_id, run_id, step_id, stage, risk_level, input_summary_envelope,
          result_summary_envelope, duration_ms, diagnostic_code, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
        params![
            audit_id,
            run_id,
            step_id,
            stage,
            risk_level,
            input_envelope,
            result_envelope,
            duration_ms.map(|value| value.clamp(0, 86_400_000)),
            validate_research_audit_code(diagnostic_code)?,
            now_iso(),
        ],
    )
    .map_err(|_| "research.audit.write_failed".to_string())?;
    Ok(())
}
