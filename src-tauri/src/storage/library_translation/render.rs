use super::library_translation_types::{
    TranslationExtraction, TranslationLayoutPlan, TranslationLayoutResult, TranslationPersistResult,
};
use std::fs;
use std::path::Path;

const PDF_WIDTH: i32 = 595;
const PDF_HEIGHT: i32 = 842;
const PDF_MARGIN_X: i32 = 40;
const PDF_MARGIN_TOP: i32 = 40;
const PDF_MARGIN_BOTTOM: i32 = 40;
const PDF_FONT_SIZE: i32 = 11;
const PDF_LINE_HEIGHT: i32 = 14;

fn text_units(ch: char) -> usize {
    if ch.is_ascii() {
        if ch == ' ' {
            1
        } else {
            2
        }
    } else {
        3
    }
}

fn wrap_line_units(line: &str, max_units: usize) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut current = String::new();
    let mut units = 0_usize;

    for ch in line.chars() {
        let next = text_units(ch);
        if !current.is_empty() && units + next > max_units {
            out.push(current.trim_end().to_string());
            current.clear();
            units = 0;
        }
        current.push(ch);
        units += next;
    }

    if !current.trim().is_empty() {
        out.push(current.trim_end().to_string());
    }
    out
}

fn wrap_text_block(text: &str, max_units: usize) -> Vec<String> {
    let mut lines = Vec::<String>::new();
    for raw in text.lines() {
        let trimmed = raw.trim();
        if trimmed.is_empty() {
            if !lines.last().map(|item| item.is_empty()).unwrap_or(false) {
                lines.push(String::new());
            }
            continue;
        }
        lines.extend(wrap_line_units(trimmed, max_units));
    }
    lines
}

fn to_utf16be_hex(text: &str) -> String {
    let mut bytes = Vec::<u8>::new();
    bytes.push(0xFE);
    bytes.push(0xFF);
    for unit in text.encode_utf16() {
        bytes.push((unit >> 8) as u8);
        bytes.push((unit & 0xFF) as u8);
    }
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push_str(&format!("{byte:02X}"));
    }
    out
}

fn build_pdf_pages(lines: &[String]) -> Vec<Vec<String>> {
    let available_height = PDF_HEIGHT - PDF_MARGIN_TOP - PDF_MARGIN_BOTTOM;
    let per_page = (available_height / PDF_LINE_HEIGHT).max(1) as usize;
    let mut pages = Vec::<Vec<String>>::new();
    let mut current = Vec::<String>::new();
    for line in lines {
        if current.len() >= per_page {
            pages.push(current);
            current = Vec::new();
        }
        current.push(line.clone());
    }
    if current.is_empty() {
        current.push(String::new());
    }
    pages.push(current);
    pages
}

fn build_page_stream(lines: &[String]) -> String {
    let start_y = PDF_HEIGHT - PDF_MARGIN_TOP - PDF_FONT_SIZE;
    let mut stream = String::new();
    stream.push_str("BT\n");
    stream.push_str(&format!("/F1 {PDF_FONT_SIZE} Tf\n"));
    stream.push_str(&format!("{} TL\n", PDF_LINE_HEIGHT));
    stream.push_str(&format!("{} {} Td\n", PDF_MARGIN_X, start_y));

    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            stream.push_str("T*\n");
        }
        let text = if line.trim().is_empty() { " " } else { line.trim() };
        stream.push_str(&format!("<{}> Tj\n", to_utf16be_hex(text)));
    }

    stream.push_str("ET\n");
    stream
}

