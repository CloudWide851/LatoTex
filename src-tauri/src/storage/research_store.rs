use crate::models::{
    ResearchChatMigrationInput, ResearchChatMigrationResult, ResearchChatSession,
    ResearchChatStore, ResearchChatStoreReplaceInput, ResearchPlanApproveInput,
    ResearchNetworkPolicy, ResearchNetworkPolicyUpdateInput,
    ResearchPlanSaveInput, ResearchPlanStep, ResearchPlanVersion, ResearchTask,
    ResearchTaskCreateInput, ResearchWorkspaceSnapshot,
};
use serde::de::DeserializeOwned;
use serde::Serialize;

const RESEARCH_DB_RELATIVE_PATH: &str = ".latotex/research/tasks.sqlite3";
const CHAT_MIGRATION_V1: &str = "localstorage-chat-v1";
const MAX_TASK_GOAL_BYTES: usize = 256 * 1024;
const MAX_CHAT_SESSIONS: usize = 80;
const MAX_CHAT_MESSAGES: usize = 600;
const MAX_PLAN_STEPS: usize = 128;

fn research_scope(project_id: &str, entity: &str, id: &str, field: &str) -> String {
    format!("research:{project_id}:{entity}:{id}:{field}")
}

fn seal_research_json<T: Serialize>(
    runtime_root: &Path,
    project_id: &str,
    entity: &str,
    id: &str,
    field: &str,
    value: &T,
) -> Result<String, String> {
    let bytes =
        serde_json::to_vec(value).map_err(|_| "research.storage.serialize_failed".to_string())?;
    secure::seal_scoped_blob(
        runtime_root,
        &research_scope(project_id, entity, id, field),
        &bytes,
    )
}

fn open_research_json<T: DeserializeOwned>(
    runtime_root: &Path,
    project_id: &str,
    entity: &str,
    id: &str,
    field: &str,
    value: &str,
) -> Result<T, String> {
    let bytes = secure::open_scoped_blob(
        runtime_root,
        &research_scope(project_id, entity, id, field),
        value,
    )?;
    serde_json::from_slice(&bytes).map_err(|_| "research.storage.decrypt_decode_failed".to_string())
}

fn open_optional_research_json<T: DeserializeOwned + Default>(
    runtime_root: &Path,
    project_id: &str,
    entity: &str,
    id: &str,
    field: &str,
    value: Option<String>,
) -> Result<T, String> {
    match value {
        Some(value) => open_research_json(runtime_root, project_id, entity, id, field, &value),
        None => Ok(T::default()),
    }
}

fn validate_research_id(value: &str) -> Result<&str, String> {
    let trimmed = value.trim();
    if trimmed.is_empty()
        || trimmed.len() > 128
        || !trimmed
            .chars()
            .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.'))
    {
        return Err("research.storage.invalid_id".to_string());
    }
    Ok(trimmed)
}

fn research_database_path(db_path: &Path, project_id: &str) -> Result<PathBuf, String> {
    validate_research_id(project_id)?;
    let project_root = load_project_root(db_path, project_id)?;
    let target = prepare_workspace_mutation_path(&project_root, RESEARCH_DB_RELATIVE_PATH)?;
    let parent = target
        .parent()
        .ok_or_else(|| "research.storage.path_invalid".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "research.storage.create_failed".to_string())?;
    Ok(target)
}

fn open_research_database(db_path: &Path, project_id: &str) -> Result<Connection, String> {
    let path = research_database_path(db_path, project_id)?;
    let conn = Connection::open(path).map_err(|_| "research.storage.open_failed".to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(5))
        .map_err(|_| "research.storage.busy_timeout_failed".to_string())?;
    ensure_research_schema(&conn, project_id)?;
    Ok(conn)
}

fn load_research_tasks_from(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
) -> Result<Vec<ResearchTask>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, goal_envelope, status, current_plan_version, run_ids_json,
                    chat_session_id, created_at, updated_at
             FROM research_tasks ORDER BY updated_at DESC",
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, Option<i64>>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, Option<String>>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
            ))
        })
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let mut tasks = Vec::new();
    for row in rows {
        let (id, goal, status, current_plan_version, run_ids, chat_session_id, created_at, updated_at) =
            row.map_err(|_| "research.storage.query_failed".to_string())?;
        tasks.push(ResearchTask {
            goal: open_research_json(runtime_root, project_id, "task", &id, "goal", &goal)?,
            id,
            project_id: project_id.to_string(),
            status,
            current_plan_version,
            run_ids: serde_json::from_str(&run_ids)
                .map_err(|_| "research.storage.metadata_invalid".to_string())?,
            chat_session_id,
            created_at,
            updated_at,
        });
    }
    Ok(tasks)
}

