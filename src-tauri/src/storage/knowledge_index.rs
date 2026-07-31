const KNOWLEDGE_TEXT_LIMIT: u64 = 16 * 1024 * 1024;
const KNOWLEDGE_DOCX_LIMIT: u64 = 64 * 1024 * 1024;
const KNOWLEDGE_PDF_LIMIT: u64 = 256 * 1024 * 1024;
const KNOWLEDGE_DOCX_EXPANDED_LIMIT: u64 = 256 * 1024 * 1024;
const KNOWLEDGE_DOCX_ENTRY_LIMIT: usize = 2048;
const KNOWLEDGE_CHUNK_TARGET_CHARS: usize = 1400;
const KNOWLEDGE_CHUNK_OVERLAP_CHARS: usize = 200;
const KNOWLEDGE_SCHEMA_VERSION: i64 = 1;
const KNOWLEDGE_EMBEDDING_PLUGIN_ID: &str = "latotex.research.multilingual-e5-small";
const KNOWLEDGE_EMBEDDING_FINGERPRINT: &str =
    "multilingual-e5-small@761b726dd34fb83930e26aab4e9ac3899aa1fa78:int8";

#[derive(Clone)]
struct KnowledgeChunkDraft {
    anchor: crate::models::KnowledgeAnchor,
    text: String,
}

fn knowledge_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("knowledge-index.sqlite3")
}

