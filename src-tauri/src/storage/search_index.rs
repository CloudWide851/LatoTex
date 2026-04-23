use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, OnceLock};

const SEARCH_MAX_FILE_SIZE_BYTES: u64 = 8 * 1024 * 1024;
const SEARCH_INDEX_SCHEMA_VERSION: i64 = 2;
const SEARCH_DOCUMENT_REQUIRED_COLUMNS: &[&str] = &[
    "relative_path",
    "file_name",
    "file_name_lower",
    "lower_path",
    "size_bytes",
    "modified_epoch_sec",
    "searchable",
    "content_text",
    "content_lower",
];

#[derive(Clone)]
struct SearchScanEntry {
    relative_path: String,
    file_name: String,
    full_path: PathBuf,
    size_bytes: u64,
    modified_epoch_sec: i64,
}

#[derive(Clone, Copy)]
struct SearchIndexedEntry {
    size_bytes: u64,
    modified_epoch_sec: i64,
}

fn search_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("search-index.sqlite3")
}

fn search_index_lock_map() -> &'static Mutex<HashMap<String, Arc<Mutex<()>>>> {
    static LOCKS: OnceLock<Mutex<HashMap<String, Arc<Mutex<()>>>>> = OnceLock::new();
    LOCKS.get_or_init(|| Mutex::new(HashMap::new()))
}

fn search_index_project_lock(project_root: &Path) -> Result<Arc<Mutex<()>>, String> {
    let key = project_root
        .canonicalize()
        .unwrap_or_else(|_| project_root.to_path_buf())
        .to_string_lossy()
        .to_string();
    let mut locks = search_index_lock_map().lock().map_err(|e| e.to_string())?;
    Ok(locks
        .entry(key)
        .or_insert_with(|| Arc::new(Mutex::new(())))
        .clone())
}

fn open_search_index(project_root: &Path) -> Result<Connection, String> {
    let index_path = search_index_path(project_root);
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let conn = Connection::open(index_path).map_err(|e| e.to_string())?;
    initialize_search_index_schema(&conn)?;
    Ok(conn)
}

fn initialize_search_index_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS search_meta (
          id INTEGER PRIMARY KEY CHECK (id = 1),
          schema_version INTEGER NOT NULL,
          dirty INTEGER NOT NULL,
          last_indexed_at TEXT
        );
        ",
    )
    .map_err(|e| e.to_string())?;

    let current_version = conn
        .query_row(
            "SELECT schema_version FROM search_meta WHERE id = 1",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|e| e.to_string())?;

    if search_documents_schema_needs_rebuild(conn, current_version)? {
        conn.execute("DROP TABLE IF EXISTS search_documents", [])
            .map_err(|e| e.to_string())?;
        create_search_documents_table(conn)?;
        conn.execute(
            "
            INSERT INTO search_meta (id, schema_version, dirty, last_indexed_at)
            VALUES (1, ?1, 1, NULL)
            ON CONFLICT(id) DO UPDATE SET
              schema_version = excluded.schema_version,
              dirty = 1,
              last_indexed_at = NULL
            ",
            params![SEARCH_INDEX_SCHEMA_VERSION],
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute(
            "
            INSERT INTO search_meta (id, schema_version, dirty, last_indexed_at)
            VALUES (1, ?1, 1, NULL)
            ON CONFLICT(id) DO NOTHING
            ",
            params![SEARCH_INDEX_SCHEMA_VERSION],
        )
        .map_err(|e| e.to_string())?;
    }
    create_search_documents_indices(conn)?;
    Ok(())
}

fn search_documents_columns(conn: &Connection) -> Result<HashSet<String>, String> {
    let mut stmt = conn
        .prepare("PRAGMA table_info(search_documents)")
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| row.get::<_, String>(1))
        .map_err(|e| e.to_string())?;
    let mut columns = HashSet::new();
    for row in rows {
        columns.insert(row.map_err(|e| e.to_string())?);
    }
    Ok(columns)
}

fn search_documents_schema_needs_rebuild(
    conn: &Connection,
    current_version: Option<i64>,
) -> Result<bool, String> {
    if current_version != Some(SEARCH_INDEX_SCHEMA_VERSION) {
        return Ok(true);
    }
    let columns = search_documents_columns(conn)?;
    if columns.is_empty() {
        return Ok(true);
    }
    Ok(SEARCH_DOCUMENT_REQUIRED_COLUMNS
        .iter()
        .any(|column| !columns.contains(*column)))
}

