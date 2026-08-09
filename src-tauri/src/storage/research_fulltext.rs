use crate::models::{
    EvidenceLocator, ResearchFulltextBlock, ResearchFulltextDocument,
    ResearchFulltextDocumentGetInput,
};

const RESEARCH_FULLTEXT_PDF_LIMIT: usize = 64 * 1024 * 1024;
const RESEARCH_FULLTEXT_BLOCK_LIMIT: usize = 20_000;
const RESEARCH_FULLTEXT_BLOCK_CHAR_LIMIT: usize = 32_768;

fn research_fulltext_hash(bytes: &[u8]) -> String {
    ring::digest::digest(&ring::digest::SHA256, bytes)
        .as_ref()
        .iter()
        .map(|byte| format!("{byte:02x}"))
        .collect()
}

fn research_fulltext_text_hash(text: &str) -> String {
    let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
    research_fulltext_hash(normalized.as_bytes())
}

fn fulltext_paragraphs(
    document_hash: &str,
    pages: Vec<(u32, String)>,
) -> Result<Vec<ResearchFulltextBlock>, String> {
    let mut blocks = Vec::new();
    for (page, text) in pages {
        if page == 0 {
            return Err("research.fulltext.page_invalid".to_string());
        }
        let mut paragraph_index = 0_u32;
        for paragraph in text.split("\n\n") {
            let normalized = paragraph.split_whitespace().collect::<Vec<_>>().join(" ");
            if normalized.is_empty() {
                continue;
            }
            if normalized.chars().count() > RESEARCH_FULLTEXT_BLOCK_CHAR_LIMIT
                || blocks.len() >= RESEARCH_FULLTEXT_BLOCK_LIMIT
            {
                return Err("research.fulltext.blocks_invalid".to_string());
            }
            blocks.push(ResearchFulltextBlock {
                document_hash: document_hash.to_string(),
                page,
                paragraph_index,
                text_hash: research_fulltext_text_hash(&normalized),
                text: normalized,
            });
            paragraph_index = paragraph_index.saturating_add(1);
        }
    }
    if blocks.is_empty() {
        return Err("research.fulltext.blocks_invalid".to_string());
    }
    Ok(blocks)
}

pub(crate) fn cache_research_fulltext_document(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    project_root: &Path,
    source_url: &str,
    pdf_bytes: &[u8],
    pages: Vec<(u32, String)>,
) -> Result<ResearchFulltextDocument, String> {
    if pdf_bytes.len() > RESEARCH_FULLTEXT_PDF_LIMIT
        || !pdf_bytes.starts_with(b"%PDF-")
        || !source_url.starts_with("https://")
    {
        return Err("research.fulltext.document_invalid".to_string());
    }
    let document_hash = research_fulltext_hash(pdf_bytes);
    let blocks = fulltext_paragraphs(&document_hash, pages)?;
    let page_count = blocks.iter().map(|block| block.page).max().unwrap_or(0);
    let relative_path = format!(".latotex/research/fulltext/{document_hash}.pdf");
    let target = prepare_workspace_mutation_path(project_root, &relative_path)?;
    atomic_write_file(&target, pdf_bytes)?;

    let source_url_envelope = seal_research_json(
        runtime_root,
        project_id,
        "fulltext",
        &document_hash,
        "source-url",
        &source_url,
    )?;
    let mut conn = open_research_database(db_path, project_id)?;
    let transaction = conn
        .transaction_with_behavior(TransactionBehavior::Immediate)
        .map_err(|_| "research.fulltext.write_failed".to_string())?;
    let created_at = now_iso();
    transaction
        .execute(
            "INSERT INTO research_fulltext_documents
             (document_hash, source_url_envelope, relative_path, byte_size, page_count, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)
             ON CONFLICT(document_hash) DO UPDATE SET
                source_url_envelope = excluded.source_url_envelope,
                relative_path = excluded.relative_path,
                byte_size = excluded.byte_size,
                page_count = excluded.page_count",
            params![
                document_hash,
                source_url_envelope,
                relative_path,
                pdf_bytes.len() as u64,
                page_count,
                created_at,
            ],
        )
        .map_err(|_| "research.fulltext.write_failed".to_string())?;
    transaction
        .execute(
            "DELETE FROM research_fulltext_blocks WHERE document_hash = ?1",
            params![document_hash],
        )
        .map_err(|_| "research.fulltext.write_failed".to_string())?;
    for block in &blocks {
        let entity_id = format!("{}:{}:{}", document_hash, block.page, block.paragraph_index);
        let text_envelope = seal_research_json(
            runtime_root,
            project_id,
            "fulltext-block",
            &entity_id,
            "text",
            &block.text,
        )?;
        transaction
            .execute(
                "INSERT INTO research_fulltext_blocks
                 (document_hash, page, paragraph_index, text_envelope, text_hash)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
                params![
                    document_hash,
                    block.page,
                    block.paragraph_index,
                    text_envelope,
                    block.text_hash,
                ],
            )
            .map_err(|_| "research.fulltext.write_failed".to_string())?;
    }
    transaction
        .commit()
        .map_err(|_| "research.fulltext.write_failed".to_string())?;
    Ok(ResearchFulltextDocument {
        project_id: project_id.to_string(),
        document_hash,
        source_url: source_url.to_string(),
        relative_path,
        byte_size: pdf_bytes.len() as u64,
        page_count,
        blocks,
        created_at,
    })
}

