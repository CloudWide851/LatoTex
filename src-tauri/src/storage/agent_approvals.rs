use crate::models::{
    AgentApprovalCapability, AgentApprovalRequest, AgentExecuteRequest, AgentPermissionGrant,
};

#[derive(Debug, Clone)]
pub struct AgentApprovalContext {
    pub approval: AgentApprovalRequest,
    pub request_json: String,
    pub workflow_json: String,
}

fn approval_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentApprovalRequest> {
    let capabilities_json: String = row.get(4)?;
    let capabilities = serde_json::from_str::<Vec<AgentApprovalCapability>>(&capabilities_json)
        .unwrap_or_default();
    Ok(AgentApprovalRequest {
        approval_id: row.get(0)?,
        run_id: row.get(1)?,
        project_id: row.get(2)?,
        workflow_id: row.get(3)?,
        capabilities,
        status: row.get(5)?,
        created_at: row.get(6)?,
        expires_at: row.get(7)?,
    })
}

pub fn insert_agent_approval(
    db_path: &Path,
    run_id: &str,
    input: &AgentExecuteRequest,
    workflow_json: &str,
    capabilities: &[AgentApprovalCapability],
) -> Result<AgentApprovalRequest, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let approval_id = Uuid::new_v4().to_string();
    let created_at = now_iso();
    let expires_at = (Utc::now() + chrono::Duration::minutes(10)).to_rfc3339();
    let request_json = serde_json::to_string(input).map_err(|e| e.to_string())?;
    let capabilities_json = serde_json::to_string(capabilities).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO agent_approval_requests (
            approval_id, run_id, project_id, workflow_id, request_json, workflow_json,
            capabilities_json, status, decision, created_at, expires_at, resolved_at
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, 'pending', NULL, ?8, ?9, NULL)",
        params![
            approval_id,
            run_id,
            input.project_id,
            input.workflow_id,
            request_json,
            workflow_json,
            capabilities_json,
            created_at,
            expires_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(AgentApprovalRequest {
        approval_id,
        run_id: run_id.to_string(),
        project_id: input.project_id.clone(),
        workflow_id: input.workflow_id.clone(),
        capabilities: capabilities.to_vec(),
        status: "pending".to_string(),
        created_at,
        expires_at,
    })
}

pub fn list_pending_agent_approvals(
    db_path: &Path,
    project_id: Option<&str>,
) -> Result<Vec<AgentApprovalRequest>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut sql = String::from(
        "SELECT approval_id, run_id, project_id, workflow_id, capabilities_json,
                status, created_at, expires_at
         FROM agent_approval_requests WHERE status = 'pending'",
    );
    let mut values = Vec::<rusqlite::types::Value>::new();
    if let Some(project_id) = project_id.map(str::trim).filter(|value| !value.is_empty()) {
        sql.push_str(" AND project_id = ?1");
        values.push(project_id.to_string().into());
    }
    sql.push_str(" ORDER BY created_at ASC LIMIT 32");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values.iter()), approval_from_row)
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn get_agent_approval_context(
    db_path: &Path,
    approval_id: &str,
) -> Result<Option<AgentApprovalContext>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT approval_id, run_id, project_id, workflow_id, capabilities_json,
                status, created_at, expires_at, request_json, workflow_json
         FROM agent_approval_requests WHERE approval_id = ?1 LIMIT 1",
        params![approval_id],
        |row| {
            Ok(AgentApprovalContext {
                approval: approval_from_row(row)?,
                request_json: row.get(8)?,
                workflow_json: row.get(9)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn get_pending_agent_approval_context_by_run(
    db_path: &Path,
    run_id: &str,
) -> Result<Option<AgentApprovalContext>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT approval_id, run_id, project_id, workflow_id, capabilities_json,
                status, created_at, expires_at, request_json, workflow_json
         FROM agent_approval_requests
         WHERE run_id = ?1 AND status = 'pending' LIMIT 1",
        params![run_id],
        |row| {
            Ok(AgentApprovalContext {
                approval: approval_from_row(row)?,
                request_json: row.get(8)?,
                workflow_json: row.get(9)?,
            })
        },
    )
    .optional()
    .map_err(|e| e.to_string())
}

pub fn resolve_agent_approval(
    db_path: &Path,
    approval_id: &str,
    decision: &str,
) -> Result<AgentApprovalContext, String> {
    if !matches!(decision, "allow_once" | "allow_project" | "deny") {
        return Err("agent.approval.invalid_decision".to_string());
    }
    let context = get_agent_approval_context(db_path, approval_id)?
        .ok_or_else(|| "agent.approval.not_found".to_string())?;
    if context.approval.status != "pending" {
        return Err("agent.approval.already_resolved".to_string());
    }
    if context.approval.expires_at <= now_iso() {
        expire_agent_approval(db_path, approval_id)?;
        return Err("agent.approval.expired".to_string());
    }
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let resolved_at = now_iso();
    let changed = tx
        .execute(
            "UPDATE agent_approval_requests
             SET status = 'resolved', decision = ?2, resolved_at = ?3
             WHERE approval_id = ?1 AND status = 'pending'",
            params![approval_id, decision, resolved_at],
        )
        .map_err(|e| e.to_string())?;
    if changed != 1 {
        return Err("agent.approval.already_resolved".to_string());
    }
    if decision == "allow_project" {
        for capability in &context.approval.capabilities {
            tx.execute(
                "INSERT INTO agent_permission_grants (
                    grant_id, project_id, capability, resource, created_at
                 ) VALUES (?1, ?2, ?3, ?4, ?5)
                 ON CONFLICT(project_id, capability, resource) DO NOTHING",
                params![
                    Uuid::new_v4().to_string(),
                    context.approval.project_id,
                    capability.capability,
                    capability.resource,
                    resolved_at,
                ],
            )
            .map_err(|e| e.to_string())?;
        }
    }
    tx.commit().map_err(|e| e.to_string())?;
    Ok(context)
}