fn create_search_documents_table(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "
        CREATE TABLE search_documents (
          relative_path TEXT PRIMARY KEY,
          file_name TEXT NOT NULL,
          file_name_lower TEXT NOT NULL,
          lower_path TEXT NOT NULL,
          size_bytes INTEGER NOT NULL,
          modified_epoch_sec INTEGER NOT NULL,
          searchable INTEGER NOT NULL,
          content_text TEXT,
          content_lower TEXT
        )
        ",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn create_search_documents_indices(conn: &Connection) -> Result<(), String> {
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_search_documents_file_name_lower ON search_documents(file_name_lower)",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_search_documents_lower_path ON search_documents(lower_path)",
        [],
    )
    .map_err(|e| e.to_string())?;
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_search_documents_modified_size ON search_documents(modified_epoch_sec, size_bytes)",
        [],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn is_ignored_search_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | "dist" | ".pnpm-store")
}

fn should_index_search_entry(path: &Path, name: &str, is_dir: bool) -> bool {
    if is_dir {
        if is_ignored_search_dir(name) {
            return false;
        }
        if is_python_venv_dir(path, name) {
            return false;
        }
    }
    should_show_workspace_entry(path, name, is_dir)
}

fn modified_epoch_sec(metadata: &fs::Metadata) -> i64 {
    metadata
        .modified()
        .ok()
        .and_then(|ts| ts.duration_since(std::time::UNIX_EPOCH).ok())
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or(0)
}

fn collect_search_scan_entries(
    root: &Path,
    current: &Path,
    entries: &mut Vec<SearchScanEntry>,
) -> Result<(), String> {
    if !current.exists() {
        return Ok(());
    }
    for item in fs::read_dir(current).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        let name = item.file_name().to_string_lossy().to_string();
        let is_dir = path.is_dir();
        if !should_index_search_entry(&path, &name, is_dir) {
            continue;
        }
        if is_dir {
            collect_search_scan_entries(root, &path, entries)?;
            continue;
        }
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        entries.push(SearchScanEntry {
            relative_path: path
                .strip_prefix(root)
                .map_err(|e| e.to_string())?
                .to_string_lossy()
                .replace('\\', "/"),
            file_name: name,
            full_path: path,
            size_bytes: metadata.len(),
            modified_epoch_sec: modified_epoch_sec(&metadata),
        });
    }
    Ok(())
}

fn existing_search_entries(conn: &Connection) -> Result<HashMap<String, SearchIndexedEntry>, String> {
    let mut stmt = conn
        .prepare(
            "SELECT relative_path, size_bytes, modified_epoch_sec, searchable FROM search_documents",
        )
        .map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map([], |row| {
            Ok((
                row.get::<_, String>(0)?,
                SearchIndexedEntry {
                    size_bytes: row.get::<_, i64>(1)? as u64,
                    modified_epoch_sec: row.get::<_, i64>(2)?,
                },
            ))
        })
        .map_err(|e| e.to_string())?;

    let mut entries = HashMap::new();
    for row in rows {
        let (relative_path, entry) = row.map_err(|e| e.to_string())?;
        entries.insert(relative_path, entry);
    }
    Ok(entries)
}

