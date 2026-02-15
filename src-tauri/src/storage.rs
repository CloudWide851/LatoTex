use crate::models::{
    Ack, AgentModelBinding, AppSettings, CompileRecord, CompileRecordInput, EventBatch, EventQuery,
    FileReadResponse, FileWriteInput, FsOperationInput, FsOperationResult, ModelCatalogItem,
    ModelCatalogItemInput, ModelProtocol, ModelProtocolInput, ProjectSnapshot, ProjectSummary,
    ResourceNode, SettingsUpdateInput, SwarmEvent, UiPrefs,
};
use crate::secure;
use chrono::Utc;
use rusqlite::{params, Connection};
use serde_json::{json, Value};
use std::fs;
use std::io;
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
    seed_default_model_catalog(&conn)?;
    seed_default_bindings(&conn)?;
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

fn seed_default_model_catalog(conn: &Connection) -> Result<(), String> {
    let defaults = [
        (
            "openai-gpt-4-1",
            "openai-compatible",
            "GPT-4.1",
            "gpt-4.1",
        ),
        (
            "openai-gpt-4-1-mini",
            "openai-compatible",
            "GPT-4.1 Mini",
            "gpt-4.1-mini",
        ),
        (
            "anthropic-claude-3-7-sonnet-latest",
            "anthropic",
            "Claude 3.7 Sonnet",
            "claude-3-7-sonnet-latest",
        ),
        (
            "gemini-2-0-flash",
            "gemini",
            "Gemini 2.0 Flash",
            "gemini-2.0-flash",
        ),
    ];

    for (id, protocol_id, display_name, request_name) in defaults {
        conn.execute(
            "INSERT OR IGNORE INTO model_catalog (id, protocol_id, display_name, request_name)
             VALUES (?1, ?2, ?3, ?4)",
            params![id, protocol_id, display_name, request_name],
        )
        .map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn seed_default_bindings(conn: &Connection) -> Result<(), String> {
    let defaults = [
        ("plan", "openai-gpt-4-1"),
        ("task", "anthropic-claude-3-7-sonnet-latest"),
        ("explore", "openai-gpt-4-1-mini"),
        ("web_search", "openai-gpt-4-1-mini"),
        ("review", "gemini-2-0-flash"),
        ("ephemeral", "openai-gpt-4-1-mini"),
    ];

    for (role, model_id) in defaults {
        let (protocol_id, request_name): (String, String) = conn
            .query_row(
                "SELECT protocol_id, request_name FROM model_catalog WHERE id = ?1",
                params![model_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|e| e.to_string())?;

        conn.execute(
            "INSERT OR IGNORE INTO agent_bindings (role, provider, model, model_id) VALUES (?1, ?2, ?3, ?4)",
            params![role, protocol_id, request_name, model_id],
        )
        .map_err(|e| e.to_string())?;
    }
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

pub fn initialize_project_from_folder(
    db_path: &Path,
    folder_path: &Path,
) -> Result<ProjectSnapshot, String> {
    if !folder_path.exists() || !folder_path.is_dir() {
        return Err("Selected folder is not accessible".to_string());
    }

    let canonical_root = folder_path.canonicalize().map_err(|e| e.to_string())?;
    ensure_workspace_bootstrap_files(&canonical_root)?;
    let root_str = canonical_root.to_string_lossy().to_string();
    let folder_name = canonical_root
        .file_name()
        .map(|name| name.to_string_lossy().to_string())
        .filter(|name| !name.trim().is_empty())
        .unwrap_or_else(|| "Workspace".to_string());

    let now = now_iso();
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    let existing_id: Result<String, _> = conn.query_row(
        "SELECT id FROM projects WHERE root_path = ?1",
        params![root_str],
        |row| row.get(0),
    );

    let project_id = match existing_id {
        Ok(id) => {
            conn.execute(
                "UPDATE projects SET name = ?1, updated_at = ?2 WHERE id = ?3",
                params![folder_name, now, id],
            )
            .map_err(|e| e.to_string())?;
            id
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => {
            let new_id = Uuid::new_v4().to_string();
            conn.execute(
                "INSERT INTO projects (id, name, root_path, created_at, updated_at) VALUES (?1, ?2, ?3, ?4, ?5)",
                params![new_id, folder_name, root_str, now, now],
            )
            .map_err(|e| e.to_string())?;
            new_id
        }
        Err(error) => return Err(error.to_string()),
    };

    conn.execute(
        "UPDATE app_settings SET active_project_id = ?1 WHERE id = 1",
        params![project_id],
    )
    .map_err(|e| e.to_string())?;

    project_snapshot(db_path, &project_id)
}

fn ensure_workspace_bootstrap_files(root: &Path) -> Result<(), String> {
    let latotex_dir = root.join(".latotex");
    fs::create_dir_all(&latotex_dir).map_err(|e| e.to_string())?;
    fs::create_dir_all(library_root(root)).map_err(|e| e.to_string())?;
    fs::create_dir_all(latotex_dir.join("index")).map_err(|e| e.to_string())?;

    let config_path = latotex_dir.join("config.json");
    if !config_path.exists() {
        let config = json!({
            "version": 1,
            "createdAt": now_iso(),
            "workspace": root
                .file_name()
                .map(|name| name.to_string_lossy().to_string())
                .unwrap_or_else(|| "Workspace".to_string())
        });
        fs::write(
            config_path,
            serde_json::to_string_pretty(&config).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    let permissions_path = latotex_dir.join("permissions.json");
    if !permissions_path.exists() {
        let permissions = json!({
            "allowAgentWrite": true,
            "allowAgentRead": true,
            "allowShellExec": false
        });
        fs::write(
            permissions_path,
            serde_json::to_string_pretty(&permissions).map_err(|e| e.to_string())?,
        )
        .map_err(|e| e.to_string())?;
    }

    let main_path = root.join("main.tex");
    if !main_path.exists() {
        let content = "\\documentclass{article}\n\\begin{document}\nHello, LatoTex!\\\\\n\\end{document}\n";
        fs::write(main_path, content).map_err(|e| e.to_string())?;
    }

    refresh_workspace_index(root)?;
    refresh_library_index(root)?;

    Ok(())
}

fn library_root(project_root: &Path) -> PathBuf {
    project_root.join(".latotex").join("papers")
}

fn workspace_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("workspace-index.json")
}

fn library_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("papers-index.json")
}

fn collect_file_index_entries(root: &Path, base: &Path, entries: &mut Vec<Value>) -> Result<(), String> {
    if !base.exists() {
        return Ok(());
    }
    for item in fs::read_dir(base).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        if name == ".git" {
            continue;
        }

        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        let modified = metadata
            .modified()
            .ok()
            .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|d| d.as_secs())
            .unwrap_or(0);

        entries.push(json!({
            "relativePath": rel,
            "name": name,
            "kind": if metadata.is_dir() { "directory" } else { "file" },
            "size": metadata.len(),
            "modifiedEpochSec": modified
        }));

        if metadata.is_dir() {
            collect_file_index_entries(root, &path, entries)?;
        }
    }
    Ok(())
}

fn refresh_workspace_index(project_root: &Path) -> Result<(), String> {
    let mut entries = Vec::new();
    collect_file_index_entries(project_root, project_root, &mut entries)?;
    let payload = json!({
        "updatedAt": now_iso(),
        "entries": entries
    });
    let index_path = workspace_index_path(project_root);
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        index_path,
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn refresh_library_index(project_root: &Path) -> Result<(), String> {
    let papers_root = library_root(project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    collect_file_index_entries(project_root, &papers_root, &mut entries)?;
    let payload = json!({
        "updatedAt": now_iso(),
        "root": ".latotex/papers",
        "entries": entries
    });
    let index_path = library_index_path(project_root);
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        index_path,
        serde_json::to_string_pretty(&payload).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
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
    ensure_workspace_bootstrap_files(&root_path)?;
    refresh_workspace_index(&root_path)?;
    refresh_library_index(&root_path)?;
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

pub fn load_project_root(db_path: &Path, project_id: &str) -> Result<PathBuf, String> {
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
    } else {
        let mut existing_parent = candidate.as_path();
        while !existing_parent.exists() {
            existing_parent = existing_parent
                .parent()
                .ok_or_else(|| "Invalid target path".to_string())?;
        }
        let canonical_existing = existing_parent.canonicalize().map_err(|e| e.to_string())?;
        let stripped = candidate
            .strip_prefix(existing_parent)
            .map_err(|e| e.to_string())?;
        canonical_existing.join(stripped)
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

pub fn list_library_tree(db_path: &Path, project_id: &str) -> Result<Vec<ResourceNode>, String> {
    let root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;
    refresh_library_index(&root)?;
    list_workspace_tree(&papers_root)
}

pub fn rescan_library(db_path: &Path, project_id: &str) -> Result<Ack, String> {
    let root = load_project_root(db_path, project_id)?;
    refresh_workspace_index(&root)?;
    refresh_library_index(&root)?;
    Ok(Ack {
        ok: true,
        message: "Library index refreshed".to_string(),
    })
}

fn copy_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let from = item.path();
            let to = target.join(item.file_name());
            copy_recursively(&from, &to)?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn move_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match fs::rename(source, target) {
        Ok(_) => Ok(()),
        Err(error) => {
            if error.kind() == io::ErrorKind::CrossesDevices {
                copy_recursively(source, target)?;
                if source.is_dir() {
                    fs::remove_dir_all(source).map_err(|e| e.to_string())?;
                } else {
                    fs::remove_file(source).map_err(|e| e.to_string())?;
                }
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn scope_root(project_root: &Path, scope: &str) -> Result<PathBuf, String> {
    match scope {
        "workspace" => Ok(project_root.to_path_buf()),
        "library" => {
            let root = library_root(project_root);
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            Ok(root)
        }
        _ => Err("Unsupported scope".to_string()),
    }
}

pub fn fs_operation(db_path: &Path, input: FsOperationInput) -> Result<FsOperationResult, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let root = scope_root(&project_root, input.scope.trim())?;
    let path = safe_join(&root, &input.path)?;

    match input.action.as_str() {
        "create_file" => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&path, input.content.unwrap_or_default()).map_err(|e| e.to_string())?;
        }
        "create_folder" => {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        }
        "rename" | "move" => {
            let target_relative = input
                .target_path
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            move_recursively(&path, &target)?;
        }
        "copy" => {
            let target_relative = input
                .target_path
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            copy_recursively(&path, &target)?;
        }
        "delete" => {
            trash::delete(&path).map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported file action".to_string()),
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), input.project_id],
    )
    .map_err(|e| e.to_string())?;

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;

    Ok(FsOperationResult {
        ok: true,
        message: "Operation completed".to_string(),
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
        model_protocols.push(ModelProtocol {
            api_key_set: secure::has_api_key(&id).unwrap_or(false),
            id,
            display_name,
            base_url,
        });
    }

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

    Ok(AppSettings {
        active_project_id,
        model_protocols,
        model_catalog,
        agent_bindings,
        ui_prefs,
    })
}

pub fn update_settings(db_path: &Path, input: SettingsUpdateInput) -> Result<AppSettings, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
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

    update_model_protocols(&conn, input.model_protocols)?;
    update_model_catalog(&conn, input.model_catalog)?;
    update_agent_bindings(&conn, input.agent_bindings)?;
    load_settings(db_path)
}

fn update_model_protocols(conn: &Connection, protocols: Vec<ModelProtocolInput>) -> Result<(), String> {
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

        if let Some(api_key) = protocol.api_key {
            if !api_key.trim().is_empty() {
                secure::store_api_key(&protocol.id, api_key.trim())?;
            }
        }
    }
    Ok(())
}

fn update_model_catalog(conn: &Connection, models: Vec<ModelCatalogItemInput>) -> Result<(), String> {
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
    for binding in bindings {
        let model_id = binding.model_id.clone();
        let (protocol_id, request_name): (String, String) = conn
            .query_row(
                "SELECT protocol_id, request_name FROM model_catalog WHERE id = ?1",
                params![&model_id],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .map_err(|_| format!("modelId not found for role {}: {}", binding.role, model_id))?;

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

pub fn now_iso() -> String {
    Utc::now().to_rfc3339()
}
