#[derive(Debug, Clone)]
pub(crate) struct AgentRuntimeSetting {
    pub executable_path: Option<String>,
    pub enabled: bool,
}

pub(crate) fn agent_runtime_setting(
    db_path: &Path,
    runtime_id: &str,
) -> Result<AgentRuntimeSetting, String> {
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    conn.query_row(
        "SELECT executable_path,enabled FROM agent_runtime_settings WHERE runtime_id=?1",
        params![runtime_id],
        |row| {
            Ok(AgentRuntimeSetting {
                executable_path: row.get(0)?,
                enabled: row.get(1)?,
            })
        },
    )
    .optional()
    .map_err(|error| error.to_string())
    .map(|value| {
        value.unwrap_or(AgentRuntimeSetting {
            executable_path: None,
            enabled: runtime_id == "native",
        })
    })
}

pub(crate) fn set_agent_runtime_path(
    db_path: &Path,
    runtime_id: &str,
    executable_path: Option<&str>,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO agent_runtime_settings (runtime_id,executable_path,enabled,updated_at)
         VALUES (?1,?2,0,?3)
         ON CONFLICT(runtime_id) DO UPDATE SET executable_path=excluded.executable_path,
           updated_at=excluded.updated_at",
        params![runtime_id, executable_path, now_iso()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

pub(crate) fn set_agent_runtime_enabled(
    db_path: &Path,
    runtime_id: &str,
    enabled: bool,
) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO agent_runtime_settings (runtime_id,executable_path,enabled,updated_at)
         VALUES (?1,NULL,?2,?3)
         ON CONFLICT(runtime_id) DO UPDATE SET enabled=excluded.enabled,updated_at=excluded.updated_at",
        params![runtime_id, enabled, now_iso()],
    )
    .map_err(|error| error.to_string())?;
    Ok(())
}

fn agent_mcp_token_hash(token: &str) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, token.as_bytes());
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

pub(crate) fn create_agent_mcp_session(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    profile: &crate::models::AgentProfile,
    allowed_tools: &[String],
) -> Result<(crate::models::McpCapabilitySession, String), String> {
    create_agent_mcp_session_with_ttl(
        db_path,
        run_id,
        project_id,
        profile,
        allowed_tools,
        chrono::Duration::minutes(15),
    )
}

pub(crate) fn create_agent_mcp_terminal_session(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    profile: &crate::models::AgentProfile,
    allowed_tools: &[String],
) -> Result<(crate::models::McpCapabilitySession, String), String> {
    create_agent_mcp_session_with_ttl(
        db_path,
        run_id,
        project_id,
        profile,
        allowed_tools,
        chrono::Duration::hours(12),
    )
}

fn create_agent_mcp_session_with_ttl(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    profile: &crate::models::AgentProfile,
    allowed_tools: &[String],
    ttl: chrono::Duration,
) -> Result<(crate::models::McpCapabilitySession, String), String> {
    let session_id = Uuid::new_v4().to_string();
    let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
    let created_at = now_iso();
    let expires_at = (Utc::now() + ttl).to_rfc3339();
    let session = crate::models::McpCapabilitySession {
        session_id: session_id.clone(),
        run_id: run_id.to_string(),
        project_id: project_id.to_string(),
        profile_id: profile.id.clone(),
        allowed_tools: allowed_tools.to_vec(),
        read_scopes: profile.read_scopes.clone(),
        write_scopes: profile.write_scopes.clone(),
        expires_at: expires_at.clone(),
    };
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    conn.execute(
        "INSERT INTO agent_mcp_sessions (
           session_id,token_hash,run_id,project_id,profile_id,allowed_tools_json,
           read_scopes_json,write_scopes_json,expires_at,created_at
         ) VALUES (?1,?2,?3,?4,?5,?6,?7,?8,?9,?10)",
        params![
            session.session_id,
            agent_mcp_token_hash(&token),
            session.run_id,
            session.project_id,
            session.profile_id,
            serde_json::to_string(&session.allowed_tools).map_err(|error| error.to_string())?,
            serde_json::to_string(&session.read_scopes).map_err(|error| error.to_string())?,
            serde_json::to_string(&session.write_scopes).map_err(|error| error.to_string())?,
            expires_at,
            created_at,
        ],
    )
    .map_err(|error| error.to_string())?;
    Ok((session, token))
}

