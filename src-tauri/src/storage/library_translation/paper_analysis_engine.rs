use super::{
    library_citation_summary, library_root, library_translation_ocr_engine,
    library_translation_types::TranslationBlock, resolve_translation_source_pdf_workspace,
    to_library_relative_from_workspace,
};
use std::fs;
use std::path::Path;

const PAPER_ANALYSIS_CHUNK_MAX_CHARS: usize = 10_000;

fn build_library_metadata_block(summary: &crate::models::LibraryCitationSummaryResponse) -> String {
    [
        format!("Title: {}", summary.title.clone().unwrap_or_else(|| "-".to_string())),
        format!(
            "Authors: {}",
            if summary.authors.is_empty() {
                "-".to_string()
            } else {
                summary.authors.join(", ")
            }
        ),
        format!(
            "Published: {}",
            summary.published_at.clone().unwrap_or_else(|| "-".to_string())
        ),
        format!("DOI: {}", summary.doi.clone().unwrap_or_else(|| "-".to_string())),
        format!(
            "ArXiv: {}",
            summary.arxiv_id.clone().unwrap_or_else(|| "-".to_string())
        ),
        format!(
            "Source: {}",
            summary.source.clone().unwrap_or_else(|| "-".to_string())
        ),
        format!(
            "URLs: {}",
            if summary.urls.is_empty() {
                "-".to_string()
            } else {
                summary.urls.join(", ")
            }
        ),
    ]
    .join("\n")
}

fn push_analysis_chunk(
    chunks: &mut Vec<crate::models::LibraryPaperExtractChunk>,
    buffer: &mut String,
    page_start: u32,
    page_end: u32,
) {
    if buffer.trim().is_empty() {
        buffer.clear();
        return;
    }
    let chunk_index = chunks.len() as u32;
    chunks.push(crate::models::LibraryPaperExtractChunk {
        chunk_index,
        page_start,
        page_end,
        text: buffer.trim().to_string(),
    });
    buffer.clear();
}

fn build_paper_analysis_chunks(
    blocks: &[TranslationBlock],
    max_chars: usize,
) -> Vec<crate::models::LibraryPaperExtractChunk> {
    let mut chunks = Vec::<crate::models::LibraryPaperExtractChunk>::new();
    let mut buffer = String::new();
    let mut page_start = 1_u32;
    let mut page_end = 1_u32;
    let mut last_page = 0_u32;

    for block in blocks {
        if block.role == "metadata" {
            continue;
        }
        let text = block.text.trim();
        if text.is_empty() {
            continue;
        }
        let page = block.page.unwrap_or(last_page.max(1));
        let page_heading = if page != last_page || buffer.is_empty() {
            format!("[Page {page}]\n")
        } else {
            String::new()
        };
        let segment = if buffer.is_empty() {
            format!("{page_heading}{text}")
        } else if page != last_page {
            format!("\n\n{page_heading}{text}")
        } else {
            format!("\n\n{text}")
        };

        if !buffer.is_empty() && buffer.chars().count() + segment.chars().count() > max_chars {
            push_analysis_chunk(&mut chunks, &mut buffer, page_start, page_end);
            page_start = page;
            page_end = page;
            buffer = format!("[Page {page}]\n{text}");
        } else {
            if buffer.is_empty() {
                page_start = page;
            }
            buffer.push_str(&segment);
            page_end = page;
        }
        last_page = page;
    }

    push_analysis_chunk(&mut chunks, &mut buffer, page_start, page_end);
    chunks
}

pub(super) fn extract_library_paper_context(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<crate::models::LibraryPaperExtractResponse, String> {
    let project_root = super::load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let normalized_relative = relative_path.trim().replace('\\', "/");
    if normalized_relative.is_empty() {
        return Err("translation.path_required".to_string());
    }

    let preview_relative_path =
        resolve_translation_source_pdf_workspace(db_path, project_id, &normalized_relative)?;
    let source_pdf_relative = to_library_relative_from_workspace(&preview_relative_path)?;
    let extraction = library_translation_ocr_engine::extract_document(
        &project_root,
        &papers_root,
        &source_pdf_relative,
    )?;
    let citation = library_citation_summary(db_path, project_id, &normalized_relative)?;
    let title = citation
        .title
        .clone()
        .filter(|value| !value.trim().is_empty())
        .unwrap_or_else(|| {
            Path::new(&normalized_relative)
                .file_name()
                .and_then(|value| value.to_str())
                .unwrap_or(normalized_relative.as_str())
                .to_string()
        });
    let metadata_block = build_library_metadata_block(&citation);
    let chunks = build_paper_analysis_chunks(&extraction.blocks, PAPER_ANALYSIS_CHUNK_MAX_CHARS);

    Ok(crate::models::LibraryPaperExtractResponse {
        source_path: normalized_relative,
        title,
        metadata_block,
        chunks,
        pdf_relative_path: Some(preview_relative_path),
        detected_language: extraction.detected_language,
        extraction_engine: extraction.extraction_engine,
        extraction_mode: extraction.extraction_mode,
        page_count: extraction.page_count,
        ocr_page_count: extraction.ocr_page_count,
    })
}