pub fn has_agent_permission_grant(
    db_path: &Path,
    project_id: &str,
    capability: &str,
    resource: &str,
) -> Result<bool, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT 1 FROM agent_permission_grants
         WHERE project_id = ?1 AND capability = ?2 AND resource IN (?3, '*') LIMIT 1",
        params![project_id, capability, resource],
        |_| Ok(true),
    )
    .optional()
    .map(|value| value.unwrap_or(false))
    .map_err(|e| e.to_string())
}

pub fn list_agent_permission_grants(
    db_path: &Path,
    project_id: Option<&str>,
) -> Result<Vec<AgentPermissionGrant>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut sql = String::from(
        "SELECT grant_id, project_id, capability, resource, created_at
         FROM agent_permission_grants WHERE 1 = 1",
    );
    let mut values = Vec::<rusqlite::types::Value>::new();
    if let Some(project_id) = project_id.map(str::trim).filter(|value| !value.is_empty()) {
        sql.push_str(" AND project_id = ?1");
        values.push(project_id.to_string().into());
    }
    sql.push_str(" ORDER BY created_at DESC LIMIT 128");
    let mut stmt = conn.prepare(&sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(rusqlite::params_from_iter(values.iter()), |row| {
            Ok(AgentPermissionGrant {
                grant_id: row.get(0)?,
                project_id: row.get(1)?,
                capability: row.get(2)?,
                resource: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    rows.collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())
}

pub fn revoke_agent_permission_grant(db_path: &Path, grant_id: &str) -> Result<bool, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM agent_permission_grants WHERE grant_id = ?1",
        params![grant_id],
    )
    .map(|changed| changed == 1)
    .map_err(|e| e.to_string())
}

pub fn cancel_pending_agent_approval(db_path: &Path, run_id: &str) -> Result<bool, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE agent_approval_requests
         SET status = 'resolved', decision = 'cancelled', resolved_at = ?2
         WHERE run_id = ?1 AND status = 'pending'",
        params![run_id, now_iso()],
    )
    .map(|changed| changed == 1)
    .map_err(|e| e.to_string())
}

pub fn expire_agent_approval(db_path: &Path, approval_id: &str) -> Result<bool, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE agent_approval_requests
         SET status = 'expired', decision = 'expired', resolved_at = ?2
         WHERE approval_id = ?1 AND status = 'pending'",
        params![approval_id, now_iso()],
    )
    .map(|changed| changed == 1)
    .map_err(|e| e.to_string())
}

pub fn expire_pending_agent_approvals(db_path: &Path) -> Result<Vec<AgentApprovalContext>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let now = now_iso();
    let approval_ids = {
        let mut stmt = conn
            .prepare(
                "SELECT approval_id FROM agent_approval_requests
                 WHERE status = 'pending' AND expires_at <= ?1
                 ORDER BY expires_at ASC LIMIT 64",
            )
            .map_err(|e| e.to_string())?;
        let rows = stmt
            .query_map(params![now], |row| row.get::<_, String>(0))
            .map_err(|e| e.to_string())?;
        rows.collect::<Result<Vec<_>, _>>()
            .map_err(|e| e.to_string())?
    };
    drop(conn);

    let mut expired = Vec::new();
    for approval_id in approval_ids {
        let Some(context) = get_agent_approval_context(db_path, &approval_id)? else {
            continue;
        };
        if expire_agent_approval(db_path, &approval_id)? {
            expired.push(context);
        }
    }
    Ok(expired)
}

#[cfg(test)]
mod agent_approval_tests {
    use super::*;

    fn temp_db_path() -> PathBuf {
        std::env::temp_dir().join(format!("latotex-agent-approval-{}.sqlite3", Uuid::new_v4()))
    }

    fn request() -> AgentExecuteRequest {
        AgentExecuteRequest {
            project_id: "project-1".to_string(),
            workflow_id: "chat.general".to_string(),
            callsite: "chat.workspace".to_string(),
            prompt: "research".to_string(),
            context_refs: vec![],
            model_override: None,
            bypass_cache: false,
            team_mode: None,
            harness_profile_id: None,
        }
    }

    #[test]
    fn approval_resolution_is_single_use_and_project_scoped() {
        let db_path = temp_db_path();
        initialize_database(&db_path).unwrap();
        insert_agent_run(&db_path, "run-1", &request()).unwrap();
        let capability = AgentApprovalCapability {
            capability: "python".to_string(),
            resource: "managed".to_string(),
        };
        let approval = insert_agent_approval(
            &db_path,
            "run-1",
            &request(),
            "{}",
            std::slice::from_ref(&capability),
        )
        .unwrap();
        resolve_agent_approval(&db_path, &approval.approval_id, "allow_project").unwrap();
        assert!(has_agent_permission_grant(&db_path, "project-1", "python", "managed").unwrap());
        assert!(!has_agent_permission_grant(&db_path, "project-2", "python", "managed").unwrap());
        assert!(resolve_agent_approval(&db_path, &approval.approval_id, "deny").is_err());
        let _ = fs::remove_file(db_path);
    }
}
