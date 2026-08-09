use crate::models::{
    ClaimEvidenceAssessInput, ClaimEvidenceAssessment, EvidencePacket, EvidencePacketUpsertInput,
};
use ring::digest::{digest, SHA256};

const MAX_EVIDENCE_EXCERPT_CHARS: usize = 32_768;
const MAX_CLAIM_CHARS: usize = 8_000;

fn evidence_content_hash(input: &EvidencePacketUpsertInput) -> String {
    let normalized = format!(
        "{}\n{}\n{}\n{}",
        input.source.trim().to_ascii_lowercase(),
        input
            .doi
            .as_deref()
            .unwrap_or_default()
            .trim()
            .to_ascii_lowercase(),
        input.source_version.as_deref().unwrap_or_default().trim(),
        input
            .excerpt
            .split_whitespace()
            .collect::<Vec<_>>()
            .join(" "),
    );
    digest(&SHA256, normalized.as_bytes())
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn normalize_evidence_state(value: Option<&str>, allowed: &[&str]) -> String {
    value
        .map(str::trim)
        .filter(|value| allowed.contains(value))
        .unwrap_or("unknown")
        .to_string()
}

pub fn upsert_evidence_packet(
    db_path: &Path,
    runtime_root: &Path,
    input: EvidencePacketUpsertInput,
) -> Result<EvidencePacket, String> {
    if input.title.trim().is_empty()
        || input.excerpt.trim().is_empty()
        || input.excerpt.chars().count() > MAX_EVIDENCE_EXCERPT_CHARS
        || input.source.trim().is_empty()
        || input.source_url.chars().count() > 8_192
    {
        return Err("research.evidence.input_invalid".to_string());
    }
    validate_research_fulltext_anchor(
        db_path,
        runtime_root,
        &input.project_id,
        &input.locator,
        &input.excerpt,
    )?;
    let conn = open_research_database(db_path, &input.project_id)?;
    let task_exists: bool = conn
        .query_row(
            "SELECT EXISTS(SELECT 1 FROM research_tasks WHERE id = ?1)",
            params![input.task_id],
            |row| row.get(0),
        )
        .map_err(|_| "research.evidence.query_failed".to_string())?;
    if !task_exists {
        return Err("research.task.not_found".to_string());
    }
    let content_hash = evidence_content_hash(&input);
    let existing_id: Option<String> = conn
        .query_row(
            "SELECT id FROM research_evidence_packets WHERE task_id = ?1 AND content_hash = ?2",
            params![input.task_id, content_hash],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "research.evidence.query_failed".to_string())?;
    let id = existing_id.unwrap_or_else(|| {
        input
            .stable_id
            .as_deref()
            .and_then(|value| validate_research_id(value).ok())
            .map(str::to_string)
            .unwrap_or_else(|| format!("evidence-{}", &content_hash[..24]))
    });
    let title = seal_research_json(
        runtime_root,
        &input.project_id,
        "evidence",
        &id,
        "title",
        &input.title,
    )?;
    let excerpt = seal_research_json(
        runtime_root,
        &input.project_id,
        "evidence",
        &id,
        "excerpt",
        &input.excerpt,
    )?;
    let locator = seal_research_json(
        runtime_root,
        &input.project_id,
        "evidence",
        &id,
        "locator",
        &input.locator,
    )?;
    let source_url = seal_research_json(
        runtime_root,
        &input.project_id,
        "evidence",
        &id,
        "source-url",
        &input.source_url,
    )?;
    let created_at = now_iso();
    let retraction_status = normalize_evidence_state(
        input.retraction_status.as_deref(),
        &["clear", "retracted", "corrected", "unknown"],
    );
    let correction_status = normalize_evidence_state(
        input.correction_status.as_deref(),
        &["none", "corrected", "expression_of_concern", "unknown"],
    );
    conn.execute(
        "INSERT INTO research_evidence_packets
         (id, task_id, run_id, source, doi, source_version, title_envelope, excerpt_envelope,
          locator_envelope, content_hash, retraction_status, correction_status,
          source_url_envelope, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14)
         ON CONFLICT(task_id, content_hash) DO UPDATE SET
            run_id = COALESCE(excluded.run_id, research_evidence_packets.run_id),
            title_envelope = excluded.title_envelope,
            excerpt_envelope = excluded.excerpt_envelope,
            locator_envelope = excluded.locator_envelope,
            retraction_status = excluded.retraction_status,
            correction_status = excluded.correction_status,
            source_url_envelope = excluded.source_url_envelope",
        params![
            id,
            input.task_id,
            input.run_id,
            input.source,
            input.doi,
            input.source_version,
            title,
            excerpt,
            locator,
            content_hash,
            retraction_status,
            correction_status,
            source_url,
            created_at,
        ],
    )
    .map_err(|_| "research.evidence.write_failed".to_string())?;
    load_evidence_packet(&conn, runtime_root, &input.project_id, &id)
}

fn load_evidence_packet(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
    evidence_id: &str,
) -> Result<EvidencePacket, String> {
    let raw = conn
        .query_row(
            "SELECT id, task_id, run_id, source, doi, source_version, title_envelope,
                    excerpt_envelope, locator_envelope, content_hash, retraction_status,
                    correction_status, source_url_envelope, created_at
             FROM research_evidence_packets WHERE id = ?1",
            params![evidence_id],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, Option<String>>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, Option<String>>(4)?,
                    row.get::<_, Option<String>>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                    row.get::<_, String>(8)?,
                    row.get::<_, String>(9)?,
                    row.get::<_, String>(10)?,
                    row.get::<_, String>(11)?,
                    row.get::<_, String>(12)?,
                    row.get::<_, String>(13)?,
                ))
            },
        )
        .map_err(|_| "research.evidence.not_found".to_string())?;
    Ok(EvidencePacket {
        title: open_research_json(
            runtime_root,
            project_id,
            "evidence",
            &raw.0,
            "title",
            &raw.6,
        )?,
        excerpt: open_research_json(
            runtime_root,
            project_id,
            "evidence",
            &raw.0,
            "excerpt",
            &raw.7,
        )?,
        locator: open_research_json(
            runtime_root,
            project_id,
            "evidence",
            &raw.0,
            "locator",
            &raw.8,
        )?,
        source_url: open_research_json(
            runtime_root,
            project_id,
            "evidence",
            &raw.0,
            "source-url",
            &raw.12,
        )?,
        id: raw.0,
        task_id: raw.1,
        run_id: raw.2,
        source: raw.3,
        doi: raw.4,
        source_version: raw.5,
        content_hash: raw.9,
        retraction_status: raw.10,
        correction_status: raw.11,
        created_at: raw.13,
    })
}