pub fn load_research_fulltext_document(
    db_path: &Path,
    runtime_root: &Path,
    input: ResearchFulltextDocumentGetInput,
) -> Result<ResearchFulltextDocument, String> {
    if input.document_hash.len() != 64
        || !input
            .document_hash
            .chars()
            .all(|character| character.is_ascii_hexdigit())
    {
        return Err("research.fulltext.hash_invalid".to_string());
    }
    let project_root = load_project_root(db_path, &input.project_id)?;
    let conn = open_research_database(db_path, &input.project_id)?;
    let raw = conn
        .query_row(
            "SELECT source_url_envelope, relative_path, byte_size, page_count, created_at
             FROM research_fulltext_documents WHERE document_hash = ?1",
            params![input.document_hash],
            |row| {
                Ok((
                    row.get::<_, String>(0)?,
                    row.get::<_, String>(1)?,
                    row.get::<_, u64>(2)?,
                    row.get::<_, u32>(3)?,
                    row.get::<_, String>(4)?,
                ))
            },
        )
        .map_err(|_| "research.fulltext.not_found".to_string())?;
    let expected_relative = format!(".latotex/research/fulltext/{}.pdf", input.document_hash);
    if raw.1 != expected_relative {
        return Err("research.fulltext.path_invalid".to_string());
    }
    let cached = read_binary_under_root(&project_root, &raw.1, RESEARCH_FULLTEXT_PDF_LIMIT as u64)?;
    if research_fulltext_hash(&cached) != input.document_hash {
        return Err("research.fulltext.hash_mismatch".to_string());
    }
    let mut statement = conn
        .prepare(
            "SELECT page, paragraph_index, text_envelope, text_hash
             FROM research_fulltext_blocks WHERE document_hash = ?1
             ORDER BY page, paragraph_index",
        )
        .map_err(|_| "research.fulltext.query_failed".to_string())?;
    let rows = statement
        .query_map(params![input.document_hash], |row| {
            Ok((
                row.get::<_, u32>(0)?,
                row.get::<_, u32>(1)?,
                row.get::<_, String>(2)?,
                row.get::<_, String>(3)?,
            ))
        })
        .map_err(|_| "research.fulltext.query_failed".to_string())?;
    let mut blocks = Vec::new();
    for row in rows {
        let (page, paragraph_index, text_envelope, text_hash) =
            row.map_err(|_| "research.fulltext.query_failed".to_string())?;
        let entity_id = format!("{}:{}:{}", input.document_hash, page, paragraph_index);
        let text: String = open_research_json(
            runtime_root,
            &input.project_id,
            "fulltext-block",
            &entity_id,
            "text",
            &text_envelope,
        )?;
        if research_fulltext_text_hash(&text) != text_hash {
            return Err("research.fulltext.text_hash_mismatch".to_string());
        }
        blocks.push(ResearchFulltextBlock {
            document_hash: input.document_hash.clone(),
            page,
            paragraph_index,
            text,
            text_hash,
        });
    }
    Ok(ResearchFulltextDocument {
        project_id: input.project_id.clone(),
        document_hash: input.document_hash.clone(),
        source_url: open_research_json(
            runtime_root,
            &input.project_id,
            "fulltext",
            &input.document_hash,
            "source-url",
            &raw.0,
        )?,
        relative_path: raw.1,
        byte_size: raw.2,
        page_count: raw.3,
        blocks,
        created_at: raw.4,
    })
}

pub(crate) fn validate_research_fulltext_anchor(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    locator: &EvidenceLocator,
    excerpt: &str,
) -> Result<(), String> {
    let fields = (
        locator.document_hash.as_deref(),
        locator.page,
        locator.paragraph_index,
        locator.text_hash.as_deref(),
    );
    let anchored_locator = fields.0.is_some() || fields.2.is_some() || fields.3.is_some();
    if !anchored_locator {
        return Ok(());
    }
    let (Some(document_hash), Some(page), Some(paragraph_index), Some(text_hash)) = fields else {
        return Err("research.evidence.locator_incomplete".to_string());
    };
    let document = load_research_fulltext_document(
        db_path,
        runtime_root,
        ResearchFulltextDocumentGetInput {
            project_id: project_id.to_string(),
            document_hash: document_hash.to_string(),
        },
    )?;
    let block = document
        .blocks
        .iter()
        .find(|block| block.page == page && block.paragraph_index == paragraph_index)
        .ok_or_else(|| "research.evidence.locator_not_found".to_string())?;
    let normalized_excerpt = excerpt.split_whitespace().collect::<Vec<_>>().join(" ");
    if block.text_hash != text_hash
        || normalized_excerpt.is_empty()
        || !block.text.contains(&normalized_excerpt)
    {
        return Err("research.evidence.locator_mismatch".to_string());
    }
    Ok(())
}
