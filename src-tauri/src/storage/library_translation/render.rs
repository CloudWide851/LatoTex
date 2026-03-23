use super::library_translation_types::{
    TranslationBlockBounds, TranslationExtraction, TranslationLayoutPlan,
    TranslationLayoutResult, TranslationPersistResult,
};
use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::Path;

const PDF_WIDTH: i32 = 595;
const PDF_HEIGHT: i32 = 842;
const PDF_MARGIN_X: i32 = 40;
const PDF_MARGIN_TOP: i32 = 40;
const PDF_MARGIN_BOTTOM: i32 = 40;
const PDF_FONT_SIZE: i32 = 11;
const PDF_LINE_HEIGHT: i32 = 14;
const PDF_MIN_FONT_SIZE: i32 = 7;
const PDF_TEXT_INSET: f32 = 2.0;

#[derive(Clone)]
struct PositionedPdfPage {
    width: i32,
    height: i32,
    streams: Vec<String>,
}

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
    let page_specs = pages
        .into_iter()
        .map(|page_lines| PositionedPdfPage {
            width: PDF_WIDTH,
            height: PDF_HEIGHT,
            streams: vec![build_page_stream(&page_lines)],
        })
        .collect::<Vec<_>>();
    write_positioned_unicode_pdf(path, &page_specs)
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

    lines
}

