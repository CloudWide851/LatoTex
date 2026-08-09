pub fn load_research_network_policy(
    db_path: &Path,
    project_id: &str,
) -> Result<ResearchNetworkPolicy, String> {
    let conn = open_research_database(db_path, project_id)?;
    let default_updated_at = now_iso();
    conn.execute(
        "INSERT OR IGNORE INTO research_network_policy
         (singleton, academic_metadata_enabled, verified_oa_download_enabled,
          external_model_evidence_excerpt_enabled, updated_at)
         VALUES (1, 1, 1, 0, ?1)",
        params![default_updated_at],
    )
    .map_err(|_| "research.egress.policy_write_failed".to_string())?;
    conn.query_row(
        "SELECT academic_metadata_enabled, verified_oa_download_enabled,
                external_model_evidence_excerpt_enabled, updated_at
         FROM research_network_policy WHERE singleton = 1",
        [],
        |row| {
            Ok(ResearchNetworkPolicy {
                project_id: project_id.to_string(),
                academic_metadata_enabled: row.get::<_, i64>(0)? != 0,
                verified_oa_download_enabled: row.get::<_, i64>(1)? != 0,
                external_model_evidence_excerpt_enabled: row.get::<_, i64>(2)? != 0,
                updated_at: row.get(3)?,
            })
        },
    )
    .map_err(|_| "research.egress.policy_read_failed".to_string())
}

pub fn update_research_network_policy(
    db_path: &Path,
    input: ResearchNetworkPolicyUpdateInput,
) -> Result<ResearchNetworkPolicy, String> {
    validate_research_id(&input.project_id)?;
    let conn = open_research_database(db_path, &input.project_id)?;
    let updated_at = now_iso();
    conn.execute(
        "INSERT INTO research_network_policy
         (singleton, academic_metadata_enabled, verified_oa_download_enabled,
          external_model_evidence_excerpt_enabled, updated_at)
         VALUES (1, ?1, ?2, ?3, ?4)
         ON CONFLICT(singleton) DO UPDATE SET
            academic_metadata_enabled = excluded.academic_metadata_enabled,
            verified_oa_download_enabled = excluded.verified_oa_download_enabled,
            external_model_evidence_excerpt_enabled = excluded.external_model_evidence_excerpt_enabled,
            updated_at = excluded.updated_at",
        params![
            i64::from(input.academic_metadata_enabled),
            i64::from(input.verified_oa_download_enabled),
            i64::from(input.external_model_evidence_excerpt_enabled),
            updated_at,
        ],
    )
    .map_err(|_| "research.egress.policy_write_failed".to_string())?;
    load_research_network_policy(db_path, &input.project_id)
}