fn load_plan_steps_from(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
    plan_id: &str,
) -> Result<Vec<ResearchPlanStep>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, step_order, enabled, dependencies_json, capability, input_envelope,
                    risk_level, status, run_id
             FROM research_plan_steps WHERE plan_version_id = ?1 ORDER BY step_order",
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let rows = statement
        .query_map(params![plan_id], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, i64>(1)?,
                row.get::<_, bool>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, String>(6)?,
                row.get::<_, String>(7)?,
                row.get::<_, Option<String>>(8)?,
            ))
        })
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let mut steps = Vec::new();
    for row in rows {
        let (id, order, enabled, dependencies, capability, input, risk_level, status, run_id) =
            row.map_err(|_| "research.storage.query_failed".to_string())?;
        steps.push(ResearchPlanStep {
            input: open_research_json(
                runtime_root,
                project_id,
                "plan-step",
                &format!("{plan_id}:{id}"),
                "input",
                &input,
            )?,
            id,
            order,
            enabled,
            dependencies: serde_json::from_str(&dependencies)
                .map_err(|_| "research.storage.metadata_invalid".to_string())?,
            capability,
            risk_level,
            status,
            run_id,
        });
    }
    Ok(steps)
}

fn load_research_plans_from(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
) -> Result<Vec<ResearchPlanVersion>, String> {
    let mut statement = conn
        .prepare(
            "SELECT id, task_id, version, source_message_envelope, approval_status,
                    authorized_projects_envelope, title_envelope, summary_envelope,
                    assumptions_envelope, expected_artifacts_envelope,
                    acceptance_criteria_envelope, created_at, approved_at
             FROM research_plan_versions ORDER BY created_at DESC",
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, i64>(2)?,
                row.get::<_, String>(3)?,
                row.get::<_, String>(4)?,
                row.get::<_, String>(5)?,
                row.get::<_, Option<String>>(6)?,
                row.get::<_, Option<String>>(7)?,
                row.get::<_, Option<String>>(8)?,
                row.get::<_, Option<String>>(9)?,
                row.get::<_, Option<String>>(10)?,
                row.get::<_, String>(11)?,
                row.get::<_, Option<String>>(12)?,
            ))
        })
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let mut plans = Vec::new();
    for row in rows {
        let (
            id,
            task_id,
            version,
            source,
            approval_status,
            authorized,
            title,
            summary,
            assumptions,
            expected_artifacts,
            acceptance_criteria,
            created_at,
            approved_at,
        ) = row.map_err(|_| "research.storage.query_failed".to_string())?;
        plans.push(ResearchPlanVersion {
            source_message: open_research_json(
                runtime_root,
                project_id,
                "plan",
                &id,
                "source-message",
                &source,
            )?,
            authorized_project_ids: open_research_json(
                runtime_root,
                project_id,
                "plan",
                &id,
                "authorized-projects",
                &authorized,
            )?,
            title: open_optional_research_json(
                runtime_root, project_id, "plan", &id, "title", title,
            )?,
            summary: open_optional_research_json(
                runtime_root, project_id, "plan", &id, "summary", summary,
            )?,
            assumptions: open_optional_research_json(
                runtime_root, project_id, "plan", &id, "assumptions", assumptions,
            )?,
            expected_artifacts: open_optional_research_json(
                runtime_root, project_id, "plan", &id, "expected-artifacts", expected_artifacts,
            )?,
            acceptance_criteria: open_optional_research_json(
                runtime_root, project_id, "plan", &id, "acceptance-criteria", acceptance_criteria,
            )?,
            steps: load_plan_steps_from(conn, runtime_root, project_id, &id)?,
            id,
            task_id,
            version,
            approval_status,
            created_at,
            approved_at,
        });
    }
    Ok(plans)
}

fn chat_migration_completed(conn: &Connection) -> Result<bool, String> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM research_migrations WHERE id = ?1)",
        params![CHAT_MIGRATION_V1],
        |row| row.get(0),
    )
    .map_err(|_| "research.storage.query_failed".to_string())
}