fn to_relative(papers_root: &Path, path: &Path) -> Result<String, String> {
    path
        .strip_prefix(papers_root)
        .map_err(|_| "translation.output_path_failed".to_string())
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

fn approx_units_for_width(width: f32, font_size: i32) -> usize {
    let unit_width = (font_size as f32 * 0.58).max(3.5);
    (((width - PDF_TEXT_INSET * 2.0).max(unit_width)) / unit_width)
        .floor()
        .max(4.0) as usize
}

fn fit_lines_to_bounds(text: &str, bounds: &TranslationBlockBounds) -> (Vec<String>, i32, i32) {
    for font_size in (PDF_MIN_FONT_SIZE..=12).rev() {
        let max_units = approx_units_for_width(bounds.width, font_size);
        let lines = wrap_text_block(text, max_units);
        let line_height = ((font_size as f32) * 1.25).ceil().max((font_size + 1) as f32) as i32;
        let needed_height = (lines.len() as i32) * line_height;
        if needed_height as f32 <= (bounds.height - PDF_TEXT_INSET * 2.0).max(line_height as f32) {
            return (lines, font_size, line_height);
        }
    }

    let font_size = PDF_MIN_FONT_SIZE;
    let line_height = ((font_size as f32) * 1.25).ceil().max((font_size + 1) as f32) as i32;
    let max_units = approx_units_for_width(bounds.width, font_size);
    let mut lines = wrap_text_block(text, max_units);
    let max_lines = ((bounds.height - PDF_TEXT_INSET * 2.0).max(line_height as f32) / line_height as f32)
        .floor()
        .max(1.0) as usize;
    if lines.len() > max_lines {
        lines.truncate(max_lines);
        if let Some(last) = lines.last_mut() {
            if last.chars().count() > 2 {
                last.push('…');
            }
        }
    }
    (lines, font_size, line_height)
}

fn build_positioned_text_stream(
    bounds: &TranslationBlockBounds,
    text: &str,
) -> Option<String> {
    let trimmed = text.trim();
    if trimmed.is_empty() {
        return None;
    }
    let (lines, font_size, line_height) = fit_lines_to_bounds(trimmed, bounds);
    if lines.is_empty() {
        return None;
    }
    let x = (bounds.x + PDF_TEXT_INSET).max(0.0);
    let y = (bounds.page_height - bounds.y - PDF_TEXT_INSET - font_size as f32).max(0.0);
    let mut stream = String::new();
    stream.push_str("BT\n");
    stream.push_str(&format!("/F1 {} Tf\n", font_size));
    stream.push_str(&format!("{} TL\n", line_height));
    stream.push_str(&format!("1 0 0 1 {:.2} {:.2} Tm\n", x, y));
    for (index, line) in lines.iter().enumerate() {
        if index > 0 {
            stream.push_str("T*\n");
        }
        let value = if line.trim().is_empty() { " " } else { line.trim() };
        stream.push_str(&format!("<{}> Tj\n", to_utf16be_hex(value)));
    }
    stream.push_str("ET\n");
    Some(stream)
}

fn page_dimension(value: f32, fallback: i32) -> i32 {
    let rounded = value.ceil() as i32;
    if rounded > 0 { rounded } else { fallback }
}

fn build_positioned_pdf_pages(
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
) -> Option<Vec<PositionedPdfPage>> {
    if extraction.source_kind != "pdf" {
        return None;
    }

    let mut pages = BTreeMap::<u32, PositionedPdfPage>::new();
    for block in &extraction.blocks {
        let Some(page) = block.page else {
            continue;
        };
        let Some(bounds) = block.bounds.as_ref() else {
            continue;
        };
        pages.entry(page).or_insert_with(|| PositionedPdfPage {
            width: page_dimension(bounds.page_width, PDF_WIDTH),
            height: page_dimension(bounds.page_height, PDF_HEIGHT),
            streams: Vec::new(),
        });
    }

    if pages.is_empty() {
        for page in 1..=extraction.page_count.max(1) {
            pages.insert(
                page,
                PositionedPdfPage {
                    width: PDF_WIDTH,
                    height: PDF_HEIGHT,
                    streams: Vec::new(),
                },
            );
        }
    }

    let translated_by_id = translated
        .sections
        .iter()
        .map(|section| (section.id.as_str(), section))
        .collect::<HashMap<_, _>>();
    let block_by_id = extraction
        .blocks
        .iter()
        .map(|block| (block.id.as_str(), block))
        .collect::<HashMap<_, _>>();
    let mut rendered_any = false;

    for section in &layout.sections {
        let Some(block_id) = section.block_ids.first() else {
            continue;
        };
        let Some(source_block) = block_by_id.get(block_id.as_str()) else {
            continue;
        };
        let Some(page) = source_block.page else {
            continue;
        };
        let Some(bounds) = source_block.bounds.as_ref() else {
            continue;
        };
        let translated_text = translated_by_id
            .get(section.id.as_str())
            .map(|item| item.translated_text.as_str())
            .unwrap_or(source_block.text.as_str());
        let Some(stream) = build_positioned_text_stream(bounds, translated_text) else {
            continue;
        };
        if let Some(page_spec) = pages.get_mut(&page) {
            page_spec.streams.push(stream);
            rendered_any = true;
        }
    }

    if !rendered_any {
        return None;
    }

    Some(pages.into_values().collect())
}

fn write_positioned_unicode_pdf(path: &Path, pages: &[PositionedPdfPage]) -> Result<(), String> {
    let page_specs = if pages.is_empty() {
        vec![PositionedPdfPage {
            width: PDF_WIDTH,
            height: PDF_HEIGHT,
            streams: vec![build_page_stream(&[String::new()])],
        }]
    } else {
        pages.to_vec()
    };

    let mut objects = Vec::<(usize, String)>::new();
    objects.push((1, "<< /Type /Catalog /Pages 2 0 R >>".to_string()));

    let mut kids = Vec::<String>::new();
    for index in 0..page_specs.len() {
        let page_id = 4 + index * 2;
        kids.push(format!("{page_id} 0 R"));
    }
    objects.push((
        2,
        format!(
            "<< /Type /Pages /Count {} /Kids [ {} ] >>",
            page_specs.len(),
            kids.join(" ")
        ),
    ));

    objects.push((
        3,
        "<< /Type /Font /Subtype /Type0 /BaseFont /STSong-Light /Encoding /UniGB-UCS2-H /DescendantFonts [ << /Type /Font /Subtype /CIDFontType0 /BaseFont /STSong-Light /CIDSystemInfo << /Registry (Adobe) /Ordering (GB1) /Supplement 4 >> >> ] >>".to_string(),
    ));

    for (index, page) in page_specs.iter().enumerate() {
        let page_id = 4 + index * 2;
        let content_id = page_id + 1;
        let stream = if page.streams.is_empty() {
            build_page_stream(&[String::new()])
        } else {
            page.streams.join("\n")
        };
        let content_obj = format!(
            "<< /Length {} >>\nstream\n{}endstream",
            stream.as_bytes().len(),
            stream
        );
        let page_obj = format!(
            "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 {} {}] /Resources << /Font << /F1 3 0 R >> >> /Contents {} 0 R >>",
            page.width,
            page.height,
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

pub(super) fn persist_translation_result(
    papers_root: &Path,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
    source_pdf_relative: &str,
) -> Result<TranslationPersistResult, String> {
    let relative = super::translation_pdf_relative_path(source_pdf_relative);
    let output_path = papers_root.join(Path::new(&relative));
    if let Some(parent) = output_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    if let Some(positioned_pages) = build_positioned_pdf_pages(extraction, layout, translated) {
        write_positioned_unicode_pdf(&output_path, &positioned_pages)?;
    } else {
        let lines = build_translated_lines(extraction, layout, translated);
        if lines.is_empty() {
            return Err("translation.empty_output".to_string());
        }
        write_simple_unicode_pdf(&output_path, &lines)?;
    }
    let primary_relative = to_relative(papers_root, &output_path)?;

    Ok(TranslationPersistResult {
        primary_relative_path: primary_relative,
        artifact_paths: Vec::new(),
    })
}
