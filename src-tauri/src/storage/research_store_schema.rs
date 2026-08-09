fn ensure_research_schema(conn: &Connection, project_id: &str) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        BEGIN IMMEDIATE;
        CREATE TABLE IF NOT EXISTS research_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_network_policy (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            academic_metadata_enabled INTEGER NOT NULL CHECK(academic_metadata_enabled IN (0, 1)),
            verified_oa_download_enabled INTEGER NOT NULL CHECK(verified_oa_download_enabled IN (0, 1)),
            external_model_evidence_excerpt_enabled INTEGER NOT NULL CHECK(external_model_evidence_excerpt_enabled IN (0, 1)),
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_tasks (
            id TEXT PRIMARY KEY,
            goal_envelope TEXT NOT NULL,
            status TEXT NOT NULL,
            current_plan_version INTEGER,
            run_ids_json TEXT NOT NULL DEFAULT '[]',
            chat_session_id TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_plan_versions (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
            version INTEGER NOT NULL,
            source_message_envelope TEXT NOT NULL,
            approval_status TEXT NOT NULL,
            authorized_projects_envelope TEXT NOT NULL,
            title_envelope TEXT,
            summary_envelope TEXT,
            assumptions_envelope TEXT,
            expected_artifacts_envelope TEXT,
            acceptance_criteria_envelope TEXT,
            created_at TEXT NOT NULL,
            approved_at TEXT,
            UNIQUE(task_id, version)
        );
        CREATE TABLE IF NOT EXISTS research_plan_steps (
            id TEXT NOT NULL,
            plan_version_id TEXT NOT NULL REFERENCES research_plan_versions(id) ON DELETE CASCADE,
            step_order INTEGER NOT NULL,
            enabled INTEGER NOT NULL,
            dependencies_json TEXT NOT NULL,
            capability TEXT NOT NULL,
            input_envelope TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            status TEXT NOT NULL,
            run_id TEXT,
            PRIMARY KEY(plan_version_id, id)
        );
        CREATE TABLE IF NOT EXISTS research_chat_state (
            singleton INTEGER PRIMARY KEY CHECK(singleton = 1),
            active_session_id TEXT,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_chat_sessions (
            id TEXT PRIMARY KEY,
            title_envelope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_chat_messages (
            id TEXT PRIMARY KEY,
            session_id TEXT NOT NULL REFERENCES research_chat_sessions(id) ON DELETE CASCADE,
            message_order INTEGER NOT NULL,
            role TEXT NOT NULL,
            text_envelope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            run_id TEXT,
            task_id TEXT
        );
        CREATE TABLE IF NOT EXISTS research_migrations (
            id TEXT PRIMARY KEY,
            completed_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_resource_locks (
            lock_id TEXT PRIMARY KEY,
            resource_path TEXT NOT NULL,
            mode TEXT NOT NULL CHECK(mode IN ('read', 'write')),
            run_id TEXT NOT NULL,
            heartbeat_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            UNIQUE(run_id, resource_path)
        );
        CREATE TABLE IF NOT EXISTS research_runs (
            run_id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
            plan_version INTEGER NOT NULL,
            status TEXT NOT NULL,
            current_step_id TEXT,
            completed_steps INTEGER NOT NULL DEFAULT 0,
            total_steps INTEGER NOT NULL,
            last_operation_envelope TEXT,
            evidence_count INTEGER NOT NULL DEFAULT 0,
            diagnostic_code TEXT,
            started_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            finished_at TEXT
        );
        CREATE TABLE IF NOT EXISTS research_step_results (
            run_id TEXT NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            status TEXT NOT NULL,
            result_envelope TEXT,
            diagnostic_code TEXT,
            started_at TEXT NOT NULL,
            finished_at TEXT,
            PRIMARY KEY(run_id, step_id)
        );
        CREATE TABLE IF NOT EXISTS research_run_leases (
            run_id TEXT PRIMARY KEY REFERENCES research_runs(run_id) ON DELETE CASCADE,
            owner_id TEXT NOT NULL,
            lease_token TEXT NOT NULL,
            claimed_at TEXT NOT NULL,
            heartbeat_at TEXT NOT NULL,
            expires_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_change_checkpoints (
            checkpoint_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            before_hash TEXT NOT NULL,
            after_hash TEXT,
            old_content_envelope TEXT NOT NULL,
            applied_content_envelope TEXT,
            patch_envelope TEXT,
            status TEXT NOT NULL CHECK(status IN ('pending', 'applied', 'undone', 'conflict')),
            created_at TEXT NOT NULL,
            applied_at TEXT,
            undone_at TEXT,
            UNIQUE(run_id, step_id)
        );
        CREATE TABLE IF NOT EXISTS research_plan_approvals (
            approval_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            command_summary_envelope TEXT NOT NULL,
            status TEXT NOT NULL,
            created_at TEXT NOT NULL,
            resolved_at TEXT,
            UNIQUE(run_id, step_id)
        );
        CREATE TABLE IF NOT EXISTS research_capability_audit (
            audit_id TEXT PRIMARY KEY,
            run_id TEXT NOT NULL REFERENCES research_runs(run_id) ON DELETE CASCADE,
            step_id TEXT NOT NULL,
            stage TEXT NOT NULL,
            risk_level TEXT NOT NULL,
            input_summary_envelope TEXT NOT NULL,
            result_summary_envelope TEXT,
            duration_ms INTEGER,
            diagnostic_code TEXT,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_evidence_packets (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
            run_id TEXT,
            source TEXT NOT NULL,
            doi TEXT,
            source_version TEXT,
            title_envelope TEXT NOT NULL,
            excerpt_envelope TEXT NOT NULL,
            locator_envelope TEXT NOT NULL,
            content_hash TEXT NOT NULL,
            retraction_status TEXT NOT NULL,
            correction_status TEXT NOT NULL,
            source_url_envelope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            UNIQUE(task_id, content_hash)
        );
        CREATE TABLE IF NOT EXISTS research_claim_assessments (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
            claim_envelope TEXT NOT NULL,
            status TEXT NOT NULL,
            evidence_ids_json TEXT NOT NULL,
            verbatim_excerpts_envelope TEXT NOT NULL,
            rationale_envelope TEXT NOT NULL,
            repair_attempted INTEGER NOT NULL,
            repaired_claim_envelope TEXT,
            requires_unconfirmed_label INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_fulltext_documents (
            document_hash TEXT PRIMARY KEY,
            source_url_envelope TEXT NOT NULL,
            relative_path TEXT NOT NULL,
            byte_size INTEGER NOT NULL,
            page_count INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_fulltext_blocks (
            document_hash TEXT NOT NULL REFERENCES research_fulltext_documents(document_hash) ON DELETE CASCADE,
            page INTEGER NOT NULL,
            paragraph_index INTEGER NOT NULL,
            text_envelope TEXT NOT NULL,
            text_hash TEXT NOT NULL,
            PRIMARY KEY(document_hash, page, paragraph_index)
        );
        CREATE TABLE IF NOT EXISTS research_review_protocols (
            task_id TEXT PRIMARY KEY REFERENCES research_tasks(id) ON DELETE CASCADE,
            title_envelope TEXT NOT NULL,
            research_question_envelope TEXT NOT NULL,
            inclusion_criteria_envelope TEXT NOT NULL,
            exclusion_criteria_envelope TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_query_snapshots (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
            query_envelope TEXT NOT NULL,
            sources_json TEXT NOT NULL,
            result_count INTEGER NOT NULL,
            stop_reason TEXT NOT NULL,
            created_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_review_screenings (
            id TEXT PRIMARY KEY,
            task_id TEXT NOT NULL REFERENCES research_tasks(id) ON DELETE CASCADE,
            evidence_id TEXT NOT NULL REFERENCES research_evidence_packets(id) ON DELETE CASCADE,
            recommendation TEXT NOT NULL,
            confidence REAL NOT NULL,
            suggestion_reason_envelope TEXT NOT NULL,
            decision TEXT NOT NULL,
            exclusion_reason_envelope TEXT,
            full_text_reviewed INTEGER NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            decided_at TEXT,
            UNIQUE(task_id, evidence_id)
        );
        CREATE INDEX IF NOT EXISTS idx_research_plan_task ON research_plan_versions(task_id, version);
        CREATE INDEX IF NOT EXISTS idx_research_chat_message_session ON research_chat_messages(session_id, message_order);
        CREATE INDEX IF NOT EXISTS idx_research_resource_lock_path ON research_resource_locks(resource_path, expires_at);
        CREATE INDEX IF NOT EXISTS idx_research_runs_status ON research_runs(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_research_run_lease_expiry ON research_run_leases(expires_at);
        CREATE INDEX IF NOT EXISTS idx_research_checkpoint_run ON research_change_checkpoints(run_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_approval_status ON research_plan_approvals(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_evidence_task ON research_evidence_packets(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_claim_task ON research_claim_assessments(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_fulltext_block_page ON research_fulltext_blocks(document_hash, page, paragraph_index);
        CREATE INDEX IF NOT EXISTS idx_research_query_snapshot_task ON research_query_snapshots(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_screening_task ON research_review_screenings(task_id, decision, updated_at);
        COMMIT;
        ",
    )
    .map_err(|_| "research.storage.schema_failed".to_string())?;
    ensure_research_column(conn, "research_tasks", "chat_session_id", "TEXT")?;
    ensure_research_column(conn, "research_plan_versions", "title_envelope", "TEXT")?;
    ensure_research_column(conn, "research_plan_versions", "summary_envelope", "TEXT")?;
    ensure_research_column(
        conn,
        "research_plan_versions",
        "assumptions_envelope",
        "TEXT",
    )?;
    ensure_research_column(
        conn,
        "research_plan_versions",
        "expected_artifacts_envelope",
        "TEXT",
    )?;
    ensure_research_column(
        conn,
        "research_plan_versions",
        "acceptance_criteria_envelope",
        "TEXT",
    )?;
    ensure_research_column(conn, "research_chat_messages", "task_id", "TEXT")?;
    let stored_project: Option<String> = conn
        .query_row(
            "SELECT value FROM research_metadata WHERE key = 'project_id'",
            [],
            |row| row.get(0),
        )
        .optional()
        .map_err(|_| "research.storage.metadata_failed".to_string())?;
    if let Some(stored_project) = stored_project {
        if stored_project != project_id {
            return Err("research.storage.project_mismatch".to_string());
        }
    } else {
        conn.execute(
            "INSERT INTO research_metadata (key, value) VALUES ('project_id', ?1)",
            params![project_id],
        )
        .map_err(|_| "research.storage.metadata_failed".to_string())?;
    }
    Ok(())
}

fn ensure_research_column(
    conn: &Connection,
    table: &str,
    column: &str,
    definition: &str,
) -> Result<(), String> {
    let mut statement = conn
        .prepare(&format!("PRAGMA table_info({table})"))
        .map_err(|_| "research.storage.schema_failed".to_string())?;
    let columns = statement
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|_| "research.storage.schema_failed".to_string())?;
    for existing in columns {
        if existing.map_err(|_| "research.storage.schema_failed".to_string())? == column {
            return Ok(());
        }
    }
    conn.execute(
        &format!("ALTER TABLE {table} ADD COLUMN {column} {definition}"),
        [],
    )
    .map_err(|_| "research.storage.schema_failed".to_string())?;
    Ok(())
}