fn migrate_knowledge_index(conn: &mut Connection) -> Result<(), String> {
    let version = conn
        .query_row(
            "SELECT CAST(meta_value AS INTEGER) FROM knowledge_meta
             WHERE meta_key = 'schema_version'",
            [],
            |row| row.get::<_, i64>(0),
        )
        .optional()
        .map_err(|_| "knowledge.index.schema_failed".to_string())?
        .unwrap_or_default();
    if version >= KNOWLEDGE_SCHEMA_VERSION {
        return Ok(());
    }
    let tx = conn
        .transaction()
        .map_err(|_| "knowledge.index.schema_failed".to_string())?;
    tx.execute("DELETE FROM knowledge_chunks_trigram", [])
        .map_err(|_| "knowledge.index.schema_failed".to_string())?;
    tx.execute(
        "INSERT INTO knowledge_chunks_trigram (evidence_id, text)
         SELECT evidence_id, text FROM knowledge_chunks",
        [],
    )
    .map_err(|_| "knowledge.index.schema_failed".to_string())?;
    tx.execute(
        "INSERT INTO knowledge_meta (meta_key, meta_value, updated_at)
         VALUES ('schema_version', ?1, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
         ON CONFLICT(meta_key) DO UPDATE SET
           meta_value=excluded.meta_value, updated_at=excluded.updated_at",
        params![KNOWLEDGE_SCHEMA_VERSION.to_string()],
    )
    .map_err(|_| "knowledge.index.schema_failed".to_string())?;
    tx.commit()
        .map_err(|_| "knowledge.index.schema_failed".to_string())
}

fn open_knowledge_index(project_root: &Path) -> Result<Connection, String> {
    let index_dir = ensure_mutation_path(project_root, ".latotex/index")?;
    fs::create_dir_all(&index_dir).map_err(|_| "knowledge.index.unavailable".to_string())?;
    let path = knowledge_index_path(project_root);
    ensure_not_link_or_reparse_if_present(&path)?;
    let mut conn = Connection::open(path).map_err(|_| "knowledge.index.unavailable".to_string())?;
    conn.busy_timeout(std::time::Duration::from_secs(3))
        .map_err(|_| "knowledge.index.unavailable".to_string())?;
    conn.execute_batch(
        "
        PRAGMA journal_mode=WAL;
        PRAGMA synchronous=NORMAL;
        CREATE TABLE IF NOT EXISTS knowledge_items (
          item_id TEXT PRIMARY KEY,
          project_id TEXT NOT NULL,
          relative_path TEXT NOT NULL UNIQUE,
          title TEXT NOT NULL,
          source_kind TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          index_state TEXT NOT NULL,
          chunk_count INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL,
          failure_code TEXT
        );
        CREATE TABLE IF NOT EXISTS knowledge_chunks (
          evidence_id TEXT PRIMARY KEY,
          item_id TEXT NOT NULL,
          chunk_index INTEGER NOT NULL,
          anchor_json TEXT NOT NULL,
          text TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_chunks_item
          ON knowledge_chunks(item_id, chunk_index);
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_fts USING fts5(
          evidence_id UNINDEXED,
          text,
          tokenize='unicode61 remove_diacritics 2'
        );
        CREATE VIRTUAL TABLE IF NOT EXISTS knowledge_chunks_trigram USING fts5(
          evidence_id UNINDEXED,
          text,
          tokenize='trigram'
        );
        CREATE TABLE IF NOT EXISTS knowledge_links (
          link_id TEXT PRIMARY KEY,
          source_item_id TEXT NOT NULL,
          target_ref TEXT NOT NULL,
          kind TEXT NOT NULL,
          confidence REAL NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_links_source
          ON knowledge_links(source_item_id);
        CREATE INDEX IF NOT EXISTS idx_knowledge_links_target
          ON knowledge_links(target_ref);
        CREATE TABLE IF NOT EXISTS knowledge_topics (
          topic_id TEXT PRIMARY KEY,
          label TEXT NOT NULL,
          normalized_label TEXT NOT NULL UNIQUE,
          source TEXT NOT NULL,
          confidence REAL NOT NULL,
          hidden INTEGER NOT NULL DEFAULT 0,
          manual INTEGER NOT NULL DEFAULT 0,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS knowledge_topic_links (
          item_id TEXT NOT NULL,
          topic_id TEXT NOT NULL,
          confidence REAL NOT NULL,
          source TEXT NOT NULL,
          PRIMARY KEY(item_id, topic_id)
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_topic_links_topic
          ON knowledge_topic_links(topic_id);
        CREATE TABLE IF NOT EXISTS knowledge_mutation_approvals (
          token TEXT PRIMARY KEY,
          scope TEXT NOT NULL,
          action TEXT NOT NULL,
          path TEXT NOT NULL,
          target_path TEXT,
          content_version TEXT NOT NULL,
          expires_at_unix_ms INTEGER NOT NULL,
          consumed INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS knowledge_tombstones (
          item_id TEXT PRIMARY KEY,
          previous_path TEXT NOT NULL,
          content_hash TEXT NOT NULL,
          deleted_at_unix_ms INTEGER NOT NULL
        );
        CREATE TABLE IF NOT EXISTS knowledge_meta (
          meta_key TEXT PRIMARY KEY,
          meta_value TEXT NOT NULL,
          updated_at TEXT NOT NULL
        );
        CREATE TABLE IF NOT EXISTS knowledge_vectors (
          vector_id INTEGER PRIMARY KEY,
          evidence_id TEXT NOT NULL UNIQUE,
          embedding BLOB NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_knowledge_vectors_evidence
          ON knowledge_vectors(evidence_id);
        CREATE TABLE IF NOT EXISTS knowledge_vectors_build (
          vector_id INTEGER PRIMARY KEY,
          evidence_id TEXT NOT NULL UNIQUE,
          embedding BLOB NOT NULL
        );
        CREATE TABLE IF NOT EXISTS knowledge_embedding_jobs (
          job_id INTEGER PRIMARY KEY CHECK(job_id = 1),
          state TEXT NOT NULL,
          generation TEXT NOT NULL,
          processed INTEGER NOT NULL DEFAULT 0,
          total INTEGER NOT NULL DEFAULT 0,
          pause_requested INTEGER NOT NULL DEFAULT 0,
          failure_code TEXT,
          updated_at TEXT NOT NULL
        );
        ",
    )
    .map_err(|_| "knowledge.index.schema_failed".to_string())?;
    migrate_knowledge_index(&mut conn)?;
    Ok(conn)
}

fn knowledge_hex_sha256(bytes: &[u8]) -> String {
    let digest = ring::digest::digest(&ring::digest::SHA256, bytes);
    digest
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn knowledge_source_kind(relative_path: &str) -> Result<&'static str, String> {
    let lower = relative_path.to_ascii_lowercase();
    if lower.ends_with(".md") || lower.ends_with(".markdown") {
        Ok("markdown")
    } else if lower.ends_with(".txt") {
        Ok("text")
    } else if lower.ends_with(".docx") {
        Ok("docx")
    } else if lower.ends_with(".pdf") {
        Ok("pdf")
    } else if lower.ends_with(".doc") || lower.ends_with(".docm") || lower.ends_with(".dotm") {
        Err("knowledge.archive.format_unsupported".to_string())
    } else {
        Err("knowledge.archive.format_unsupported".to_string())
    }
}

fn knowledge_title_from_path(relative_path: &str) -> String {
    Path::new(relative_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .filter(|value| !value.trim().is_empty())
        .unwrap_or("Untitled")
        .to_string()
}

fn knowledge_text_chunks(text: &str, markdown: bool) -> Vec<KnowledgeChunkDraft> {
    let lines = text.lines().collect::<Vec<_>>();
    let mut chunks = Vec::new();
    let mut buffer = String::new();
    let mut start_line = 1_u32;
    let mut end_line = 1_u32;
    let mut heading: Option<String> = None;
    let push = |chunks: &mut Vec<KnowledgeChunkDraft>,
                buffer: &mut String,
                start_line: u32,
                end_line: u32,
                heading: &Option<String>| {
        let trimmed = buffer.trim();
        if trimmed.is_empty() {
            buffer.clear();
            return;
        }
        chunks.push(KnowledgeChunkDraft {
            anchor: crate::models::KnowledgeAnchor {
                kind: "lines".to_string(),
                value: format!("L{start_line}-L{end_line}"),
                page: None,
                line_start: Some(start_line),
                line_end: Some(end_line),
                heading: heading.clone(),
            },
            text: trimmed.to_string(),
        });
        buffer.clear();
    };

    for (index, line) in lines.iter().enumerate() {
        let line_number = index as u32 + 1;
        let trimmed = line.trim();
        if markdown && trimmed.starts_with('#') {
            let candidate = trimmed.trim_start_matches('#').trim();
            if !candidate.is_empty() {
                heading = Some(candidate.chars().take(160).collect());
            }
        }
        let segment = if buffer.is_empty() {
            (*line).to_string()
        } else {
            format!("\n{line}")
        };
        if !buffer.is_empty()
            && buffer.chars().count() + segment.chars().count() > KNOWLEDGE_CHUNK_TARGET_CHARS
        {
            let overlap = buffer
                .chars()
                .rev()
                .take(KNOWLEDGE_CHUNK_OVERLAP_CHARS)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>();
            push(&mut chunks, &mut buffer, start_line, end_line, &heading);
            buffer = overlap;
            start_line = line_number.saturating_sub(1).max(1);
        }
        buffer.push_str(&segment);
        end_line = line_number;
    }
    push(&mut chunks, &mut buffer, start_line, end_line, &heading);
    chunks
}

fn knowledge_xml_unescape(value: &str) -> String {
    value
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
}

fn knowledge_pdf_chunks(pages: Vec<(u32, String)>) -> Vec<KnowledgeChunkDraft> {
    let mut chunks = Vec::new();
    for (page, text) in pages {
        let chars = text.chars().collect::<Vec<_>>();
        let mut start = 0_usize;
        let mut part = 1_u32;
        while start < chars.len() {
            let end = (start + KNOWLEDGE_CHUNK_TARGET_CHARS).min(chars.len());
            let chunk_text = chars[start..end].iter().collect::<String>();
            if !chunk_text.trim().is_empty() {
                chunks.push(KnowledgeChunkDraft {
                    anchor: crate::models::KnowledgeAnchor {
                        kind: "page".to_string(),
                        value: format!("p.{page}#{part}"),
                        page: Some(page),
                        line_start: None,
                        line_end: None,
                        heading: None,
                    },
                    text: chunk_text,
                });
                part = part.saturating_add(1);
            }
            if end == chars.len() {
                break;
            }
            start = end.saturating_sub(KNOWLEDGE_CHUNK_OVERLAP_CHARS);
        }
    }
    chunks
}

fn knowledge_docx_chunks(bytes: &[u8]) -> Result<Vec<KnowledgeChunkDraft>, String> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive =
        zip::ZipArchive::new(cursor).map_err(|_| "knowledge.archive.docx_invalid".to_string())?;
    if archive.len() > KNOWLEDGE_DOCX_ENTRY_LIMIT {
        return Err("knowledge.archive.docx_unsafe".to_string());
    }
    let mut expanded = 0_u64;
    for index in 0..archive.len() {
        let entry = archive
            .by_index(index)
            .map_err(|_| "knowledge.archive.docx_invalid".to_string())?;
        if entry.enclosed_name().is_none() {
            return Err("knowledge.archive.docx_unsafe".to_string());
        }
        expanded = expanded.saturating_add(entry.size());
        if expanded > KNOWLEDGE_DOCX_EXPANDED_LIMIT
            || (entry.size() > 1024 * 1024
                && entry.size() > entry.compressed_size().saturating_mul(200))
        {
            return Err("knowledge.archive.docx_unsafe".to_string());
        }
    }
    let mut document = String::new();
    std::io::Read::read_to_string(
        &mut archive
            .by_name("word/document.xml")
            .map_err(|_| "knowledge.archive.docx_invalid".to_string())?,
        &mut document,
    )
    .map_err(|_| "knowledge.archive.docx_invalid".to_string())?;
    let paragraph_re = regex::Regex::new(r"(?is)<w:p\b[^>]*>(.*?)</w:p>")
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let text_re = regex::Regex::new(r"(?is)<w:t\b[^>]*>(.*?)</w:t>")
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let mut plain = String::new();
    for paragraph in paragraph_re.captures_iter(&document) {
        let body = paragraph.get(1).map(|value| value.as_str()).unwrap_or("");
        let mut line = String::new();
        for text in text_re.captures_iter(body) {
            line.push_str(&knowledge_xml_unescape(
                text.get(1).map(|value| value.as_str()).unwrap_or(""),
            ));
        }
        if !line.trim().is_empty() {
            plain.push_str(line.trim());
            plain.push('\n');
        }
    }
    if plain.trim().is_empty() {
        return Err("knowledge.archive.no_text".to_string());
    }
    Ok(knowledge_text_chunks(&plain, false))
}

fn knowledge_extract_chunks(
    source: &Path,
    relative_path: &str,
    pdf_pages: Option<Vec<(u32, String)>>,
) -> Result<(String, String, Vec<KnowledgeChunkDraft>), String> {
    let source_kind = knowledge_source_kind(relative_path)?.to_string();
    let limit = match source_kind.as_str() {
        "docx" => KNOWLEDGE_DOCX_LIMIT,
        "pdf" => KNOWLEDGE_PDF_LIMIT,
        _ => KNOWLEDGE_TEXT_LIMIT,
    };
    let bytes = read_file_with_limit(source, limit)?;
    let content_hash = knowledge_hex_sha256(&bytes);
    let chunks = match source_kind.as_str() {
        "markdown" | "text" => {
            let text = String::from_utf8(bytes)
                .map_err(|_| "knowledge.archive.invalid_encoding".to_string())?;
            knowledge_text_chunks(&text, source_kind == "markdown")
        }
        "docx" => knowledge_docx_chunks(&bytes)?,
        "pdf" => {
            let pages = pdf_pages.ok_or_else(|| "knowledge.archive.ocr_required".to_string())?;
            let usable = pages
                .into_iter()
                .filter(|(_, text)| text.trim().chars().count() >= 20)
                .collect::<Vec<_>>();
            if usable.is_empty() {
                return Err("knowledge.archive.ocr_required".to_string());
            }
            knowledge_pdf_chunks(usable)
        }
        _ => return Err("knowledge.archive.format_unsupported".to_string()),
    };
    if chunks.is_empty() {
        return Err("knowledge.archive.no_text".to_string());
    }
    Ok((source_kind, content_hash, chunks))
}

fn knowledge_extract_links(item_id: &str, chunks: &[KnowledgeChunkDraft]) -> Vec<(String, String)> {
    let content = chunks
        .iter()
        .map(|chunk| chunk.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let wiki_re = regex::Regex::new(r"\[\[([^\]\r\n]{1,240})\]\]").expect("wiki regex");
    let markdown_re =
        regex::Regex::new(r"\[[^\]\r\n]{1,240}\]\(([^)\r\n]{1,512})\)").expect("link regex");
    let doi_re = regex::Regex::new(r"(?i)\b10\.\d{4,9}/[-._;()/:A-Z0-9]+\b").expect("doi regex");
    let mut links = std::collections::BTreeSet::new();
    for capture in wiki_re.captures_iter(&content) {
        if let Some(value) = capture.get(1) {
            links.insert(("wiki".to_string(), value.as_str().trim().to_string()));
        }
    }
    for capture in markdown_re.captures_iter(&content) {
        if let Some(value) = capture.get(1) {
            links.insert(("link".to_string(), value.as_str().trim().to_string()));
        }
    }
    for value in doi_re.find_iter(&content) {
        links.insert(("doi".to_string(), value.as_str().to_ascii_lowercase()));
    }
    links
        .into_iter()
        .filter(|(_, target)| !target.is_empty() && target != item_id)
        .take(512)
        .collect()
}

pub fn archive_knowledge_item(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
    pdf_pages: Option<Vec<(u32, String)>>,
) -> Result<crate::models::KnowledgeItem, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let normalized = normalize_workspace_path(relative_path)?
        .to_string_lossy()
        .replace('\\', "/");
    let source = safe_join(&project_root, &normalized)?;
    if !source.is_file() {
        return Err("knowledge.archive.file_required".to_string());
    }
    let (source_kind, content_hash, chunks) =
        knowledge_extract_chunks(&source, &normalized, pdf_pages)?;
    let mut title = knowledge_title_from_path(&normalized);
    if let Some(heading) = chunks.iter().find_map(|chunk| chunk.anchor.heading.clone()) {
        title = heading;
    }
    let mut conn = open_knowledge_index(&project_root)?;
    let existing_id = conn
        .query_row(
            "SELECT item_id FROM knowledge_items WHERE relative_path = ?1",
            params![normalized],
            |row| row.get::<_, String>(0),
        )
        .optional()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    let item_id = existing_id.unwrap_or_else(|| Uuid::new_v4().to_string());
    let updated_at = now_iso();
    let links = knowledge_extract_links(&item_id, &chunks);
    let tx = conn
        .transaction()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_chunks_fts WHERE evidence_id IN
         (SELECT evidence_id FROM knowledge_chunks WHERE item_id = ?1)",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_chunks_trigram WHERE evidence_id IN
         (SELECT evidence_id FROM knowledge_chunks WHERE item_id = ?1)",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_chunks WHERE item_id = ?1",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "DELETE FROM knowledge_links WHERE source_item_id = ?1",
        params![item_id],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    tx.execute(
        "INSERT INTO knowledge_items (
           item_id, project_id, relative_path, title, source_kind, content_hash,
           index_state, chunk_count, updated_at, failure_code
         ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'ready', ?7, ?8, NULL)
         ON CONFLICT(item_id) DO UPDATE SET
           relative_path=excluded.relative_path, title=excluded.title,
           source_kind=excluded.source_kind, content_hash=excluded.content_hash,
           index_state='ready', chunk_count=excluded.chunk_count,
           updated_at=excluded.updated_at, failure_code=NULL",
        params![
            item_id,
            project_id,
            normalized,
            title,
            source_kind,
            content_hash,
            chunks.len() as i64,
            updated_at
        ],
    )
    .map_err(|_| "knowledge.index.failed".to_string())?;
    for (index, chunk) in chunks.iter().enumerate() {
        let evidence_id = format!("knowledge:{item_id}:{index}");
        let anchor_json = serde_json::to_string(&chunk.anchor)
            .map_err(|_| "knowledge.index.failed".to_string())?;
        tx.execute(
            "INSERT INTO knowledge_chunks
             (evidence_id, item_id, chunk_index, anchor_json, text)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![evidence_id, item_id, index as i64, anchor_json, chunk.text],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
        tx.execute(
            "INSERT INTO knowledge_chunks_fts (evidence_id, text) VALUES (?1, ?2)",
            params![evidence_id, chunk.text],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
        tx.execute(
            "INSERT INTO knowledge_chunks_trigram (evidence_id, text) VALUES (?1, ?2)",
            params![evidence_id, chunk.text],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    }
    for (index, (kind, target)) in links.iter().enumerate() {
        tx.execute(
            "INSERT INTO knowledge_links
             (link_id, source_item_id, target_ref, kind, confidence)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                format!("{item_id}:{index}"),
                item_id,
                target,
                kind,
                if kind == "doi" { 1.0 } else { 0.9 }
            ],
        )
        .map_err(|_| "knowledge.index.failed".to_string())?;
    }
    replace_knowledge_auto_topics(&tx, &item_id, &chunks)?;
    invalidate_knowledge_embeddings(&tx)?;
    tx.commit()
        .map_err(|_| "knowledge.index.failed".to_string())?;
    Ok(crate::models::KnowledgeItem {
        item_id,
        project_id: project_id.to_string(),
        relative_path: normalized,
        title,
        source_kind,
        content_hash,
        index_state: "ready".to_string(),
        chunk_count: chunks.len() as u32,
        locked: true,
        updated_at,
        failure_code: None,
    })
}
