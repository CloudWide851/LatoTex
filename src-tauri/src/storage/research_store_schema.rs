fn ensure_research_schema(conn: &Connection, project_id: &str) -> Result<(), String> {
    conn.execute_batch(
        "
        PRAGMA foreign_keys = ON;
        CREATE TABLE IF NOT EXISTS research_metadata (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS research_tasks (
            id TEXT PRIMARY KEY,
            goal_envelope TEXT NOT NULL,
            status TEXT NOT NULL,
            current_plan_version INTEGER,
            run_ids_json TEXT NOT NULL DEFAULT '[]',
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
            run_id TEXT
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
        CREATE INDEX IF NOT EXISTS idx_research_plan_task ON research_plan_versions(task_id, version);
        CREATE INDEX IF NOT EXISTS idx_research_chat_message_session ON research_chat_messages(session_id, message_order);
        CREATE INDEX IF NOT EXISTS idx_research_resource_lock_path ON research_resource_locks(resource_path, expires_at);
        CREATE INDEX IF NOT EXISTS idx_research_runs_status ON research_runs(status, updated_at);
        CREATE INDEX IF NOT EXISTS idx_research_approval_status ON research_plan_approvals(status, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_evidence_task ON research_evidence_packets(task_id, created_at);
        CREATE INDEX IF NOT EXISTS idx_research_claim_task ON research_claim_assessments(task_id, created_at);
        ",
    )
    .map_err(|_| "research.storage.schema_failed".to_string())?;
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