fn write_simple_unicode_pdf(path: &Path, lines: &[String]) -> Result<(), String> {
    let pages = build_pdf_pages(lines);
    let mut objects = Vec::<(usize, String)>::new();
    objects.push((1, "<< /Type /Catalog /Pages 2 0 R >>".to_string()));

    let mut kids = Vec::<String>::new();
    for index in 0..pages.len() {
        let page_id = 4 + index * 2;
        kids.push(format!("{page_id} 0 R"));
    }
    objects.push((
        2,
        format!(
            "<< /Type /Pages /Count {} /Kids [ {} ] >>",
            pages.len(),
            kids.join(" ")
        ),
    ));

    objects.push((
        3,
        "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >> ] >>".to_string(),
    ));

    for (index, page_lines) in pages.iter().enumerate() {
        let page_id = 4 + index * 2;
        let content_id = page_id + 1;
        let stream = build_page_stream(page_lines);
        let content_obj = format!(
            "<< /Length {} >>\nstream\n{}endstream",
            stream.as_bytes().len(),
            stream
        );
        let page_obj = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
            PDF_WIDTH,
            PDF_HEIGHT,
            content_id
        );
        objects.push((page_id, page_obj));
        objects.push((content_id, content_obj));
    }

    objects.sort_by_key(|item| item.0);

    let mut out = Vec::<u8>::new();
    out.extend_from_slice(b"%PDF-1.4\n%");
    out.extend_from_slice(&[0xE2, 0xE3, 0xCF, 0xD3]);
    out.extend_from_slice(b"\n");

    let max_obj = objects.last().map(|item| item.0).unwrap_or(0);
    let mut offsets = vec![0_usize; max_obj + 1];

    for (id, body) in &objects {
        offsets[*id] = out.len();
        out.extend_from_slice(format!("{} 0 obj\n{}\nendobj\n", id, body).as_bytes());
    }

    let xref_offset = out.len();
    out.extend_from_slice(format!("xref\n0 {}\n", max_obj + 1).as_bytes());
    out.extend_from_slice(b"0000000000 65535 f \n");
    for id in 1..=max_obj {
        out.extend_from_slice(format!("{:010} 00000 n \n", offsets[id]).as_bytes());
    }
    out.extend_from_slice(
        format!(
            "trailer\n<< /Size {} /Root 1 0 R >>\nstartxref\n{}\n%%EOF\n",
            max_obj + 1,
            xref_offset
        )
        .as_bytes(),
    );

    fs::write(path, out).map_err(|e| e.to_string())
}

fn build_translated_lines(
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
) -> Vec<String> {
    let mut lines = vec![format!("{} · Translation", extraction.title_hint.trim())];

    for section in &layout.sections {
        let translated_section = translated.sections.iter().find(|item| item.id == section.id);
        let title = translated_section
            .map(|item| item.title.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(section.title.as_str());
        let text = translated_section
            .map(|item| item.translated_text.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("");

        lines.push(String::new());
        lines.push(format!("# {title}"));
        lines.extend(wrap_text_block(text, 118));
    }

    if !translated.glossary.is_empty() {
        lines.push(String::new());
        lines.push("# Glossary".to_string());
        for item in translated.glossary.iter().take(120) {
            lines.extend(wrap_text_block(
                &format!("- {} => {}", item.source_term.trim(), item.target_term.trim()),
                118,
            ));
        }
    }

    lines
}

fn to_relative(papers_root: &Path, path: &Path) -> Result<String, String> {
    path
        .strip_prefix(papers_root)
        .map_err(|_| "translation.output_path_failed".to_string())
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

pub(super) fn persist_translation_result(
    papers_root: &Path,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
    source_pdf_relative: &str,
) -> Result<TranslationPersistResult, String> {
    let lines = build_translated_lines(extraction, layout, translated);
    if lines.is_empty() {
        return Err("translation.empty_output".to_string());
    }

    let relative = super::translation_pdf_relative_path(source_pdf_relative);
    let output_path = papers_root.join(Path::new(&relative));
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    write_simple_unicode_pdf(&output_path, &lines)?;
    let primary_relative = to_relative(papers_root, &output_path)?;

    Ok(TranslationPersistResult {
        primary_relative_path: primary_relative,
        artifact_paths: Vec::new(),
    })
}
