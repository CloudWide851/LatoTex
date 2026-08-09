pub fn load_research_review_workspace(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<ResearchReviewWorkspace, String> {
    let conn = open_research_database(db_path, project_id)?;
    ensure_research_review_task(&conn, task_id)?;
    let protocol_raw = conn
        .query_row(
            "SELECT title_envelope, research_question_envelope, inclusion_criteria_envelope,
                    exclusion_criteria_envelope, created_at, updated_at
             FROM research_review_protocols WHERE task_id = ?1",
            params![task_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                ))
            },
        )
        .optional()
        .map_err(|_| "research.review.query_failed".to_string())?;
    let protocol = protocol_raw
        .map(|raw| {
            Ok::<ResearchReviewProtocol, String>(ResearchReviewProtocol {
                task_id: task_id.to_string(),
                title: open_research_json(
                    runtime_root,
                    project_id,
                    "review-protocol",
                    task_id,
                    "title",
                    &raw.0,
                )?,
                research_question: open_research_json(
                    runtime_root,
                    project_id,
                    "review-protocol",
                    task_id,
                    "question",
                    &raw.1,
                )?,
                inclusion_criteria: open_research_json(
                    runtime_root,
                    project_id,
                    "review-protocol",
                    task_id,
                    "inclusion",
                    &raw.2,
                )?,
                exclusion_criteria: open_research_json(
                    runtime_root,
                    project_id,
                    "review-protocol",
                    task_id,
                    "exclusion",
                    &raw.3,
                )?,
                created_at: raw.4,
                updated_at: raw.5,
            })
        })
        .transpose()?;
    let mut snapshot_statement = conn
        .prepare(
            "SELECT id, query_envelope, sources_json, result_count, stop_reason, created_at
             FROM research_query_snapshots WHERE task_id = ?1 ORDER BY created_at",
        )
        .map_err(|_| "research.review.query_failed".to_string())?;
    let snapshot_rows = snapshot_statement
        .query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, u32>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
            ))
        })
        .map_err(|_| "research.review.query_failed".to_string())?;
    let mut query_snapshots = Vec::new();
    for row in snapshot_rows {
        let raw = row.map_err(|_| "research.review.query_failed".to_string())?;
        query_snapshots.push(ResearchQuerySnapshot {
            query: open_research_json(
                runtime_root,
                project_id,
                "query-snapshot",
                &raw.0,
                "query",
                &raw.1,
            )?,
            id: raw.0,
            task_id: task_id.to_string(),
            sources: serde_json::from_str(&raw.2)
                .map_err(|_| "research.storage.metadata_invalid".to_string())?,
            result_count: raw.3,
            stop_reason: raw.4,
            created_at: raw.5,
        });
    }
    let mut screening_statement = conn
        .prepare(
            "SELECT id FROM research_review_screenings WHERE task_id = ?1 ORDER BY created_at",
        )
        .map_err(|_| "research.review.query_failed".to_string())?;
    let screening_ids = screening_statement
        .query_map(params![task_id], |row| row.get::<_, String>(0))
        .map_err(|_| "research.review.query_failed".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "research.review.query_failed".to_string())?;
    let screenings = screening_ids
        .into_iter()
        .map(|id| load_research_screening(&conn, runtime_root, project_id, &id))
        .collect::<Result<Vec<_>, _>>()?;
    let identified = query_snapshots.iter().fold(0_u32, |total, snapshot| {
        total.saturating_add(snapshot.result_count)
    });
    let prisma = ResearchPrismaCounts {
        identified,
        deduplicated: screenings.len() as u32,
        screened: screenings
            .iter()
            .filter(|screening| screening.decision != "pending")
            .count() as u32,
        excluded: screenings
            .iter()
            .filter(|screening| screening.decision == "exclude")
            .count() as u32,
        full_text_assessed: screenings
            .iter()
            .filter(|screening| {
                screening.decision != "pending" && screening.full_text_reviewed
            })
            .count() as u32,
        included: screenings
            .iter()
            .filter(|screening| screening.decision == "include")
            .count() as u32,
    };
    Ok(ResearchReviewWorkspace {
        protocol,
        query_snapshots,
        screenings,
        prisma,
    })
}
