pub fn append_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    role: &str,
    kind: &str,
    payload: Value,
) -> Result<SwarmEvent, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let id = Uuid::new_v4().to_string();
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let created_at = now_iso();

    conn.execute(
        "INSERT INTO swarm_events (id, run_id, project_id, role, kind, payload, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![id, run_id, project_id, role, kind, payload_json, created_at],
    )
    .map_err(|e| e.to_string())?;

    let seq = conn.last_insert_rowid();
    Ok(SwarmEvent {
        seq,
        id,
        run_id: run_id.to_string(),
        project_id: project_id.to_string(),
        role: role.to_string(),
        kind: kind.to_string(),
        payload,
        created_at,
    })
}

pub fn events_since(db_path: &Path, query: EventQuery) -> Result<EventBatch, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let cursor = query.cursor.unwrap_or(0);
    let limit = query.limit.unwrap_or(200).min(1000) as i64;
    let mut stmt = conn
        .prepare(
            "SELECT seq, id, run_id, project_id, role, kind, payload, created_at
             FROM swarm_events
             WHERE seq > ?1
             ORDER BY seq ASC
             LIMIT ?2",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![cursor, limit], |row| {
            let payload_raw: String = row.get(6)?;
            let payload = serde_json::from_str::<Value>(&payload_raw).unwrap_or(Value::Null);
            Ok(SwarmEvent {
                seq: row.get(0)?,
                id: row.get(1)?,
                run_id: row.get(2)?,
                project_id: row.get(3)?,
                role: row.get(4)?,
                kind: row.get(5)?,
                payload,
                created_at: row.get(7)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut events = Vec::new();
    let mut next_cursor = cursor;
    for row in rows {
        let event = row.map_err(|e| e.to_string())?;
        next_cursor = event.seq;
        events.push(event);
    }

    Ok(EventBatch { next_cursor, events })
}

const FIXED_AGENT_ROLES: [&str; 7] = [
    "plan",
    "task",
    "explore",
    "web_search",
    "review",
    "ephemeral",
    "git_summary",
];

fn normalize_agent_bindings(bindings: Vec<AgentModelBinding>) -> Vec<AgentModelBinding> {
    let mut by_role = std::collections::HashMap::<String, String>::new();
    for binding in bindings {
        by_role.insert(binding.role, binding.model_id);
    }
    FIXED_AGENT_ROLES
        .iter()
        .map(|role| AgentModelBinding {
            role: (*role).to_string(),
            model_id: by_role.get(*role).cloned().unwrap_or_default(),
        })
        .collect()
}

pub fn load_settings(db_path: &Path, runtime_root: &Path) -> Result<AppSettings, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let (active_project_id, ui_prefs_json): (Option<String>, Option<String>) = conn
        .query_row(
            "SELECT active_project_id, ui_prefs_json FROM app_settings WHERE id = 1",
            [],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|e| e.to_string())?;
    let ui_prefs = match ui_prefs_json {
        Some(raw) => serde_json::from_str::<UiPrefs>(&raw).ok(),
        None => None,
    };

    let mut model_catalog = Vec::new();
    let mut catalog_stmt = conn
        .prepare(
            "SELECT id, protocol_id, display_name, request_name
             FROM model_catalog ORDER BY protocol_id, display_name",
        )
        .map_err(|e| e.to_string())?;
    let catalog_rows = catalog_stmt
        .query_map([], |row| {
            Ok(ModelCatalogItem {
                id: row.get(0)?,
                protocol_id: row.get(1)?,
                display_name: row.get(2)?,
                request_name: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;
    for row in catalog_rows {
        model_catalog.push(row.map_err(|e| e.to_string())?);
    }

    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    };
    let protocol_has_model_key = model_catalog.iter().fold(
        std::collections::HashMap::<String, bool>::new(),
        |mut acc, model| {
            let has_key = secure::get_model_api_key(&secure_context, &model.id)
                .ok()
                .and_then(|value| value.api_key)
                .map(|value| !value.trim().is_empty())
                .unwrap_or(false);
            if has_key {
                acc.insert(model.protocol_id.clone(), true);
            }
            acc
        },
    );

    let mut model_protocols = Vec::new();
    let mut protocol_stmt = conn
        .prepare("SELECT id, display_name, base_url FROM model_protocols ORDER BY id")
        .map_err(|e| e.to_string())?;
    let protocol_rows = protocol_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in protocol_rows {
        let (id, display_name, base_url) = row.map_err(|e| e.to_string())?;
        let model_key_exists = protocol_has_model_key.get(&id).copied().unwrap_or(false);
        model_protocols.push(ModelProtocol {
            api_key_set: model_key_exists,
            id,
            display_name,
            base_url,
        });
    }

    let mut agent_bindings = Vec::new();
    let mut binding_stmt = conn
        .prepare("SELECT role, provider, model, COALESCE(model_id, '') FROM agent_bindings ORDER BY role")
        .map_err(|e| e.to_string())?;
    let binding_rows = binding_stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in binding_rows {
        let (role, provider, model, model_id) = row.map_err(|e| e.to_string())?;
        let resolved_model_id = if model_id.trim().is_empty() {
            let protocol_id = legacy_provider_to_protocol(&provider);
            let generated_model_id = upsert_catalog_for_legacy_binding(
                &conn,
                &protocol_id,
                &model,
                &model,
            )?;
            conn.execute(
                "UPDATE agent_bindings SET provider = ?1, model = ?2, model_id = ?3 WHERE role = ?4",
                params![protocol_id, model, generated_model_id, role],
            )
            .map_err(|e| e.to_string())?;
            generated_model_id
        } else {
            model_id
        };

        agent_bindings.push(AgentModelBinding {
            role,
            model_id: resolved_model_id,
        });
    }

    let agent_bindings = normalize_agent_bindings(agent_bindings);

    Ok(AppSettings {
        active_project_id,
        model_protocols,
        model_catalog,
        agent_bindings,
        ui_prefs,
    })
}

pub fn update_settings(
    db_path: &Path,
    runtime_root: &Path,
    input: SettingsUpdateInput,
) -> Result<AppSettings, String> {
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let tx = conn.transaction().map_err(|e| e.to_string())?;

    tx.execute(
        "UPDATE app_settings SET active_project_id = ?1, ui_prefs_json = ?2 WHERE id = 1",
        params![
            input.active_project_id,
            input
                .ui_prefs
                .as_ref()
                .map(|value| serde_json::to_string(value).unwrap_or_else(|_| "null".to_string()))
        ],
    )
    .map_err(|e| e.to_string())?;

    update_model_protocols(&tx, input.model_protocols)?;
    update_model_catalog(&tx, db_path, runtime_root, input.model_catalog)?;
    update_agent_bindings(&tx, input.agent_bindings)?;
    tx.commit().map_err(|e| e.to_string())?;
    load_settings(db_path, runtime_root)
}

fn update_model_protocols(conn: &Connection, protocols: Vec<ModelProtocolInput>) -> Result<(), String> {
    conn.execute("DELETE FROM model_protocols", [])
        .map_err(|e| e.to_string())?;
    conn.execute(
        "DELETE FROM provider_profiles WHERE api_key_ref LIKE 'protocol:%'",
        [],
    )
    .map_err(|e| e.to_string())?;

    for protocol in protocols {
        conn.execute(
            "INSERT INTO model_protocols (id, display_name, base_url)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(id) DO UPDATE SET display_name = excluded.display_name, base_url = excluded.base_url",
            params![&protocol.id, &protocol.display_name, &protocol.base_url],
        )
        .map_err(|e| e.to_string())?;

        let legacy_provider = match protocol.id.as_str() {
            "openai-compatible" => "openai".to_string(),
            "anthropic" => "anthropic".to_string(),
            "gemini" => "gemini".to_string(),
            other => other.to_string(),
        };

        conn.execute(
            "INSERT INTO provider_profiles (provider, base_url, api_key_ref)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(provider) DO UPDATE SET base_url = excluded.base_url, api_key_ref = excluded.api_key_ref",
            params![
                legacy_provider,
                &protocol.base_url,
                format!("protocol:{}", protocol.id)
            ],
        )
        .map_err(|e| e.to_string())?;

    }
    Ok(())
}

fn update_model_catalog(
    conn: &Connection,
    db_path: &Path,
    runtime_root: &Path,
    models: Vec<ModelCatalogItemInput>,
) -> Result<(), String> {
    let incoming_ids: std::collections::HashSet<String> =
        models.iter().map(|item| item.id.clone()).collect();
    let mut existing_stmt = conn
        .prepare("SELECT id FROM model_catalog")
        .map_err(|e| e.to_string())?;
    let existing_rows = existing_stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;
    for row in existing_rows {
        let existing_id = row.map_err(|e| e.to_string())?;
        if !incoming_ids.contains(&existing_id) {
            let secure_context = secure::SecureStorageContext {
                db_path: db_path.to_path_buf(),
                runtime_root: runtime_root.to_path_buf(),
            };
            secure::delete_model_api_key(&secure_context, &existing_id)?;
        }
    }

    conn.execute("DELETE FROM model_catalog", [])
        .map_err(|e| e.to_string())?;
    for model in models {
        conn.execute(
            "INSERT INTO model_catalog (id, protocol_id, display_name, request_name)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(id) DO UPDATE SET protocol_id = excluded.protocol_id, display_name = excluded.display_name, request_name = excluded.request_name",
            params![model.id, model.protocol_id, model.display_name, model.request_name],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn update_agent_bindings(conn: &Connection, bindings: Vec<AgentModelBinding>) -> Result<(), String> {
    conn.execute("DELETE FROM agent_bindings", [])
        .map_err(|e| e.to_string())?;

    for binding in bindings {
        let model_id = binding.model_id.trim().to_string();
        if model_id.is_empty() {
            continue;
        }
        let resolved: Option<(String, String)> = conn
            .query_row(
                "SELECT protocol_id, request_name FROM model_catalog WHERE id = ?1",
                params![&model_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .optional()
            .map_err(|e| e.to_string())?;
        let Some((protocol_id, request_name)) = resolved else {
            continue;
        };

        conn.execute(
            "INSERT INTO agent_bindings (role, provider, model, model_id)
             VALUES (?1, ?2, ?3, ?4)
             ON CONFLICT(role) DO UPDATE SET provider = excluded.provider, model = excluded.model, model_id = excluded.model_id",
            params![binding.role, protocol_id, request_name, model_id],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn upsert_catalog_for_legacy_binding(
    conn: &Connection,
    protocol_id: &str,
    display_name: &str,
    request_name: &str,
) -> Result<String, String> {
    let model_id = format!("{protocol_id}-{}", normalize_model_key(request_name));
    conn.execute(
        "INSERT OR IGNORE INTO model_catalog (id, protocol_id, display_name, request_name) VALUES (?1, ?2, ?3, ?4)",
        params![model_id, protocol_id, display_name, request_name],
    )
    .map_err(|e| e.to_string())?;
    Ok(model_id)
}

pub fn resolve_agent_model(
    db_path: &Path,
    role: &str,
    model_override: Option<&str>,
) -> Result<(String, String, String, String), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let model_id = if let Some(override_id) = model_override {
        let trimmed = override_id.trim();
        if trimmed.is_empty() {
            None
        } else {
            Some(trimmed.to_string())
        }
    } else {
        None
    };

    let resolved_model_id = match model_id {
        Some(id) => id,
        None => conn
            .query_row(
                "SELECT model_id FROM agent_bindings WHERE role = ?1",
                params![role],
                |row| row.get::<_, String>(0),
            )
            .map_err(|_| format!("No model binding configured for role: {role}"))?,
    };

    let (protocol_id, model_name): (String, String) = conn
        .query_row(
            "SELECT protocol_id, request_name FROM model_catalog WHERE id = ?1",
            params![resolved_model_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| "Configured model is missing from model catalog".to_string())?;

    let base_url = conn
        .query_row(
            "SELECT base_url FROM model_protocols WHERE id = ?1",
            params![&protocol_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| "Protocol configuration not found for model".to_string())?;

    Ok((protocol_id, base_url, model_name, resolved_model_id))
}

pub fn resolve_model_test_connection(
    db_path: &Path,
    runtime_root: &Path,
    model_id: &str,
) -> Result<(String, String, String, Option<String>), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let trimmed_model_id = model_id.trim();
    if trimmed_model_id.is_empty() {
        return Err("Model id is required".to_string());
    }

    let (protocol_id, model_name): (String, String) = conn
        .query_row(
            "SELECT protocol_id, request_name FROM model_catalog WHERE id = ?1",
            params![trimmed_model_id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .map_err(|_| format!("Model not found: {trimmed_model_id}"))?;

    let base_url = conn
        .query_row(
            "SELECT base_url FROM model_protocols WHERE id = ?1",
            params![&protocol_id],
            |row| row.get::<_, String>(0),
        )
        .map_err(|_| format!("Protocol not found for model: {trimmed_model_id}"))?;

    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    };
    let api_key = secure::get_model_api_key(&secure_context, trimmed_model_id)?.api_key;
    Ok((protocol_id, base_url, model_name, api_key))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn normalize_agent_bindings_fills_fixed_roles() {
        let bindings = vec![
            AgentModelBinding {
                role: "task".to_string(),
                model_id: "model-task".to_string(),
            },
            AgentModelBinding {
                role: "git_summary".to_string(),
                model_id: "model-git".to_string(),
            },
        ];
        let normalized = normalize_agent_bindings(bindings);
        assert_eq!(normalized.len(), FIXED_AGENT_ROLES.len());
        let task = normalized.iter().find(|item| item.role == "task");
        assert_eq!(task.map(|item| item.model_id.as_str()), Some("model-task"));
        let git = normalized.iter().find(|item| item.role == "git_summary");
        assert_eq!(git.map(|item| item.model_id.as_str()), Some("model-git"));
        let review = normalized.iter().find(|item| item.role == "review");
        assert_eq!(review.map(|item| item.model_id.as_str()), Some(""));
    }
}

