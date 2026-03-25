use super::{
    library_citation_summary, library_root, resolve_translation_source_pdf_workspace,
    to_library_relative_from_workspace,
};
use crate::commands::native_runtime::{
    configure_hidden_process, ensure_analysis_env_blocking, resolve_analysis_runtime_root,
};
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

const PAPER_ANALYSIS_CHUNK_MAX_CHARS: usize = 10_000;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperRuntimeExtractBlock {
    page: Option<u32>,
    role: String,
    text: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperRuntimeExtractResult {
    page_count: u32,
    ocr_page_count: u32,
    detected_language: Option<String>,
    extraction_engine: Option<String>,
    extraction_mode: Option<String>,
    blocks: Vec<PaperRuntimeExtractBlock>,
}

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
    blocks: &[PaperRuntimeExtractBlock],
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

fn run_extract_bridge(
    python_path: &Path,
    runtime_root: &Path,
    run_root: &Path,
    source_pdf_path: &Path,
) -> Result<PaperRuntimeExtractResult, String> {
    let input_path = run_root.join("paper-runtime-input.json");
    let output_path = run_root.join("paper-runtime-output.json");
    let payload = json!({
        "operation": "extract",
        "pdfPath": source_pdf_path,
    });
    fs::write(
        &input_path,
        serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let mut command = Command::new(python_path);
    configure_hidden_process(&mut command);
    let output = command
        .arg(runtime_root.join("paper_runtime.py"))
        .arg("--input")
        .arg(&input_path)
        .arg("--output")
        .arg(&output_path)
        .output()
        .map_err(|error| format!("analysis.paper_extract.spawn_failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("analysis.paper_extract.failed: {detail}"));
    }

    let output_json = fs::read_to_string(&output_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&output_json)
        .map_err(|error| format!("analysis.paper_extract.invalid_json: {error}"))
}

pub(super) fn extract_library_paper_context(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<crate::models::LibraryPaperExtractResponse, String> {
    let project_root = super::load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|error| error.to_string())?;

    let normalized_relative = relative_path.trim().replace('\\', "/");
    if normalized_relative.is_empty() {
        return Err("translation.path_required".to_string());
    }

    let preview_relative_path =
        resolve_translation_source_pdf_workspace(db_path, project_id, &normalized_relative)?;
    let source_pdf_relative = to_library_relative_from_workspace(&preview_relative_path)?;
    let source_pdf_path = papers_root.join(Path::new(&source_pdf_relative));
    if !source_pdf_path.exists() || !source_pdf_path.is_file() {
        return Err("translation.source_pdf_not_found".to_string());
    }

    let env_status = ensure_analysis_env_blocking(&project_root)?;
    let python_path = PathBuf::from(
        env_status
            .python_path
            .clone()
            .ok_or_else(|| "python.env.python_missing".to_string())?,
    );
    let runtime_root = resolve_analysis_runtime_root()
        .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
    let run_root = project_root
        .join(".latotex")
        .join("paper-runtime")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&run_root).map_err(|error| error.to_string())?;

    let extraction = run_extract_bridge(&python_path, &runtime_root, &run_root, &source_pdf_path)?;
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
