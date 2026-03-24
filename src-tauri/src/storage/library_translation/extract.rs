use super::library_translation_ocr::detect_source_language;
use super::library_translation_pdf_extract::extract_pdf_blocks_with_layout;
use super::library_translation_types::{TranslationBlock, TranslationExtraction};
use std::fs;
use std::path::Path;

const PDF_FALLBACK_MAX_CHARS: usize = 36_000;

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
            extraction_mode: Some("native".to_string()),
            page_count: 1,
            ocr_page_count: 0,
            blocks: vec![TranslationBlock {
                id: "b1".to_string(),
                page: None,
                role: "body".to_string(),
                text: content,
                confidence: Some(0.96),
                bounds: None,
                text_source: Some("native".to_string()),
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
                    bounds: None,
                    text_source: Some("native".to_string()),
                });
            }
        }

        let pdf_extraction = extract_pdf_blocks_with_layout(&source_path, PDF_FALLBACK_MAX_CHARS)?;
        blocks.extend(pdf_extraction.blocks);
        if blocks.is_empty() {
            return Err("translation.ocr_unavailable".to_string());
        }

        let _ = project_root;
        return Ok(TranslationExtraction {
            normalized_relative_path: normalized,
            source_kind: "pdf".to_string(),
            output_ext: "pdf".to_string(),
            title_hint: stem,
            detected_language: pdf_extraction.detected_language,
            extraction_engine: pdf_extraction.extraction_engine,
            extraction_mode: Some(pdf_extraction.extraction_mode),
            page_count: pdf_extraction.page_count,
            ocr_page_count: pdf_extraction.ocr_page_count,
            blocks,
        });
    }

    Err(format!("translation.unsupported_source_type: {source_ext}"))
}
