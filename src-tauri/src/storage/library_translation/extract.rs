use super::library_translation_ocr::{detect_source_language, extract_pdf_text_with_local_ocr};
use super::library_translation_types::{TranslationBlock, TranslationExtraction};
use std::fs;
use std::path::Path;

const PDF_FALLBACK_MAX_CHARS: usize = 36_000;
const PDF_CHUNK_TARGET: usize = 1_600;

fn split_pdf_blocks(source: &str) -> Vec<String> {
    let mut chunks: Vec<String> = Vec::new();
    let mut current = String::new();

    for line in source.lines() {
        let text = line.trim();
        if text.is_empty() {
            if current.chars().count() >= 140 {
                chunks.push(current.trim().to_string());
            }
            current.clear();
            continue;
        }

        let next_len = current.chars().count() + text.chars().count() + 1;
        if next_len > PDF_CHUNK_TARGET && !current.is_empty() {
            chunks.push(current.trim().to_string());
            current.clear();
        }
        if !current.is_empty() {
            current.push('\n');
        }
        current.push_str(text);
    }

    if !current.trim().is_empty() {
        chunks.push(current.trim().to_string());
    }

    if chunks.len() <= 1 {
        return chunks;
    }

    // Merge very short neighboring chunks for stable paragraph context.
    let mut merged = Vec::<String>::new();
    let mut pending = String::new();
    for item in chunks {
        if item.chars().count() < 90 {
            if !pending.is_empty() {
                pending.push('\n');
            }
            pending.push_str(&item);
            continue;
        }
        if !pending.is_empty() {
            pending.push('\n');
            pending.push_str(&item);
            merged.push(pending.trim().to_string());
            pending.clear();
        } else {
            merged.push(item);
        }
    }
    if !pending.trim().is_empty() {
        merged.push(pending.trim().to_string());
    }
    merged
}

pub(super) fn normalize_target_language(target_language: Option<&str>) -> String {
    let value = target_language.unwrap_or("").trim();
    if value.is_empty() {
        "Chinese (Simplified)".to_string()
    } else {
        value.to_string()
    }
}

pub(super) fn extract_translation_source(
    project_root: &Path,
    papers_root: &Path,
    relative_path: &str,
) -> Result<TranslationExtraction, String> {
    let normalized = relative_path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return Err("translation.path_required".to_string());
    }

    let source_path = super::safe_join(papers_root, &normalized)?;
    if !source_path.exists() || !source_path.is_file() {
        return Err("translation.source_not_found".to_string());
    }

    let source_ext = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("paper")
        .trim()
        .to_string();

    if matches!(
        source_ext.as_str(),
        "bib" | "tex" | "txt" | "md" | "csv" | "json" | "yaml" | "yml"
    ) {
        let content = fs::read_to_string(&source_path).map_err(|e| e.to_string())?;
        if content.trim().is_empty() {
            return Err("translation.source_empty".to_string());
        }
        return Ok(TranslationExtraction {
            normalized_relative_path: normalized,
            source_kind: source_ext.clone(),
            output_ext: source_ext,
            title_hint: stem,
            detected_language: detect_source_language(&content),
            extraction_engine: Some("native.text".to_string()),
            blocks: vec![TranslationBlock {
                id: "b1".to_string(),
                page: None,
                role: "body".to_string(),
                text: content,
                confidence: Some(0.96),
            }],
        });
    }

    if source_ext == "pdf" {
        let mut blocks: Vec<TranslationBlock> = Vec::new();
        let bib_candidate = source_path.with_extension("bib");
        if bib_candidate.exists() && bib_candidate.is_file() {
            let bib_text = fs::read_to_string(&bib_candidate).unwrap_or_default();
            if !bib_text.trim().is_empty() {
                blocks.push(TranslationBlock {
                    id: "bib-1".to_string(),
                    page: None,
                    role: "metadata".to_string(),
                    text: bib_text.trim().to_string(),
                    confidence: Some(0.90),
                });
            }
        }

        let binary = fs::read(&source_path).map_err(|e| e.to_string())?;
        let ocr = extract_pdf_text_with_local_ocr(&source_path, &binary, PDF_FALLBACK_MAX_CHARS)
            .ok_or_else(|| "translation.ocr_unavailable".to_string())?;

        let chunks = split_pdf_blocks(&ocr.text);
        for (index, chunk) in chunks.iter().enumerate() {
            blocks.push(TranslationBlock {
                id: format!("pdf-{}", index + 1),
                page: Some((index + 1) as u32),
                role: "paragraph".to_string(),
                text: chunk.clone(),
                confidence: Some(ocr.confidence),
            });
        }

        if blocks.is_empty() {
            return Err("translation.ocr_unavailable".to_string());
        }

        let combined = blocks
            .iter()
            .map(|item| item.text.as_str())
            .collect::<Vec<_>>()
            .join("\n");

        let _ = project_root;
        return Ok(TranslationExtraction {
            normalized_relative_path: normalized,
            source_kind: "pdf".to_string(),
            output_ext: "md".to_string(),
            title_hint: stem,
            detected_language: detect_source_language(&combined),
            extraction_engine: Some(ocr.engine),
            blocks,
        });
    }

    Err(format!("translation.unsupported_source_type: {source_ext}"))
}