fn load_searchable_file_content(path: &Path, size_bytes: u64) -> Result<(bool, Option<String>, Option<String>), String> {
    if size_bytes > SEARCH_MAX_FILE_SIZE_BYTES {
        return Ok((false, None, None));
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    if bytes.contains(&0) {
        return Ok((false, None, None));
    }
    let content_text = String::from_utf8_lossy(&bytes).into_owned();
    if content_text.trim().is_empty() {
        return Ok((true, Some(content_text), Some(String::new())));
    }
    let content_lower = content_text.to_lowercase();
    Ok((true, Some(content_text), Some(content_lower)))
}

fn search_index_needs_refresh(conn: &Connection) -> Result<bool, String> {
    let dirty = conn
        .query_row("SELECT dirty FROM search_meta WHERE id = 1", [], |row| {
            row.get::<_, i64>(0)
        })
        .optional()
        .map_err(|e| e.to_string())?
        .unwrap_or(1);
    Ok(dirty != 0)
}

fn sync_search_index(project_root: &Path, force: bool) -> Result<(), String> {
    let project_lock = search_index_project_lock(project_root)?;
    let _guard = project_lock.lock().map_err(|e| e.to_string())?;
    let mut conn = open_search_index(project_root)?;
    if !force && !search_index_needs_refresh(&conn)? {
        return Ok(());
    }

    let existing = existing_search_entries(&conn)?;
    let mut scan_entries = Vec::new();
    collect_search_scan_entries(project_root, project_root, &mut scan_entries)?;
    scan_entries.sort_by(|a, b| a.relative_path.cmp(&b.relative_path));
    let seen_paths: HashSet<String> = scan_entries.iter().map(|item| item.relative_path.clone()).collect();

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    for item in &scan_entries {
        let existing_item = existing.get(&item.relative_path).copied();
        let unchanged = existing_item.is_some_and(|entry| {
            entry.size_bytes == item.size_bytes && entry.modified_epoch_sec == item.modified_epoch_sec
        });
        if unchanged {
            continue;
        }
        let (searchable, content_text, content_lower) =
            load_searchable_file_content(&item.full_path, item.size_bytes)?;
        tx.execute(
            "
            INSERT INTO search_documents (
              relative_path,
              file_name,
              file_name_lower,
              lower_path,
              size_bytes,
              modified_epoch_sec,
              searchable,
              content_text,
              content_lower
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)
            ON CONFLICT(relative_path) DO UPDATE SET
              file_name = excluded.file_name,
              file_name_lower = excluded.file_name_lower,
              lower_path = excluded.lower_path,
              size_bytes = excluded.size_bytes,
              modified_epoch_sec = excluded.modified_epoch_sec,
              searchable = excluded.searchable,
              content_text = excluded.content_text,
              content_lower = excluded.content_lower
            ",
            params![
                item.relative_path,
                item.file_name,
                item.file_name.to_lowercase(),
                item.relative_path.to_lowercase(),
                item.size_bytes as i64,
                item.modified_epoch_sec,
                if searchable { 1_i64 } else { 0_i64 },
                content_text,
                content_lower
            ],
        )
        .map_err(|e| e.to_string())?;
    }

    for stale_path in existing.keys().filter(|path| !seen_paths.contains(*path)) {
        tx.execute(
            "DELETE FROM search_documents WHERE relative_path = ?1",
            params![stale_path],
        )
        .map_err(|e| e.to_string())?;
    }

    tx.execute(
        "
        INSERT INTO search_meta (id, schema_version, dirty, last_indexed_at)
        VALUES (1, ?1, 0, ?2)
        ON CONFLICT(id) DO UPDATE SET
          schema_version = excluded.schema_version,
          dirty = 0,
          last_indexed_at = excluded.last_indexed_at
        ",
        params![SEARCH_INDEX_SCHEMA_VERSION, now_iso()],
    )
    .map_err(|e| e.to_string())?;
    tx.commit().map_err(|e| e.to_string())?;
    Ok(())
}

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (idx, ch) in input.chars().enumerate() {
        if idx >= max_chars {
            output.push_str("...");
            return output;
        }
        output.push(ch);
    }
    output
}

pub fn mark_search_index_dirty(project_root: &Path) -> Result<(), String> {
    let project_lock = search_index_project_lock(project_root)?;
    let _guard = project_lock.lock().map_err(|e| e.to_string())?;
    let conn = open_search_index(project_root)?;
    conn.execute(
        "
        INSERT INTO search_meta (id, schema_version, dirty, last_indexed_at)
        VALUES (1, ?1, 1, NULL)
        ON CONFLICT(id) DO UPDATE SET
          schema_version = excluded.schema_version,
          dirty = 1,
          last_indexed_at = NULL
        ",
        params![SEARCH_INDEX_SCHEMA_VERSION],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn prepare_project_search_index(db_path: &Path, project_id: &str) -> Result<Ack, String> {
    let root = load_project_root(db_path, project_id)?;
    sync_search_index(&root, true)?;
    Ok(Ack {
        ok: true,
        message: "Search index ready".to_string(),
    })
}
