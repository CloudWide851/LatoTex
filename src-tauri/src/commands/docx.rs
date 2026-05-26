use crate::models::{Ack, DocxReadInput, DocxReadResponse, DocxWriteInput};
use crate::state::AppState;
use crate::storage;
use regex::Regex;
use std::io::{Cursor, Read, Write};
use tauri::{async_runtime::spawn_blocking, State};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn xml_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

fn strip_tags(value: &str) -> String {
    let tag_re = Regex::new(r"(?is)<[^>]+>").unwrap();
    html_unescape(tag_re.replace_all(value, "").trim())
}

fn docx_bytes_to_html(bytes: &[u8]) -> Result<(String, Vec<String>), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let mut document = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| "docx.document_missing".to_string())?
        .read_to_string(&mut document)
        .map_err(|e| e.to_string())?;
    let paragraph_re = Regex::new(r"(?is)<w:p\b[^>]*>(.*?)</w:p>").unwrap();
    let run_re = Regex::new(r"(?is)<w:r\b[^>]*>(.*?)</w:r>").unwrap();
    let text_re = Regex::new(r"(?is)<w:t\b[^>]*>(.*?)</w:t>").unwrap();
    let mut html = String::new();
    for paragraph in paragraph_re.captures_iter(&document) {
        let body = paragraph.get(1).map(|item| item.as_str()).unwrap_or("");
        let mut line = String::new();
        for run in run_re.captures_iter(body) {
            let run_xml = run.get(1).map(|item| item.as_str()).unwrap_or("");
            let mut text = String::new();
            for text_match in text_re.captures_iter(run_xml) {
                text.push_str(text_match.get(1).map(|item| item.as_str()).unwrap_or(""));
            }
            if run_xml.contains("<w:tab") {
                text.push('\t');
            }
            if text.trim().is_empty() && !run_xml.contains("<w:br") {
                continue;
            }
            let mut escaped = html_escape(&html_unescape(&text));
            if run_xml.contains("<w:b") {
                escaped = format!("<strong>{escaped}</strong>");
            }
            if run_xml.contains("<w:i") {
                escaped = format!("<em>{escaped}</em>");
            }
            if run_xml.contains("<w:u") {
                escaped = format!("<u>{escaped}</u>");
            }
            line.push_str(&escaped);
            if run_xml.contains("<w:br") {
                line.push_str("<br>");
            }
        }
        if line.trim().is_empty() {
            html.push_str("<p><br></p>");
        } else {
            html.push_str("<p>");
            html.push_str(&line);
            html.push_str("</p>");
        }
    }
    if html.trim().is_empty() {
        html = "<p><br></p>".to_string();
    }
    Ok((
        html,
        vec!["docx.warning.commonFormatsOnly".to_string()],
    ))
}

#[derive(Clone, Copy, Default)]
struct InlineStyle {
    bold: bool,
    italic: bool,
    underline: bool,
    heading: u8,
}

