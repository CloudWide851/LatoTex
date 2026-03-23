use super::library_translation_ocr::{detect_source_language, normalize_for_blocks, text_quality_score};
use super::library_translation_pdf_tools::{
    bundled_tool_path, resolve_poppler_tool, resolve_powershell, run_command_capture,
};
use super::library_translation_types::{TranslationBlock, TranslationBlockBounds};
use regex::Regex;
use serde_json::Value;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

#[derive(Clone)]
pub(super) struct PdfExtractionResult {
    pub blocks: Vec<TranslationBlock>,
    pub detected_language: Option<String>,
    pub extraction_engine: Option<String>,
    pub extraction_mode: String,
    pub page_count: u32,
    pub ocr_page_count: u32,
}

type NativePage = (u32, f32, f32, Vec<TranslationBlock>);

type OcrLine = (String, f32, f32, f32, f32);

fn decode_html_text(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&apos;", "'")
        .replace("&#39;", "'")
        .replace("&#34;", "\"")
        .replace("&#10;", "\n")
        .replace("&#13;", "\n")
}

fn parse_attr_f32(tag: &str, key: &str) -> Option<f32> {
    let pattern = format!(r#"{}="([^"]+)""#, regex::escape(key));
    let re = Regex::new(&pattern).ok()?;
    let value = re.captures(tag)?.get(1)?.as_str().trim().parse::<f32>().ok()?;
    if value.is_finite() {
        Some(value)
    } else {
        None
    }
}

fn build_bounds(x_min: f32, y_min: f32, x_max: f32, y_max: f32, page_width: f32, page_height: f32) -> Option<TranslationBlockBounds> {
    let width = (x_max - x_min).max(0.0);
    let height = (y_max - y_min).max(0.0);
    if width <= 0.0 || height <= 0.0 {
        return None;
    }
    Some(TranslationBlockBounds {
        x: x_min.max(0.0),
        y: y_min.max(0.0),
        width,
        height,
        page_width: page_width.max(width),
        page_height: page_height.max(height),
    })
}

fn parse_native_pdf_pages(pdf_path: &Path, max_chars: usize) -> Result<Vec<NativePage>, String> {
    let tool = resolve_poppler_tool("pdftotext.exe");
    let output = run_command_capture(
        &tool,
        &[
            "-bbox-layout",
            "-enc",
            "UTF-8",
            "-nopgbrk",
            &pdf_path.to_string_lossy(),
            "-",
        ],
    )?;
    let page_re = Regex::new(r#"(?s)<page[^>]*number="([^"]+)"[^>]*width="([^"]+)"[^>]*height="([^"]+)"[^>]*>(.*?)</page>"#)
        .map_err(|e| e.to_string())?;
    let block_re = Regex::new(r#"(?s)<block[^>]*xMin="([^"]+)"[^>]*yMin="([^"]+)"[^>]*xMax="([^"]+)"[^>]*yMax="([^"]+)"[^>]*>(.*?)</block>"#)
        .map_err(|e| e.to_string())?;
    let line_re = Regex::new(r#"(?s)<line[^>]*xMin="([^"]+)"[^>]*yMin="([^"]+)"[^>]*xMax="([^"]+)"[^>]*yMax="([^"]+)"[^>]*>(.*?)</line>"#)
        .map_err(|e| e.to_string())?;
    let word_re = Regex::new(r#"(?s)<word[^>]*>(.*?)</word>"#).map_err(|e| e.to_string())?;

    let mut pages = Vec::<NativePage>::new();
    for page_caps in page_re.captures_iter(&output) {
        let page_number = page_caps
            .get(1)
            .and_then(|m| m.as_str().trim().parse::<u32>().ok())
            .unwrap_or((pages.len() + 1) as u32);
        let page_width = page_caps
            .get(2)
            .and_then(|m| m.as_str().trim().parse::<f32>().ok())
            .unwrap_or(595.0);
        let page_height = page_caps
            .get(3)
            .and_then(|m| m.as_str().trim().parse::<f32>().ok())
            .unwrap_or(842.0);
        let body = page_caps.get(4).map(|m| m.as_str()).unwrap_or_default();
        let mut blocks = Vec::<TranslationBlock>::new();

        for (block_index, block_caps) in block_re.captures_iter(body).enumerate() {
            let x_min = block_caps.get(1).and_then(|m| m.as_str().parse::<f32>().ok()).unwrap_or(0.0);
            let y_min = block_caps.get(2).and_then(|m| m.as_str().parse::<f32>().ok()).unwrap_or(0.0);
            let x_max = block_caps.get(3).and_then(|m| m.as_str().parse::<f32>().ok()).unwrap_or(page_width);
            let y_max = block_caps.get(4).and_then(|m| m.as_str().parse::<f32>().ok()).unwrap_or(page_height);
            let block_body = block_caps.get(5).map(|m| m.as_str()).unwrap_or_default();
            let mut lines = Vec::<String>::new();
            for line_caps in line_re.captures_iter(block_body) {
                let line_body = line_caps.get(5).map(|m| m.as_str()).unwrap_or_default();
                let mut words = Vec::<String>::new();
                for word_caps in word_re.captures_iter(line_body) {
                    let text = decode_html_text(word_caps.get(1).map(|m| m.as_str()).unwrap_or_default()).trim().to_string();
                    if !text.is_empty() {
                        words.push(text);
                    }
                }
                let joined = words.join(" ").trim().to_string();
                if !joined.is_empty() {
                    lines.push(joined);
                }
            }
            let text = normalize_for_blocks(&lines.join("\n"), max_chars);
            if text.trim().is_empty() {
                continue;
            }
            blocks.push(TranslationBlock {
                id: format!("pdf-{}-b{}", page_number, block_index + 1),
                page: Some(page_number),
                role: "paragraph".to_string(),
                text,
                confidence: Some(0.95),
                bounds: build_bounds(x_min, y_min, x_max, y_max, page_width, page_height),
                text_source: Some("native".to_string()),
            });
        }

        if blocks.is_empty() {
            let mut fallback_blocks = Vec::<TranslationBlock>::new();
            for (line_index, line_caps) in line_re.captures_iter(body).enumerate() {
                let tag = line_caps.get(0).map(|m| m.as_str()).unwrap_or_default();
                let x_min = parse_attr_f32(tag, "xMin").unwrap_or(0.0);
                let y_min = parse_attr_f32(tag, "yMin").unwrap_or(0.0);
                let x_max = parse_attr_f32(tag, "xMax").unwrap_or(page_width);
                let y_max = parse_attr_f32(tag, "yMax").unwrap_or(page_height);
                let line_body = line_caps.get(5).map(|m| m.as_str()).unwrap_or_default();
                let mut words = Vec::<String>::new();
                for word_caps in word_re.captures_iter(line_body) {
                    let text = decode_html_text(word_caps.get(1).map(|m| m.as_str()).unwrap_or_default()).trim().to_string();
                    if !text.is_empty() {
                        words.push(text);
                    }
                }
                let text = normalize_for_blocks(&words.join(" "), max_chars);
                if text.trim().is_empty() {
                    continue;
                }
                fallback_blocks.push(TranslationBlock {
                    id: format!("pdf-{}-l{}", page_number, line_index + 1),
                    page: Some(page_number),
                    role: "paragraph".to_string(),
                    text,
                    confidence: Some(0.90),
                    bounds: build_bounds(x_min, y_min, x_max, y_max, page_width, page_height),
                    text_source: Some("native".to_string()),
                });
            }
            blocks = fallback_blocks;
        }

        pages.push((page_number, page_width, page_height, blocks));
    }

    Ok(pages)
}

fn parse_pdf_page_count(pdf_path: &Path) -> Result<u32, String> {
    let tool = resolve_poppler_tool("pdfinfo.exe");
    let output = run_command_capture(&tool, &[&pdf_path.to_string_lossy()])?;
    let re = Regex::new(r"(?m)^Pages:\s+(\d+)").map_err(|e| e.to_string())?;
    let count = re
        .captures(&output)
        .and_then(|caps| caps.get(1))
        .and_then(|m| m.as_str().parse::<u32>().ok())
        .unwrap_or(0);
    if count == 0 {
        return Err("pdf.page_count_unavailable".to_string());
    }
    Ok(count)
}

fn create_temp_dir(prefix: &str) -> Result<PathBuf, String> {
    let path = std::env::temp_dir().join(format!("{}-{}", prefix, Uuid::new_v4()));
    fs::create_dir_all(&path).map_err(|e| e.to_string())?;
    Ok(path)
}

fn render_pdf_page_to_png(pdf_path: &Path, page_number: u32) -> Result<PathBuf, String> {
    let tool = resolve_poppler_tool("pdftoppm.exe");
    let temp_dir = create_temp_dir("latotex-paper-ocr")?;
    let prefix = temp_dir.join("page");
    let prefix_str = prefix.to_string_lossy().to_string();
    let status = Command::new(&tool)
        .args([
            "-png",
            "-r",
            "180",
            "-f",
            &page_number.to_string(),
            "-l",
            &page_number.to_string(),
            &pdf_path.to_string_lossy(),
            &prefix_str,
        ])
        .status()
        .map_err(|e| e.to_string())?;
    if !status.success() {
        return Err(format!("pdftoppm failed for page {page_number}"));
    }
    let image_path = temp_dir.join(format!("page-{}.png", page_number));
    if image_path.exists() {
        return Ok(image_path);
    }
    let fallback = temp_dir.join("page-1.png");
    if fallback.exists() {
        return Ok(fallback);
    }
    Err(format!("ocr raster output missing for page {page_number}"))
}

#[cfg(target_os = "windows")]
fn run_windows_ocr(image_path: &Path) -> Result<Value, String> {
    let script = bundled_tool_path("winocr_image.ps1").ok_or_else(|| "winocr.script_missing".to_string())?;
    let output = Command::new(resolve_powershell())
        .args([
            "-NoProfile",
            "-ExecutionPolicy",
            "Bypass",
            "-File",
            &script.to_string_lossy(),
            "-ImagePath",
            &image_path.to_string_lossy(),
        ])
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        return Err(if stderr.is_empty() { "winocr.failed".to_string() } else { stderr });
    }
    serde_json::from_slice::<Value>(&output.stdout).map_err(|e| e.to_string())
}

#[cfg(not(target_os = "windows"))]
fn run_windows_ocr(_image_path: &Path) -> Result<Value, String> {
    Err("winocr.unsupported_platform".to_string())
}

fn group_ocr_lines_to_blocks(lines: &[OcrLine], page_number: u32, page_width: f32, page_height: f32, max_chars: usize) -> Vec<TranslationBlock> {
    let mut sorted = lines.to_vec();
    sorted.sort_by(|a, b| a.2.partial_cmp(&b.2).unwrap_or(std::cmp::Ordering::Equal));
    let mut blocks = Vec::<TranslationBlock>::new();
    let mut current_lines = Vec::<OcrLine>::new();

    let flush = |items: &mut Vec<OcrLine>, blocks: &mut Vec<TranslationBlock>| {
        if items.is_empty() {
            return;
        }
        let mut min_x = f32::MAX;
        let mut min_y = f32::MAX;
        let mut max_x = 0.0_f32;
        let mut max_y = 0.0_f32;
        let mut text_lines = Vec::<String>::new();
        for (text, x, y, width, height) in items.iter() {
            min_x = min_x.min(*x);
            min_y = min_y.min(*y);
            max_x = max_x.max(*x + *width);
            max_y = max_y.max(*y + *height);
            if !text.trim().is_empty() {
                text_lines.push(text.trim().to_string());
            }
        }
        let text = normalize_for_blocks(&text_lines.join("\n"), max_chars);
        if text.trim().is_empty() {
            items.clear();
            return;
        }
        blocks.push(TranslationBlock {
            id: format!("pdf-{}-ocr-{}", page_number, blocks.len() + 1),
            page: Some(page_number),
            role: "paragraph".to_string(),
            text,
            confidence: Some(0.78),
            bounds: build_bounds(min_x, min_y, max_x, max_y, page_width, page_height),
            text_source: Some("ocr".to_string()),
        });
        items.clear();
    };

    for line in sorted {
        if let Some((_, last_x, last_y, _, last_height)) = current_lines.last() {
            let vertical_gap = line.2 - (*last_y + *last_height);
            let horizontal_shift = (line.1 - *last_x).abs();
            let should_break = vertical_gap > (line.4.max(*last_height) * 0.9 + 6.0) || horizontal_shift > (page_width * 0.2);
            if should_break {
                flush(&mut current_lines, &mut blocks);
            }
        }
        current_lines.push(line);
    }
    flush(&mut current_lines, &mut blocks);
    blocks
}

fn extract_ocr_page_blocks(pdf_path: &Path, page_number: u32, max_chars: usize) -> Result<Vec<TranslationBlock>, String> {
    let image_path = render_pdf_page_to_png(pdf_path, page_number)?;
    let ocr_json = run_windows_ocr(&image_path)?;
    let page_width = ocr_json.get("width").and_then(Value::as_f64).unwrap_or(1240.0) as f32;
    let page_height = ocr_json.get("height").and_then(Value::as_f64).unwrap_or(1754.0) as f32;
    let mut lines = Vec::<OcrLine>::new();
    if let Some(items) = ocr_json.get("lines").and_then(Value::as_array) {
        for item in items {
            let text = item.get("text").and_then(Value::as_str).unwrap_or_default().trim().to_string();
            if text.is_empty() {
                continue;
            }
            let x = item.get("x").and_then(Value::as_f64).unwrap_or(0.0) as f32;
            let y = item.get("y").and_then(Value::as_f64).unwrap_or(0.0) as f32;
            let width = item.get("width").and_then(Value::as_f64).unwrap_or(0.0) as f32;
            let height = item.get("height").and_then(Value::as_f64).unwrap_or(0.0) as f32;
            lines.push((text, x, y, width.max(1.0), height.max(1.0)));
        }
    }
    let _ = fs::remove_file(&image_path);
    if let Some(parent) = image_path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
    let blocks = group_ocr_lines_to_blocks(&lines, page_number, page_width, page_height, max_chars);
    if blocks.is_empty() {
        return Err(format!("ocr produced no usable text for page {page_number}"));
    }
    Ok(blocks)
}

fn page_quality(blocks: &[TranslationBlock]) -> f32 {
    let text = blocks.iter().map(|item| item.text.as_str()).collect::<Vec<_>>().join("\n");
    text_quality_score(&text)
}

pub(super) fn extract_pdf_blocks_with_layout(pdf_path: &Path, max_chars: usize) -> Result<PdfExtractionResult, String> {
    let native_pages = parse_native_pdf_pages(pdf_path, max_chars).unwrap_or_default();
    let native_page_count = native_pages.len() as u32;
    let total_pages = parse_pdf_page_count(pdf_path).unwrap_or(native_page_count.max(1));
    let mut final_blocks = Vec::<TranslationBlock>::new();
    let mut ocr_page_count = 0_u32;
    let mut used_native = 0_u32;

    for page_number in 1..=total_pages {
        let native_blocks = native_pages
            .iter()
            .find(|(page, _, _, _)| *page == page_number)
            .map(|(_, _, _, blocks)| blocks.clone())
            .unwrap_or_default();
        let quality = page_quality(&native_blocks);
        let should_use_native = !native_blocks.is_empty() && quality >= 0.20;
        if should_use_native {
            used_native += 1;
            final_blocks.extend(native_blocks);
            continue;
        }
        let ocr_blocks = extract_ocr_page_blocks(pdf_path, page_number, max_chars).or_else(|ocr_error| {
            if native_blocks.is_empty() {
                Err(ocr_error)
            } else {
                Ok(native_blocks)
            }
        })?;
        if ocr_blocks.iter().any(|item| item.text_source.as_deref() == Some("ocr")) {
            ocr_page_count += 1;
        }
        final_blocks.extend(ocr_blocks);
    }

    if final_blocks.is_empty() {
        return Err("translation.ocr_unavailable".to_string());
    }

    let combined = final_blocks
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n");
    let extraction_mode = if ocr_page_count == 0 {
        "native"
    } else if used_native == 0 {
        "ocr"
    } else {
        "hybrid"
    };
    let extraction_engine = match extraction_mode {
        "native" => Some("poppler.bbox".to_string()),
        "ocr" => Some("pdftoppm+winocr".to_string()),
        _ => Some("poppler.bbox+pdftoppm+winocr".to_string()),
    };

    Ok(PdfExtractionResult {
        blocks: final_blocks,
        detected_language: detect_source_language(&combined),
        extraction_engine,
        extraction_mode: extraction_mode.to_string(),
        page_count: total_pages,
        ocr_page_count,
    })
}
