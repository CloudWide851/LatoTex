use super::library_translation_types::{TranslationGlossaryEntry, TranslationMemoryHit};
use rusqlite::{params, Connection};
use std::collections::HashSet;
use std::path::Path;

fn ensure_translation_memory_schema(conn: &Connection) -> Result<(), String> {
    conn.execute_batch(
        "
        CREATE TABLE IF NOT EXISTS translation_terms (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            project_id TEXT NOT NULL,
            source_term TEXT NOT NULL,
            target_term TEXT NOT NULL,
            target_language TEXT NOT NULL,
            confidence REAL NOT NULL DEFAULT 0.6,
            hit_count INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(project_id, target_language, source_term)
        );
        CREATE INDEX IF NOT EXISTS idx_translation_terms_lookup
          ON translation_terms(project_id, target_language, updated_at DESC);
        ",
    )
    .map_err(|e| e.to_string())
}

fn normalize_term(raw: &str) -> Option<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() || trimmed.len() > 80 {
        return None;
    }
    let mut cleaned = String::new();
    let mut prev_space = false;
    for ch in trimmed.chars() {
        let keep = ch.is_alphanumeric()
            || ch == '_'
            || ch == '-'
            || ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ch == ' ';
        if !keep {
            continue;
        }
        if ch == ' ' {
            if prev_space {
                continue;
            }
            prev_space = true;
        } else {
            prev_space = false;
        }
        cleaned.push(ch);
    }
    let final_text = cleaned.trim();
    if final_text.len() < 2 {
        None
    } else {
        Some(final_text.to_string())
    }
}

fn extract_candidate_terms(text: &str, max_items: usize) -> Vec<String> {
    let mut set = HashSet::<String>::new();
    for token in text.split(|ch: char| {
        ch.is_whitespace()
            || matches!(ch, ',' | ';' | '，' | '。' | ':' | '：' | '(' | ')' | '[' | ']')
    }) {
        if set.len() >= max_items {
            break;
        }
        if let Some(term) = normalize_term(token) {
            if term.chars().count() >= 2 {
                set.insert(term);
            }
        }
    }
    let mut out = set.into_iter().collect::<Vec<_>>();
    out.sort();
    out
}

pub(super) fn load_translation_memory_hits(
    db_path: &Path,
    project_id: &str,
    target_language: &str,
    source_text: &str,
    limit: usize,
) -> Result<Vec<TranslationMemoryHit>, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    ensure_translation_memory_schema(&conn)?;

    let candidates = extract_candidate_terms(source_text, 380);
    if candidates.is_empty() {
        return Ok(Vec::new());
    }

    let mut stmt = conn
        .prepare(
            "SELECT source_term, target_term, confidence, hit_count
             FROM translation_terms
             WHERE project_id = ?1 AND target_language = ?2
             ORDER BY hit_count DESC, updated_at DESC
             LIMIT 1600",
        )
        .map_err(|e| e.to_string())?;

    let rows = stmt
        .query_map(params![project_id, target_language], |row| {
            Ok(TranslationMemoryHit {
                source_term: row.get(0)?,
                target_term: row.get(1)?,
                confidence: row.get::<_, f64>(2)? as f32,
                hit_count: row.get(3)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut hits = Vec::new();
    let candidate_join = format!(" {} ", candidates.join(" ").to_lowercase());
    for row in rows {
        let item = row.map_err(|e| e.to_string())?;
        let term = item.source_term.to_lowercase();
        if candidate_join.contains(&term) || source_text.to_lowercase().contains(&term) {
            hits.push(item);
        }
        if hits.len() >= limit {
            break;
        }
    }

    for item in &hits {
        let _ = conn.execute(
            "UPDATE translation_terms
             SET hit_count = hit_count + 1, updated_at = ?4
             WHERE project_id = ?1 AND target_language = ?2 AND source_term = ?3",
            params![project_id, target_language, item.source_term, super::now_iso()],
        );
    }

    Ok(hits)
}

pub(super) fn persist_translation_glossary(
    db_path: &Path,
    project_id: &str,
    target_language: &str,
    glossary: &[TranslationGlossaryEntry],
) -> Result<usize, String> {
    if glossary.is_empty() {
        return Ok(0);
    }
    let mut conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    ensure_translation_memory_schema(&conn)?;

    let tx = conn.transaction().map_err(|e| e.to_string())?;
    let mut written = 0_usize;
    let now = super::now_iso();
    for entry in glossary {
        let Some(source_term) = normalize_term(&entry.source_term) else {
            continue;
        };
        let Some(target_term) = normalize_term(&entry.target_term) else {
            continue;
        };
        let confidence = entry.confidence.unwrap_or(0.62_f32).clamp(0.05, 1.0) as f64;
        tx.execute(
            "INSERT INTO translation_terms (
               project_id, source_term, target_term, target_language,
               confidence, hit_count, created_at, updated_at
             ) VALUES (?1, ?2, ?3, ?4, ?5, 1, ?6, ?6)
             ON CONFLICT(project_id, target_language, source_term)
             DO UPDATE SET
               target_term = excluded.target_term,
               confidence = CASE
                 WHEN excluded.confidence > translation_terms.confidence THEN excluded.confidence
                 ELSE translation_terms.confidence
               END,
               hit_count = translation_terms.hit_count + 1,
               updated_at = excluded.updated_at",
            params![project_id, source_term, target_term, target_language, confidence, now],
        )
        .map_err(|e| e.to_string())?;
        written += 1;
    }

    tx.execute(
        "DELETE FROM translation_terms
         WHERE id IN (
           SELECT id FROM translation_terms
           WHERE project_id = ?1 AND target_language = ?2
           ORDER BY hit_count DESC, updated_at DESC
           LIMIT -1 OFFSET 8000
         )",
        params![project_id, target_language],
    )
    .map_err(|e| e.to_string())?;

    tx.commit().map_err(|e| e.to_string())?;
    Ok(written)
}

pub(super) fn memory_hits_to_prompt_block(hits: &[TranslationMemoryHit]) -> String {
    if hits.is_empty() {
        return String::new();
    }
    let mut lines = Vec::new();
    lines.push("[translation_memory.glossary.v1]".to_string());
    for item in hits.iter().take(32) {
        lines.push(format!(
            "- {} => {} (confidence={:.2}, hits={})",
            item.source_term, item.target_term, item.confidence, item.hit_count
        ));
    }
    lines.join("\n")
}
