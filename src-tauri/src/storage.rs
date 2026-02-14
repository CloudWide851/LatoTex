use crate::models::{
    Ack, AgentModelBinding, AppSettings, CompileRecord, CompileRecordInput, EventBatch, EventQuery,
    FileReadResponse, FileWriteInput, ProjectSnapshot, ProjectSummary, ProviderConfig,
    ProviderConfigInput, ResourceNode, SettingsUpdateInput, SwarmEvent,
};
use crate::secure;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use uuid::Uuid;

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

        CREATE TABLE IF NOT EXISTS provider_profiles (
            provider TEXT PRIMARY KEY,
            base_url TEXT NOT NULL,
            api_key_ref TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS agent_bindings (
            role TEXT PRIMARY KEY,
            provider TEXT NOT NULL,
            model TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS app_settings (
            id INTEGER PRIMARY KEY CHECK (id = 1),
            active_project_id TEXT
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR IGNORE INTO app_settings (id, active_project_id) VALUES (1, NULL)",
        [],
    )
    .map_err(|e| e.to_string())?;

    seed_default_bindings(&conn)?;
    seed_default_providers(&conn)?;
    Ok(())
}

fn seed_default_bindings(conn: &Connection) -> Result<(), String> {
    let defaults = [
        ("plan", "openai", "gpt-4.1"),
        ("task", "anthropic", "claude-3-7-sonnet-latest"),
        ("explore", "openai", "gpt-4.1-mini"),
        ("web_search", "openai", "gpt-4.1-mini"),
        ("review", "gemini", "gemini-2.0-flash"),
        ("ephemeral", "openai", "gpt-4.1-mini"),
    ];

    for (role, provider, model) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO agent_bindings (role, provider, model) VALUES (?1, ?2, ?3)",
            params![role, provider, model],
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

    let main_file = "main.tex";
    let main_content = "\\documentclass{article}\n\\begin{document}\nHello, LatoTex!\\\\\n\\end{document}\n";
    fs::write(root_dir.join(main_file), main_content).map_err(|e| e.to_string())?;

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

pub fn list_projects(db_path: &Path) -> Result<Vec<ProjectSummary>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare(
            "SELECT id, name, root_path, updated_at FROM projects ORDER BY updated_at DESC, created_at DESC",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map([], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut projects = Vec::new();
    for row in rows {
        projects.push(row.map_err(|e| e.to_string())?);
    }
    Ok(projects)
}

pub fn project_snapshot(db_path: &Path, project_id: &str) -> Result<ProjectSnapshot, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let mut stmt = conn
        .prepare("SELECT id, name, root_path, updated_at FROM projects WHERE id = ?1")
        .map_err(|e| e.to_string())?;
    let summary = stmt
        .query_row(params![project_id], |row| {
            Ok(ProjectSummary {
                id: row.get(0)?,
                name: row.get(1)?,
                root_path: row.get(2)?,
                updated_at: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let root_path = PathBuf::from(&summary.root_path);
    let tree = list_workspace_tree(&root_path)?;
    Ok(ProjectSnapshot {
        summary,
        tree,
        main_file: "main.tex".to_string(),
    })
}

pub fn list_workspace_tree(root_path: &Path) -> Result<Vec<ResourceNode>, String> {
    if !root_path.exists() {
        return Ok(Vec::new());
    }
    let mut entries = Vec::new();
    let read_dir = fs::read_dir(root_path).map_err(|e| e.to_string())?;
    for entry in read_dir {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name.starts_with('.') {
            continue;
        }
        entries.push(build_resource_node(root_path, &path)?);
    }
    entries.sort_by_key(node_sort_key);
    Ok(entries)
}

fn node_sort_key(node: &ResourceNode) -> (u8, String) {
    let rank = if node.kind == "directory" { 0 } else { 1 };
    (rank, node.name.to_lowercase())
}

fn build_resource_node(root_path: &Path, path: &Path) -> Result<ResourceNode, String> {
    let relative_path = path
        .strip_prefix(root_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| relative_path.clone());

    if path.is_dir() {
        let mut children = Vec::new();
        for item in fs::read_dir(path).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let item_name = item.file_name().to_string_lossy().to_string();
            if item_name.starts_with('.') {
                continue;
            }
            children.push(build_resource_node(root_path, &item.path())?);
        }
        children.sort_by_key(node_sort_key);
        Ok(ResourceNode {
            name,
            relative_path,
            kind: "directory".to_string(),
            children,
        })
    } else {
        Ok(ResourceNode {
            name,
            relative_path,
            kind: "file".to_string(),
            children: Vec::new(),
        })
    }
}

fn load_project_root(db_path: &Path, project_id: &str) -> Result<PathBuf, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT root_path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get::<_, String>(0).map(PathBuf::from),
    )
    .map_err(|e| e.to_string())
}

fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let sanitized = relative_path.replace('\\', "/");
    let candidate = root.join(&sanitized);
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    let normalized_candidate = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else if let Some(parent) = candidate.parent() {
        let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
        canonical_parent.join(
            candidate
                .file_name()
                .ok_or_else(|| "Invalid file name".to_string())?,
        )
    } else {
        candidate.clone()
    };

    if !normalized_candidate.starts_with(&canonical_root) {
        return Err("Path traversal detected".to_string());
    }
    Ok(normalized_candidate)
}

pub fn read_project_file(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<FileReadResponse, String> {
    let root = load_project_root(db_path, project_id)?;
    let target = safe_join(&root, relative_path)?;
    let content = fs::read_to_string(target).map_err(|e| e.to_string())?;
    Ok(FileReadResponse {
        relative_path: relative_path.to_string(),
        content,
    })
}

pub fn write_project_file(db_path: &Path, input: FileWriteInput) -> Result<Ack, String> {
    let root = load_project_root(db_path, &input.project_id)?;
    let target = safe_join(&root, &input.relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, input.content).map_err(|e| e.to_string())?;

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), input.project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Ack {
        ok: true,
        message: "File saved".to_string(),
    })
}

pub fn record_compile(db_path: &Path, input: CompileRecordInput) -> Result<CompileRecord, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let record_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let diagnostics_json = serde_json::to_string(&input.diagnostics).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO compile_jobs (id, project_id, main_file, status, diagnostics, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record_id,
            input.project_id,
            input.main_file,
            input.status,
            diagnostics_json,
            input.duration_ms as i64,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(CompileRecord {
        id: record_id,
        project_id: input.project_id,
        main_file: input.main_file,
        status: input.status,
        diagnostics: input.diagnostics,
        duration_ms: input.duration_ms,
        created_at: now,
    })
}

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

pub fn load_settings(db_path: &Path) -> Result<AppSettings, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let active_project_id: Option<String> = conn
        .query_row(
            "SELECT active_project_id FROM app_settings WHERE id = 1",
            [],
            |row| row.get(0),
        )
        .map_err(|e| e.to_string())?;

    let mut providers = Vec::new();
    let mut provider_stmt = conn
        .prepare("SELECT provider, base_url FROM provider_profiles ORDER BY provider")
        .map_err(|e| e.to_string())?;
    let provider_rows = provider_stmt
        .query_map([], |row| Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?)))
        .map_err(|e| e.to_string())?;

    for row in provider_rows {
        let (provider, base_url) = row.map_err(|e| e.to_string())?;
        let api_key_set = secure::has_api_key(&provider).unwrap_or(false);
        providers.push(ProviderConfig {
            provider,
            base_url,
            api_key_set,
        });
    }

    let mut agent_bindings = Vec::new();
    let mut binding_stmt = conn
        .prepare("SELECT role, provider, model FROM agent_bindings ORDER BY role")
        .map_err(|e| e.to_string())?;
    let binding_rows = binding_stmt
        .query_map([], |row| {
            Ok(AgentModelBinding {
                role: row.get(0)?,
                provider: row.get(1)?,
                model: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    for row in binding_rows {
        agent_bindings.push(row.map_err(|e| e.to_string())?);
    }

    Ok(AppSettings {
        active_project_id,
        providers,
        agent_bindings,
    })
}

pub fn update_settings(db_path: &Path, input: SettingsUpdateInput) -> Result<AppSettings, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "UPDATE app_settings SET active_project_id = ?1 WHERE id = 1",
        params![input.active_project_id],
    )
    .map_err(|e| e.to_string())?;

    update_provider_profiles(&conn, input.providers)?;
    update_agent_bindings(&conn, input.agent_bindings)?;
    load_settings(db_path)
}

fn update_provider_profiles(conn: &Connection, providers: Vec<ProviderConfigInput>) -> Result<(), String> {
    for provider in providers {
        conn.execute(
            "INSERT INTO provider_profiles (provider, base_url, api_key_ref)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(provider) DO UPDATE SET base_url = excluded.base_url, api_key_ref = excluded.api_key_ref",
            params![
                provider.provider,
                provider.base_url,
                format!("provider:{}", provider.provider)
            ],
        )
        .map_err(|e| e.to_string())?;

        if let Some(api_key) = provider.api_key {
            if !api_key.trim().is_empty() {
                secure::store_api_key(&provider.provider, api_key.trim())?;
            }
        }
    }
    Ok(())
}

fn update_agent_bindings(conn: &Connection, bindings: Vec<AgentModelBinding>) -> Result<(), String> {
    for binding in bindings {
        conn.execute(
            "INSERT INTO agent_bindings (role, provider, model)
             VALUES (?1, ?2, ?3)
             ON CONFLICT(role) DO UPDATE SET provider = excluded.provider, model = excluded.model",
            params![binding.role, binding.provider, binding.model],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
