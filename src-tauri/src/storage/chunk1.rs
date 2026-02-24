pub fn initialize_database(db_path: &Path) -> Result<(), String> {
    if let Some(parent) = db_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS projects (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            root_path TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS swarm_events (
            seq INTEGER PRIMARY KEY AUTOINCREMENT,
            id TEXT NOT NULL,
            run_id TEXT NOT NULL,
            project_id TEXT NOT NULL,
            role TEXT NOT NULL,
            kind TEXT NOT NULL,
            payload TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS compile_jobs (
            id TEXT PRIMARY KEY,
            project_id TEXT NOT NULL,
            main_file TEXT NOT NULL,
            status TEXT NOT NULL,
            diagnostics TEXT NOT NULL,
            duration_ms INTEGER NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_cache (
            cache_key TEXT PRIMARY KEY,
            protocol_id TEXT NOT NULL,
            model_name TEXT NOT NULL,
            response TEXT NOT NULL,
            created_at TEXT NOT NULL,
            expires_at TEXT NOT NULL,
            hit_count INTEGER NOT NULL DEFAULT 0
        );

        CREATE TABLE IF NOT EXISTS provider_profiles (
            provider TEXT PRIMARY KEY,
            base_url TEXT NOT NULL,
            api_key_ref TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_protocols (
            id TEXT PRIMARY KEY,
            display_name TEXT NOT NULL,
            base_url TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS model_catalog (
            id TEXT PRIMARY KEY,
            protocol_id TEXT NOT NULL,
            display_name TEXT NOT NULL,
            request_name TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_bindings (
            role TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            model TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            active_project_id TEXT,
            ui_prefs_json TEXT
        );

        CREATE TABLE IF NOT EXISTS secure_model_secrets (
            model_id TEXT PRIMARY KEY,
            nonce_b64 TEXT NOT NULL,
            ciphertext_b64 TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE UNIQUE INDEX IF NOT EXISTS idx_projects_root_path ON projects(root_path);
        ",
    )
    .map_err(|e| e.to_string())?;

    ensure_ui_prefs_column(&conn)?;
    ensure_agent_binding_model_id_column(&conn)?;

    conn.execute(
        "INSERT OR IGNORE INTO app_settings (id, active_project_id, ui_prefs_json) VALUES (1, NULL, NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;

    migrate_legacy_provider_profiles(&conn)?;
    seed_default_protocols(&conn)?;
    prune_seeded_model_defaults(&conn)?;
    backfill_legacy_agent_bindings(&conn)?;
    seed_default_providers(&conn)?;
    Ok(())
}

fn ensure_ui_prefs_column(conn: &Connection) -> Result<(), String> {
    match conn.execute("ALTER TABLE app_settings ADD COLUMN ui_prefs_json TEXT", []) {
        Ok(_) => Ok(()),
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("duplicate column name")
                || message.contains("already exists")
                || message.contains("no such table")
            {
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn ensure_agent_binding_model_id_column(conn: &Connection) -> Result<(), String> {
    match conn.execute("ALTER TABLE agent_bindings ADD COLUMN model_id TEXT", []) {
        Ok(_) => Ok(()),
        Err(error) => {
            let message = error.to_string().to_lowercase();
            if message.contains("duplicate column name")
                || message.contains("already exists")
                || message.contains("no such table")
            {
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn protocol_display_name(protocol_id: &str) -> String {
    match protocol_id {
        "openai-compatible" => "OpenAI-Compatible".to_string(),
        "anthropic" => "Anthropic".to_string(),
        "gemini" => "Gemini".to_string(),
        other => other.to_string(),
    }
}

fn default_base_url(protocol_id: &str) -> &'static str {
    match protocol_id {
        "openai-compatible" => "https://api.openai.com/v1",
        "anthropic" => "https://api.anthropic.com",
        "gemini" => "https://generativelanguage.googleapis.com",
        _ => "",
    }
}

fn legacy_provider_to_protocol(provider: &str) -> String {
    match provider {
        "openai" => "openai-compatible".to_string(),
        "anthropic" => "anthropic".to_string(),
        "gemini" => "gemini".to_string(),
        other => other.to_string(),
    }
}

fn normalize_model_key(input: &str) -> String {
    let mut output = String::new();
    let mut previous_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            previous_dash = false;
        } else if !previous_dash {
            output.push('-');
            previous_dash = true;
        }
    }
    output.trim_matches('-').to_string()
}

fn migrate_legacy_provider_profiles(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT provider, base_url FROM provider_profiles")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (provider, base_url) = row.map_err(|e| e.to_string())?;
        let protocol_id = legacy_provider_to_protocol(&provider);
        conn.execute(
            "INSERT OR IGNORE INTO model_protocols (id, display_name, base_url) VALUES (?1, ?2, ?3)",
            params![protocol_id, protocol_display_name(&protocol_id), base_url],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn seed_default_protocols(conn: &Connection) -> Result<(), String> {
    let defaults = [
        ("openai-compatible", "OpenAI-Compatible", "https://api.openai.com/v1"),
        ("anthropic", "Anthropic", "https://api.anthropic.com"),
        ("gemini", "Gemini", "https://generativelanguage.googleapis.com"),
    ];

    for (id, display_name, base_url) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO model_protocols (id, display_name, base_url) VALUES (?1, ?2, ?3)",
            params![id, display_name, base_url],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn prune_seeded_model_defaults(conn: &Connection) -> Result<(), String> {
    let seeded_ids = [
        "openai-gpt-4-1",
        "openai-gpt-4-1-mini",
        "anthropic-claude-3-7-sonnet-latest",
        "gemini-2-0-flash",
    ];

    let mut stmt = conn
        .prepare("SELECT id FROM model_catalog")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(0))
        .map_err(|e| e.to_string())?;

    let mut ids = Vec::new();
    for row in rows {
        ids.push(row.map_err(|e| e.to_string())?);
    }

    if ids.is_empty() {
        return Ok(());
    }

    let all_seeded = ids.iter().all(|id| seeded_ids.contains(&id.as_str()));
    if !all_seeded {
        return Ok(());
    }

    conn.execute("DELETE FROM model_catalog", [])
        .map_err(|e| e.to_string())?;
    conn.execute("DELETE FROM agent_bindings", [])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn backfill_legacy_agent_bindings(conn: &Connection) -> Result<(), String> {
    let mut stmt = conn
        .prepare("SELECT role, provider, model, COALESCE(model_id, '') FROM agent_bindings")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                row.get::<_, String>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|e| e.to_string())?;

    for row in rows {
        let (role, provider, model, model_id) = row.map_err(|e| e.to_string())?;
        if !model_id.trim().is_empty() {
            continue;
        }

        let protocol_id = legacy_provider_to_protocol(&provider);
        let generated_model_id = format!("{protocol_id}-{}", normalize_model_key(&model));

        conn.execute(
            "INSERT OR IGNORE INTO model_protocols (id, display_name, base_url) VALUES (?1, ?2, ?3)",
            params![
                protocol_id,
                protocol_display_name(&protocol_id),
                default_base_url(&protocol_id)
            ],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR IGNORE INTO model_catalog (id, protocol_id, display_name, request_name)
             VALUES (?1, ?2, ?3, ?4)",
            params![generated_model_id, protocol_id, model, model],
        )
        .map_err(|e| e.to_string())?;

        conn.execute(
            "UPDATE agent_bindings SET provider = ?1, model = ?2, model_id = ?3 WHERE role = ?4",
            params![protocol_id, model, generated_model_id, role],
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

fn seed_default_providers(conn: &Connection) -> Result<(), String> {
    let defaults = [
        ("openai", "https://api.openai.com/v1"),
        ("anthropic", "https://api.anthropic.com"),
        ("gemini", "https://generativelanguage.googleapis.com"),
    ];

    for (provider, base_url) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO provider_profiles (provider, base_url, api_key_ref) VALUES (?1, ?2, ?3)",
            params![provider, base_url, format!("provider:{provider}")],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn create_project(db_path: &Path, projects_dir: &Path, name: &str) -> Result<ProjectSnapshot, String> {
    let project_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let root_dir = projects_dir.join(&project_id);
    fs::create_dir_all(&root_dir).map_err(|e| e.to_string())?;
    ensure_workspace_bootstrap_files(&root_dir)?;

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
        params![project_id, name.trim(), root_dir.to_string_lossy().to_string(), now, now],
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE app_settings SET active_project_id = ?1 WHERE id = 1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;

    project_snapshot(db_path, &project_id)
}

