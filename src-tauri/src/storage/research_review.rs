use crate::models::{
    ResearchPrismaCounts, ResearchQuerySnapshot, ResearchQuerySnapshotRecordInput,
    ResearchReviewProtocol, ResearchReviewProtocolSaveInput, ResearchReviewWorkspace,
    ResearchScreeningConfirmBatchInput, ResearchScreeningRecord, ResearchScreeningSuggestInput,
};
fn ensure_research_review_task(conn: &Connection, task_id: &str) -> Result<(), String> {
    validate_research_id(task_id)?;
    let exists = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM research_tasks WHERE id = ?1)",
            params![task_id],
            |row| row.get::<_, bool>(0),
        )
        .map_err(|_| "research.review.query_failed".to_string())?;
    if exists {
        Ok(())
    } else {
        Err("research.task.not_found".to_string())
    }
}
fn validate_review_text(value: &str, limit: usize) -> bool {
    !value.trim().is_empty() && value.chars().count() <= limit
}
fn validate_review_criteria(values: &[String]) -> bool {
    !values.is_empty()
        && values.len() <= 64
        && values
            .iter()
            .all(|value| validate_review_text(value, 2_000))
}
pub fn save_research_review_protocol(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchReviewProtocolSaveInput,
) -> Result<ResearchReviewProtocol, String> {
    if !validate_review_text(&input.title, 512)
        || !validate_review_text(&input.research_question, 4_000)
        || !validate_review_criteria(&input.inclusion_criteria)
        || !validate_review_criteria(&input.exclusion_criteria)
    {
        return Err("research.review.protocol_invalid".to_string());
    }
    let conn = open_research_database(db_path, &input.project_id)?;
    ensure_research_review_task(&conn, &input.task_id)?;
    let created_at = conn
        .query_row(
            "SELECT created_at FROM research_review_protocols WHERE task_id = ?1",
            params![input.task_id],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "research.review.query_failed".to_string())?
        .unwrap_or_else(now_iso);
    let updated_at = now_iso();
    let title_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "review-protocol",
        &input.task_id,
        "title",
        &input.title,
    )?;
    let question_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "review-protocol",
        &input.task_id,
        "question",
        &input.research_question,
    )?;
    let inclusion_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "review-protocol",
        &input.task_id,
        "inclusion",
        &input.inclusion_criteria,
    )?;
    let exclusion_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "review-protocol",
        &input.task_id,
        "exclusion",
        &input.exclusion_criteria,
    )?;
    conn.execute(
        "INSERT INTO research_review_protocols
         (task_id, title_envelope, research_question_envelope, inclusion_criteria_envelope,
          exclusion_criteria_envelope, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ON CONFLICT(task_id) DO UPDATE SET
            title_envelope = excluded.title_envelope,
            research_question_envelope = excluded.research_question_envelope,
            inclusion_criteria_envelope = excluded.inclusion_criteria_envelope,
            exclusion_criteria_envelope = excluded.exclusion_criteria_envelope,
            updated_at = excluded.updated_at",
        params![
            input.task_id,
            title_envelope,
            question_envelope,
            inclusion_envelope,
            exclusion_envelope,
            created_at,
            updated_at,
        ],
    )
    .map_err(|_| "research.review.protocol_write_failed".to_string())?;
    Ok(ResearchReviewProtocol {
        task_id: input.task_id,
        title: input.title,
        research_question: input.research_question,
        inclusion_criteria: input.inclusion_criteria,
        exclusion_criteria: input.exclusion_criteria,
        created_at,
        updated_at,
    })
}
pub fn record_research_query_snapshot(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchQuerySnapshotRecordInput,
) -> Result<ResearchQuerySnapshot, String> {
    const STOP_REASONS: &[&str] = &[
        "result_limit",
        "providers_exhausted",
        "provider_degraded",
        "network_disabled",
        "no_results",
    ];
    if !validate_review_text(&input.query, 512)
        || input.sources.len() > 32
        || input.result_count > 1_000_000
        || input.sources.iter().any(|source| {
            source.trim().is_empty()
                || source.chars().count() > 64
                || !source
                    .chars()
                    .all(|character| character.is_ascii_alphanumeric() || matches!(character, '_' | '-'))
        })
        || !STOP_REASONS.contains(&input.stop_reason.as_str())
    {
        return Err("research.review.query_snapshot_invalid".to_string());
    }
    let conn = open_research_database(db_path, &input.project_id)?;
    ensure_research_review_task(&conn, &input.task_id)?;
    let id = input
        .stable_id
        .as_deref()
        .and_then(|value| validate_research_id(value).ok())
        .map(str::to_string)
        .unwrap_or_else(|| format!("query-snapshot-{}", Uuid::new_v4().simple()));
    let existing = conn
        .query_row(
            "SELECT task_id, query_envelope, sources_json, result_count, stop_reason, created_at
             FROM research_query_snapshots WHERE id = ?1",
            params![id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "research.review.query_failed".to_string())?;
    if let Some(existing) = existing {
        if existing.0 != input.task_id {
            return Err("research.review.query_snapshot_scope_denied".to_string());
        }
        return Ok(ResearchQuerySnapshot {
            id: id.clone(),
            task_id: existing.0,
            query: open_research_json(
                runtime_root,
                &input.project_id,
                "query-snapshot",
                &id,
                "query",
                &existing.1,
            )?,
            sources: serde_json::from_str(&existing.2)
                .map_err(|_| "research.storage.metadata_invalid".to_string())?,
            result_count: existing.3,
            stop_reason: existing.4,
            created_at: existing.5,
        });
    }
    let query_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "query-snapshot",
        &id,
        "query",
        &input.query,
    )?;
    let created_at = now_iso();
    conn.execute(
        "INSERT INTO research_query_snapshots
         (id, task_id, query_envelope, sources_json, result_count, stop_reason, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)
         ",
        params![
            id,
            input.task_id,
            query_envelope,
            serde_json::to_string(&input.sources)
                .map_err(|_| "research.storage.serialize_failed".to_string())?,
            input.result_count,
            input.stop_reason,
            created_at,
        ],
    )
    .map_err(|_| "research.review.query_snapshot_write_failed".to_string())?;
    Ok(ResearchQuerySnapshot {
        id,
        task_id: input.task_id,
        query: input.query,
        sources: input.sources,
        result_count: input.result_count,
        stop_reason: input.stop_reason,
        created_at,
    })
}
pub fn suggest_research_screening(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchScreeningSuggestInput,
) -> Result<ResearchScreeningRecord, String> {
    if !matches!(input.recommendation.as_str(), "include" | "exclude" | "uncertain")
        || !input.confidence.is_finite()
        || !(0.0..=1.0).contains(&input.confidence)
        || !validate_review_text(&input.suggestion_reason, 4_000)
    {
        return Err("research.review.screening_suggestion_invalid".to_string());
    }
    let conn = open_research_database(db_path, &input.project_id)?;
    ensure_research_review_task(&conn, &input.task_id)?;
    let evidence_task: Option<String> = conn
        .query_row(
            "SELECT task_id FROM research_evidence_packets WHERE id = ?1",
            params![input.evidence_id],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "research.review.query_failed".to_string())?;
    if evidence_task.as_deref() != Some(input.task_id.as_str()) {
        return Err("research.evidence.task_scope_denied".to_string());
    }
    let existing = conn
        .query_row(
            "SELECT id, created_at FROM research_review_screenings
             WHERE task_id = ?1 AND evidence_id = ?2",
            params![input.task_id, input.evidence_id],
            |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)),
        )
        .optional()
        .map_err(|_| "research.review.query_failed".to_string())?;
    let (id, created_at) = existing.unwrap_or_else(|| {
        (
            format!("screening-{}", Uuid::new_v4().simple()),
            now_iso(),
        )
    });
    let updated_at = now_iso();
    let reason_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "review-screening",
        &id,
        "suggestion-reason",
        &input.suggestion_reason,
    )?;
    conn.execute(
        "INSERT INTO research_review_screenings
         (id, task_id, evidence_id, recommendation, confidence, suggestion_reason_envelope,
          decision, exclusion_reason_envelope, full_text_reviewed, created_at, updated_at, decided_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', NULL, 0, ?7, ?8, NULL)
         ON CONFLICT(task_id, evidence_id) DO UPDATE SET
            recommendation = excluded.recommendation,
            confidence = excluded.confidence,
            suggestion_reason_envelope = excluded.suggestion_reason_envelope,
            updated_at = excluded.updated_at",
        params![
            id,
            input.task_id,
            input.evidence_id,
            input.recommendation,
            input.confidence,
            reason_envelope,
            created_at,
            updated_at,
        ],
    )
    .map_err(|_| "research.review.screening_write_failed".to_string())?;
    load_research_screening(&conn, runtime_root, &input.project_id, &id)
}
pub fn confirm_research_screenings(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchScreeningConfirmBatchInput,
) -> Result<ResearchReviewWorkspace, String> {
    if input.decisions.is_empty() || input.decisions.len() > 256 {
        return Err("research.review.screening_batch_invalid".to_string());
    }
    let mut ids = std::collections::BTreeSet::new();
    let mut prepared = Vec::new();
    for decision in &input.decisions {
        validate_research_id(&decision.screening_id)?;
        if !ids.insert(decision.screening_id.clone())
            || !matches!(decision.decision.as_str(), "include" | "exclude")
            || decision
                .exclusion_reason
                .as_deref()
                .is_some_and(|value| value.chars().count() > 4_000)
            || (decision.decision == "exclude"
                && !decision
                    .exclusion_reason
                    .as_deref()
                    .is_some_and(|value| !value.trim().is_empty()))
            || (decision.decision == "include" && decision.exclusion_reason.is_some())
        {
            return Err("research.review.screening_batch_invalid".to_string());
        }
        let envelope = decision
            .exclusion_reason
            .as_ref()
            .map(|reason| {
                seal_research_json(
                    runtime_root,
                    &input.project_id,
                    "review-screening",
                    &decision.screening_id,
                    "exclusion-reason",
                    reason,
                )
            })
            .transpose()?;
        prepared.push((decision, envelope));
    }
    let mut conn = open_research_database(db_path, &input.project_id)?;
    ensure_research_review_task(&conn, &input.task_id)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "research.review.screening_write_failed".to_string())?;
    let decided_at = now_iso();
    for (decision, exclusion_reason_envelope) in prepared {
        let task_id = transaction
            .query_row(
                "SELECT task_id FROM research_review_screenings WHERE id = ?1",
                params![decision.screening_id],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| "research.review.screening_not_found".to_string())?;
        if task_id != input.task_id {
            return Err("research.review.screening_scope_denied".to_string());
        }
        transaction
            .execute(
                "UPDATE research_review_screenings SET
                    decision = ?2, exclusion_reason_envelope = ?3,
                    full_text_reviewed = ?4, updated_at = ?5, decided_at = ?5
                 WHERE id = ?1",
                params![
                    decision.screening_id,
                    decision.decision,
                    exclusion_reason_envelope,
                    decision.full_text_reviewed,
                    decided_at,
                ],
            )
            .map_err(|_| "research.review.screening_write_failed".to_string())?;
    }
    transaction
        .commit()
        .map_err(|_| "research.review.screening_write_failed".to_string())?;
    load_research_review_workspace(db_path, runtime_root, &input.project_id, &input.task_id)
}
fn load_research_screening(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
    screening_id: &str,
) -> Result<ResearchScreeningRecord, String> {
    let raw = conn
        .query_row(
            "SELECT id, task_id, evidence_id, recommendation, confidence,
                    suggestion_reason_envelope, decision, exclusion_reason_envelope,
                    full_text_reviewed, created_at, updated_at, decided_at
             FROM research_review_screenings WHERE id = ?1",
            params![screening_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, f64>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, Option<String>>(7)?,
                    row.get::<_, bool>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, Option<String>>(11)?,
                ))
            },
        )
        .map_err(|_| "research.review.screening_not_found".to_string())?;
    Ok(ResearchScreeningRecord {
        suggestion_reason: open_research_json(
            runtime_root,
            project_id,
            "review-screening",
            &raw.0,
            "suggestion-reason",
            &raw.5,
        )?,
        exclusion_reason: raw
            .7
            .as_deref()
            .map(|value| {
                open_research_json(
                    runtime_root,
                    project_id,
                    "review-screening",
                    &raw.0,
                    "exclusion-reason",
                    value,
                )
            })
            .transpose()?,
        id: raw.0,
        task_id: raw.1,
        evidence_id: raw.2,
        recommendation: raw.3,
        confidence: raw.4,
        decision: raw.6,
        full_text_reviewed: raw.8,
        created_at: raw.9,
        updated_at: raw.10,
        decided_at: raw.11,
    })
}