pub(crate) fn validate_agent_mcp_session(
    db_path: &Path,
    token: &str,
) -> Result<crate::models::McpCapabilitySession, String> {
    if token.len() != 64 || !token.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        return Err("agent.mcp.session_invalid".to_string());
    }
    let conn = Connection::open(db_path).map_err(|error| error.to_string())?;
    let token_hash = agent_mcp_token_hash(token);
    let raw = conn
        .query_row(
            "SELECT session_id,run_id,project_id,profile_id,allowed_tools_json,
                    read_scopes_json,write_scopes_json,expires_at
             FROM agent_mcp_sessions WHERE token_hash=?1",
            params![token_hash],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, String>(2)?,
                    row.get::<_, String>(3)?,
                    row.get::<_, String>(4)?,
                    row.get::<_, String>(5)?,
                    row.get::<_, String>(6)?,
                    row.get::<_, String>(7)?,
                ))
            },
        )
        .optional()
        .map_err(|error| error.to_string())?
        .ok_or_else(|| "agent.mcp.session_invalid".to_string())?;
    let expires = chrono::DateTime::parse_from_rfc3339(&raw.7)
        .map_err(|_| "agent.mcp.session_invalid".to_string())?;
    if expires <= Utc::now() {
        return Err("agent.mcp.session_expired".to_string());
    }
    Ok(crate::models::McpCapabilitySession {
        session_id: raw.0,
        run_id: raw.1,
        project_id: raw.2,
        profile_id: raw.3,
        allowed_tools: serde_json::from_str(&raw.4)
            .map_err(|_| "agent.mcp.session_invalid".to_string())?,
        read_scopes: serde_json::from_str(&raw.5)
            .map_err(|_| "agent.mcp.session_invalid".to_string())?,
        write_scopes: serde_json::from_str(&raw.6)
            .map_err(|_| "agent.mcp.session_invalid".to_string())?,
        expires_at: raw.7,
    })
}

pub(crate) fn delete_agent_mcp_session(db_path: &Path, session_id: &str) {
    if let Ok(conn) = Connection::open(db_path) {
        let _ = conn.execute(
            "DELETE FROM agent_mcp_sessions WHERE session_id=?1",
            params![session_id],
        );
    }
}

#[cfg(test)]
mod agent_mcp_session_tests {
    use super::*;

    fn fixture() -> (PathBuf, crate::models::AgentProfile) {
        let root = std::env::temp_dir().join(format!(
            "latotex-agent-mcp-session-{}",
            Uuid::new_v4().simple()
        ));
        std::fs::create_dir_all(&root).unwrap();
        let db_path = root.join("latotex.sqlite3");
        initialize_database(&db_path).unwrap();
        let profile = get_agent_profile(&db_path, "builtin-researcher")
            .unwrap()
            .unwrap();
        (db_path, profile)
    }

    #[test]
    fn capability_token_is_project_bound_and_revocable() {
        let (db_path, profile) = fixture();
        let (session, token) = create_agent_mcp_session(
            &db_path,
            "run-1",
            "project-a",
            &profile,
            &["workspace_read".to_string()],
        )
        .unwrap();
        let validated = validate_agent_mcp_session(&db_path, &token).unwrap();
        assert_eq!(validated.project_id, "project-a");
        assert_eq!(validated.allowed_tools, vec!["workspace_read"]);

        delete_agent_mcp_session(&db_path, &session.session_id);
        assert_eq!(
            validate_agent_mcp_session(&db_path, &token).unwrap_err(),
            "agent.mcp.session_invalid"
        );
        let _ = std::fs::remove_dir_all(db_path.parent().unwrap());
    }

    #[test]
    fn expired_capability_token_is_rejected() {
        let (db_path, profile) = fixture();
        let (session, token) = create_agent_mcp_session(
            &db_path,
            "run-expired",
            "project-a",
            &profile,
            &["knowledge_search".to_string()],
        )
        .unwrap();
        let conn = Connection::open(&db_path).unwrap();
        conn.execute(
            "UPDATE agent_mcp_sessions SET expires_at=?1 WHERE session_id=?2",
            params![(Utc::now() - chrono::Duration::minutes(1)).to_rfc3339(), session.session_id],
        )
        .unwrap();
        assert_eq!(
            validate_agent_mcp_session(&db_path, &token).unwrap_err(),
            "agent.mcp.session_expired"
        );
        drop(conn);
        let _ = std::fs::remove_dir_all(db_path.parent().unwrap());
    }
}