pub fn list_evidence_packets(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<Vec<EvidencePacket>, String> {
    let conn = open_research_database(db_path, project_id)?;
    let mut statement = conn
        .prepare("SELECT id FROM research_evidence_packets WHERE task_id = ?1 ORDER BY created_at")
        .map_err(|_| "research.evidence.query_failed".to_string())?;
    let ids = statement
        .query_map(params![task_id], |row| row.get::<_, String>(0))
        .map_err(|_| "research.evidence.query_failed".to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|_| "research.evidence.query_failed".to_string())?;
    ids.into_iter()
        .map(|id| load_evidence_packet(&conn, runtime_root, project_id, &id))
        .collect()
}

pub fn assess_claim_evidence(
    db_path: &Path,
    runtime_root: &Path,
    input: ClaimEvidenceAssessInput,
) -> Result<ClaimEvidenceAssessment, String> {
    if input.claim.trim().is_empty()
        || input.claim.chars().count() > MAX_CLAIM_CHARS
        || input.evidence_ids.len() > 64
    {
        return Err("research.claim.input_invalid".to_string());
    }
    let conn = open_research_database(db_path, &input.project_id)?;
    let mut packets = Vec::new();
    for evidence_id in &input.evidence_ids {
        let packet = load_evidence_packet(&conn, runtime_root, &input.project_id, evidence_id)?;
        if packet.task_id != input.task_id {
            return Err("research.evidence.task_scope_denied".to_string());
        }
        packets.push(packet);
    }
    let (original_status, original_rationale) = classify_claim(&input.claim, &packets);
    let repair_attempted = input.repaired_claim.is_some() && original_status != "supported";
    let (status, rationale) = if repair_attempted {
        classify_claim(
            input.repaired_claim.as_deref().unwrap_or_default(),
            &packets,
        )
    } else {
        (original_status, original_rationale)
    };
    let requires_unconfirmed_label = !matches!(status.as_str(), "supported" | "contradicted");
    let id = format!("claim-{}", Uuid::new_v4().simple());
    let created_at = now_iso();
    let claim = seal_research_json(
        runtime_root,
        &input.project_id,
        "claim",
        &id,
        "claim",
        &input.claim,
    )?;
    let verbatim_excerpts = packets
        .iter()
        .map(|packet| packet.excerpt.clone())
        .collect::<Vec<_>>();
    let excerpts = seal_research_json(
        runtime_root,
        &input.project_id,
        "claim",
        &id,
        "verbatim-excerpts",
        &verbatim_excerpts,
    )?;
    let rationale_envelope = seal_research_json(
        runtime_root,
        &input.project_id,
        "claim",
        &id,
        "rationale",
        &rationale,
    )?;
    let repaired_claim_envelope = input
        .repaired_claim
        .as_ref()
        .map(|value| {
            seal_research_json(
                runtime_root,
                &input.project_id,
                "claim",
                &id,
                "repaired-claim",
                value,
            )
        })
        .transpose()?;
    conn.execute(
        "INSERT INTO research_claim_assessments
         (id, task_id, claim_envelope, status, evidence_ids_json, verbatim_excerpts_envelope,
          rationale_envelope, repair_attempted, repaired_claim_envelope,
          requires_unconfirmed_label, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)",
        params![
            id,
            input.task_id,
            claim,
            status,
            serde_json::to_string(&input.evidence_ids)
                .map_err(|_| "research.storage.serialize_failed".to_string())?,
            excerpts,
            rationale_envelope,
            repair_attempted,
            repaired_claim_envelope,
            requires_unconfirmed_label,
            created_at,
        ],
    )
    .map_err(|_| "research.claim.write_failed".to_string())?;
    Ok(ClaimEvidenceAssessment {
        id,
        task_id: input.task_id,
        claim: input.claim,
        status,
        evidence_ids: input.evidence_ids,
        verbatim_excerpts,
        rationale,
        repair_attempted,
        repaired_claim: input.repaired_claim,
        requires_unconfirmed_label,
        created_at,
    })
}

pub fn list_claim_evidence_assessments(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    task_id: &str,
) -> Result<Vec<ClaimEvidenceAssessment>, String> {
    let conn = open_research_database(db_path, project_id)?;
    let mut statement = conn
        .prepare(
            "SELECT id, claim_envelope, status, evidence_ids_json, verbatim_excerpts_envelope,
                    rationale_envelope, repair_attempted, repaired_claim_envelope,
                    requires_unconfirmed_label, created_at
             FROM research_claim_assessments WHERE task_id = ?1 ORDER BY created_at",
        )
        .map_err(|_| "research.claim.query_failed".to_string())?;
    let rows = statement
        .query_map(params![task_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, bool>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, bool>(8)?,
                row.get::<_, String>(9)?,
            ))
        })
        .map_err(|_| "research.claim.query_failed".to_string())?;
    let mut assessments = Vec::new();
    for row in rows {
        let raw = row.map_err(|_| "research.claim.query_failed".to_string())?;
        assessments.push(ClaimEvidenceAssessment {
            claim: open_research_json(runtime_root, project_id, "claim", &raw.0, "claim", &raw.1)?,
            evidence_ids: serde_json::from_str(&raw.3)
                .map_err(|_| "research.storage.metadata_invalid".to_string())?,
            verbatim_excerpts: open_research_json(
                runtime_root,
                project_id,
                "claim",
                &raw.0,
                "verbatim-excerpts",
                &raw.4,
            )?,
            rationale: open_research_json(
                runtime_root,
                project_id,
                "claim",
                &raw.0,
                "rationale",
                &raw.5,
            )?,
            repaired_claim: raw
                .7
                .as_deref()
                .map(|value| {
                    open_research_json(
                        runtime_root,
                        project_id,
                        "claim",
                        &raw.0,
                        "repaired-claim",
                        value,
                    )
                })
                .transpose()?,
            id: raw.0,
            task_id: task_id.to_string(),
            status: raw.2,
            repair_attempted: raw.6,
            requires_unconfirmed_label: raw.8,
            created_at: raw.9,
        });
    }
    Ok(assessments)
}