fn load_chat_store_from(
    conn: &Connection,
    runtime_root: &Path,
    project_id: &str,
) -> Result<ResearchChatStore, String> {
    let active_session_id = conn
        .query_row(
            "SELECT active_session_id FROM research_chat_state WHERE singleton = 1",
            [],
            |row| row.get::<_, Option<String>>(0),
        )
        .optional()
        .map_err(|_| "research.storage.query_failed".to_string())?
        .flatten();
    let mut session_statement = conn
        .prepare(
            "SELECT id, title_envelope, created_at, updated_at
             FROM research_chat_sessions ORDER BY updated_at DESC LIMIT 80",
        )
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let session_rows = session_statement
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "research.storage.query_failed".to_string())?;
    let mut sessions = Vec::new();
    for row in session_rows {
        let (id, title, created_at, updated_at) =
            row.map_err(|_| "research.storage.query_failed".to_string())?;
        let mut message_statement = conn
            .prepare(
                "SELECT id, role, text_envelope, created_at, run_id, task_id
                 FROM research_chat_messages WHERE session_id = ?1 ORDER BY message_order",
            )
            .map_err(|_| "research.storage.query_failed".to_string())?;
        let message_rows = message_statement
            .query_map(params![id], |message_row| {
                Ok((
                    message_row.get::<_, String>(0)?,
                    message_row.get::<_, String>(1)?,
                    message_row.get::<_, String>(2)?,
                    message_row.get::<_, String>(3)?,
                    message_row.get::<_, Option<String>>(4)?,
                    message_row.get::<_, Option<String>>(5)?,
                ))
            })
            .map_err(|_| "research.storage.query_failed".to_string())?;
        let mut messages = Vec::new();
        for message in message_rows {
            let (message_id, role, text, message_created_at, run_id, task_id) =
                message.map_err(|_| "research.storage.query_failed".to_string())?;
            messages.push(crate::models::ResearchChatMessage {
                text: open_research_json(
                    runtime_root,
                    project_id,
                    "chat-message",
                    &message_id,
                    "text",
                    &text,
                )?,
                id: message_id,
                role,
                created_at: message_created_at,
                run_id,
                task_id,
            });
        }
        sessions.push(ResearchChatSession {
            title: open_research_json(
                runtime_root,
                project_id,
                "chat-session",
                &id,
                "title",
                &title,
            )?,
            id,
            created_at,
            updated_at,
            messages,
        });
    }
    Ok(ResearchChatStore {
        sessions,
        active_session_id,
        migration_completed: chat_migration_completed(conn)?,
        diagnostic_code: None,
    })
}

fn validate_chat_store(store: &ResearchChatStore) -> Result<(), String> {
    if store.sessions.len() > MAX_CHAT_SESSIONS {
        return Err("research.chat.too_many_sessions".to_string());
    }
    for session in &store.sessions {
        validate_research_id(&session.id)?;
        if session.title.len() > 512 || session.messages.len() > MAX_CHAT_MESSAGES {
            return Err("research.chat.limit_exceeded".to_string());
        }
        for message in &session.messages {
            validate_research_id(&message.id)?;
            if !matches!(message.role.as_str(), "user" | "assistant" | "system") {
                return Err("research.chat.role_invalid".to_string());
            }
            if message.text.len() > MAX_TASK_GOAL_BYTES {
                return Err("research.chat.limit_exceeded".to_string());
            }
            if let Some(task_id) = message.task_id.as_deref() {
                validate_research_id(task_id)?;
            }
        }
    }
    Ok(())
}

fn replace_chat_store_in(
    transaction: &rusqlite::Transaction<'_>,
    runtime_root: &Path,
    project_id: &str,
    store: &ResearchChatStore,
) -> Result<(), String> {
    validate_chat_store(store)?;
    transaction
        .execute("DELETE FROM research_chat_sessions", [])
        .map_err(|_| "research.storage.write_failed".to_string())?;
    for session in &store.sessions {
        let title = seal_research_json(
            runtime_root,
            project_id,
            "chat-session",
            &session.id,
            "title",
            &session.title,
        )?;
        transaction
            .execute(
                "INSERT INTO research_chat_sessions (id, title_envelope, created_at, updated_at)
                 VALUES (?1, ?2, ?3, ?4)",
                params![session.id, title, session.created_at, session.updated_at],
            )
            .map_err(|_| "research.storage.write_failed".to_string())?;
        for (order, message) in session.messages.iter().enumerate() {
            let text = seal_research_json(
                runtime_root,
                project_id,
                "chat-message",
                &message.id,
                "text",
                &message.text,
            )?;
            transaction
                .execute(
                    "INSERT INTO research_chat_messages
                    (id, session_id, message_order, role, text_envelope, created_at, run_id, task_id)
                     VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)",
                    params![
                        message.id,
                        session.id,
                        order as i64,
                        message.role,
                        text,
                        message.created_at,
                        message.run_id,
                        message.task_id,
                    ],
                )
                .map_err(|_| "research.storage.write_failed".to_string())?;
        }
    }
    let active = store.active_session_id.as_ref().filter(|id| {
        store
            .sessions
            .iter()
            .any(|session| session.id == id.as_str())
    });
    transaction
        .execute(
            "INSERT INTO research_chat_state (singleton, active_session_id, updated_at)
             VALUES (1, ?1, ?2)
             ON CONFLICT(singleton) DO UPDATE SET
                active_session_id = excluded.active_session_id,
                updated_at = excluded.updated_at",
            params![active, now_iso()],
        )
        .map_err(|_| "research.storage.write_failed".to_string())?;
    Ok(())
}