fn run_props(style: InlineStyle) -> String {
    let mut props = String::new();
    if style.bold || style.heading > 0 {
        props.push_str("<w:b/>");
    }
    if style.italic {
        props.push_str("<w:i/>");
    }
    if style.underline {
        props.push_str(r#"<w:u w:val="single"/>"#);
    }
    if style.heading == 1 {
        props.push_str(r#"<w:sz w:val="32"/>"#);
    } else if style.heading == 2 {
        props.push_str(r#"<w:sz w:val="26"/>"#);
    }
    if props.is_empty() {
        String::new()
    } else {
        format!("<w:rPr>{props}</w:rPr>")
    }
}

fn text_run(text: &str, style: InlineStyle) -> String {
    format!(
        r#"<w:r>{}<w:t xml:space="preserve">{}</w:t></w:r>"#,
        run_props(style),
        xml_escape(text)
    )
}

fn inline_html_to_runs(inline: &str, heading: u8, prefix: Option<&str>) -> String {
    let tag_re = Regex::new(r"(?is)<[^>]+>").unwrap();
    let mut style = InlineStyle {
        heading,
        ..InlineStyle::default()
    };
    let mut runs = String::new();
    if let Some(value) = prefix {
        runs.push_str(&text_run(value, style));
    }
    let mut last = 0;
    for tag in tag_re.find_iter(inline) {
        let segment = &inline[last..tag.start()];
        if !segment.is_empty() {
            for (index, line) in html_unescape(segment).split('\n').enumerate() {
                if index > 0 {
                    runs.push_str("<w:r><w:br/></w:r>");
                }
                if !line.is_empty() {
                    runs.push_str(&text_run(line, style));
                }
            }
        }
        let lower = tag.as_str().to_ascii_lowercase();
        if lower.starts_with("<strong") || lower.starts_with("<b") {
            style.bold = true;
        } else if lower.starts_with("</strong") || lower.starts_with("</b") {
            style.bold = false;
        } else if lower.starts_with("<em") || lower.starts_with("<i") {
            style.italic = true;
        } else if lower.starts_with("</em") || lower.starts_with("</i") {
            style.italic = false;
        } else if lower.starts_with("<u") {
            style.underline = true;
        } else if lower.starts_with("</u") {
            style.underline = false;
        } else if lower.starts_with("<br") {
            runs.push_str("<w:r><w:br/></w:r>");
        }
        last = tag.end();
    }
    let tail = &inline[last..];
    if !tail.is_empty() {
        runs.push_str(&text_run(&html_unescape(tail), style));
    }
    if runs.is_empty() {
        "<w:r><w:t></w:t></w:r>".to_string()
    } else {
        runs
    }
}

fn paragraphs_from_html(html: &str) -> Vec<String> {
    let block_re = Regex::new(r"(?is)<(h1|h2|h3|p|div|li)\b[^>]*>(.*?)</(?:h1|h2|h3|p|div|li)>").unwrap();
    let mut out = Vec::new();
    let mut ordered_index = 1_u32;
    for block in block_re.captures_iter(html) {
        let tag = block.get(1).map(|item| item.as_str().to_ascii_lowercase()).unwrap_or_default();
        let body = block.get(2).map(|item| item.as_str()).unwrap_or("");
        let text = strip_tags(body);
        if text.trim().is_empty() {
            continue;
        }
        let heading = match tag.as_str() {
            "h1" => 1,
            "h2" | "h3" => 2,
            _ => 0,
        };
        let prefix = if tag == "li" {
            let value = format!("{}. ", ordered_index);
            ordered_index = ordered_index.saturating_add(1);
            Some(value)
        } else {
            None
        };
        out.push(format!("<w:p>{}</w:p>", inline_html_to_runs(body, heading, prefix.as_deref())));
    }
    if out.is_empty() {
        let text = strip_tags(html);
        vec![format!("<w:p>{}</w:p>", text_run(&text, InlineStyle::default()))]
    } else {
        out
    }
}

fn document_xml_from_html(html: &str) -> String {
    let paragraphs = paragraphs_from_html(html).into_iter().collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>{paragraphs}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#
    )
}

fn html_to_docx_bytes(html: &str) -> Result<Vec<u8>, String> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("[Content_Types].xml", options).map_err(|e| e.to_string())?;
    writer.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#).map_err(|e| e.to_string())?;
    writer.start_file("_rels/.rels", options).map_err(|e| e.to_string())?;
    writer.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#).map_err(|e| e.to_string())?;
    writer.start_file("word/document.xml", options).map_err(|e| e.to_string())?;
    writer
        .write_all(document_xml_from_html(html).as_bytes())
        .map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string()).map(|cursor| cursor.into_inner())
}

#[tauri::command]
pub async fn docx_read(
    state: State<'_, AppState>,
    input: DocxReadInput,
) -> Result<DocxReadResponse, String> {
    state.log("INFO", &format!("docx_read: {}", input.relative_path));
    let db_path = state.db_path.clone();
    spawn_blocking(move || {
        let file = storage::read_project_file_binary(&db_path, &input.project_id, &input.relative_path)?;
        let (html, warnings) = docx_bytes_to_html(&file.bytes)?;
        Ok(DocxReadResponse {
            relative_path: file.relative_path,
            html,
            warnings,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn docx_write(state: State<'_, AppState>, input: DocxWriteInput) -> Result<Ack, String> {
    state.log("INFO", &format!("docx_write: {}", input.relative_path));
    let db_path = state.db_path.clone();
    spawn_blocking(move || {
        let bytes = html_to_docx_bytes(&input.html)?;
        storage::write_project_file_binary(&db_path, &input.project_id, &input.relative_path, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
