use super::docx_images::{embedded_image_sources, extract_image_assets};
use super::docx_package::{document_xml_from_html, minimal_docx_bytes, replace_document_xml};
use crate::models::{Ack, DocxReadInput, DocxReadResponse, DocxWriteInput};
use crate::state::AppState;
use crate::storage;
use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use tauri::{async_runtime::spawn_blocking, State};
use zip::ZipArchive;

fn html_escape(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn html_unescape(value: &str) -> String {
    value
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
}

fn rel_targets(archive: &mut ZipArchive<Cursor<&[u8]>>) -> HashMap<String, String> {
    let mut rels = String::new();
    let Ok(mut file) = archive.by_name("word/_rels/document.xml.rels") else {
        return HashMap::new();
    };
    if file.read_to_string(&mut rels).is_err() {
        return HashMap::new();
    }
    let rel_re =
        Regex::new(r#"(?is)<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)""#).unwrap();
    rel_re
        .captures_iter(&rels)
        .map(|capture| {
            (
                capture
                    .get(1)
                    .map(|item| item.as_str())
                    .unwrap_or("")
                    .to_string(),
                capture
                    .get(2)
                    .map(|item| item.as_str())
                    .unwrap_or("")
                    .to_string(),
            )
        })
        .filter(|(id, target)| !id.is_empty() && !target.is_empty())
        .collect()
}

fn runs_to_html(
    body: &str,
    rels: &HashMap<String, String>,
    images: &HashMap<String, String>,
) -> String {
    let hyperlink_re =
        Regex::new(r#"(?is)<w:hyperlink\b[^>]*r:id="([^"]+)"[^>]*>(.*?)</w:hyperlink>"#).unwrap();
    let mut output = String::new();
    let mut last = 0;
    for link in hyperlink_re.captures_iter(body) {
        let Some(full) = link.get(0) else { continue };
        output.push_str(&plain_runs_to_html(&body[last..full.start()], images));
        let id = link.get(1).map(|item| item.as_str()).unwrap_or("");
        let link_body = link.get(2).map(|item| item.as_str()).unwrap_or("");
        let href = rels.get(id).cloned().unwrap_or_default();
        output.push_str(&format!(
            r#"<a href="{}">{}</a>"#,
            html_escape(&href),
            plain_runs_to_html(link_body, images)
        ));
        last = full.end();
    }
    output.push_str(&plain_runs_to_html(&body[last..], images));
    output
}

fn plain_runs_to_html(body: &str, images: &HashMap<String, String>) -> String {
    let run_re = Regex::new(r"(?is)<w:r\b[^>]*>(.*?)</w:r>").unwrap();
    let text_re = Regex::new(r"(?is)<w:t\b[^>]*>(.*?)</w:t>").unwrap();
    let blip_re = Regex::new(r#"(?is)<a:blip\b[^>]*(?:r:embed|r:link)="([^"]+)""#).unwrap();
    let mut line = String::new();
    for run in run_re.captures_iter(body) {
        let run_xml = run.get(1).map(|item| item.as_str()).unwrap_or("");
        if let Some(blip) = blip_re.captures(run_xml) {
            let image_id = blip.get(1).map(|item| item.as_str()).unwrap_or("image");
            if let Some(src) = images.get(image_id) {
                line.push_str(&format!(
                    r#"<img data-docx-embedded="{}" data-docx-image="{}" src="{}" alt="{}" />"#,
                    html_escape(image_id),
                    html_escape(image_id),
                    html_escape(src),
                    html_escape(image_id)
                ));
            } else {
                line.push_str(&format!(
                    r#"<span data-docx-image="{}" contenteditable="false">[image: {}]</span>"#,
                    html_escape(image_id),
                    html_escape(image_id)
                ));
            }
            continue;
        }
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
    line
}

fn paragraph_to_html(
    paragraph: &str,
    rels: &HashMap<String, String>,
    images: &HashMap<String, String>,
) -> String {
    let style_re = Regex::new(r#"(?is)<w:pStyle\b[^>]*w:val="([^"]+)""#).unwrap();
    let style = style_re
        .captures(paragraph)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().to_ascii_lowercase())
        .unwrap_or_default();
    let line = runs_to_html(paragraph, rels, images);
    let body = if line.trim().is_empty() {
        "<br>".to_string()
    } else {
        line
    };
    if paragraph.contains("<w:numPr") {
        return format!("<ul><li>{body}</li></ul>");
    }
    if style.contains("heading1") || style == "title" {
        format!("<h1>{body}</h1>")
    } else if style.contains("heading2") || style.contains("heading3") {
        format!("<h2>{body}</h2>")
    } else {
        format!("<p>{body}</p>")
    }
}

fn table_to_html(
    table: &str,
    rels: &HashMap<String, String>,
    images: &HashMap<String, String>,
) -> String {
    let row_re = Regex::new(r"(?is)<w:tr\b[^>]*>(.*?)</w:tr>").unwrap();
    let cell_re = Regex::new(r"(?is)<w:tc\b[^>]*>(.*?)</w:tc>").unwrap();
    let para_re = Regex::new(r"(?is)<w:p\b[^>]*>(.*?)</w:p>").unwrap();
    let mut html = String::from("<table><tbody>");
    for row in row_re.captures_iter(table) {
        html.push_str("<tr>");
        let row_xml = row.get(1).map(|item| item.as_str()).unwrap_or("");
        for cell in cell_re.captures_iter(row_xml) {
            let cell_xml = cell.get(1).map(|item| item.as_str()).unwrap_or("");
            let mut cell_html = String::new();
            for paragraph in para_re.captures_iter(cell_xml) {
                cell_html.push_str(&runs_to_html(
                    paragraph.get(1).map(|item| item.as_str()).unwrap_or(""),
                    rels,
                    images,
                ));
                cell_html.push_str("<br>");
            }
            html.push_str("<td>");
            html.push_str(cell_html.trim_end_matches("<br>"));
            html.push_str("</td>");
        }
        html.push_str("</tr>");
    }
    html.push_str("</tbody></table>");
    html
}

pub(super) fn docx_bytes_to_html(bytes: &[u8]) -> Result<(String, Vec<String>), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let rels = rel_targets(&mut archive);
    let images = embedded_image_sources(&mut archive, &rels);
    let mut document = String::new();
    archive
        .by_name("word/document.xml")
        .map_err(|_| "docx.document_missing".to_string())?
        .read_to_string(&mut document)
        .map_err(|e| e.to_string())?;
    let body_re = Regex::new(r"(?is)<w:body\b[^>]*>(.*?)</w:body>").unwrap();
    let item_re = Regex::new(r"(?is)<w:tbl\b[^>]*>.*?</w:tbl>|<w:p\b[^>]*>.*?</w:p>").unwrap();
    let body = body_re
        .captures(&document)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str())
        .unwrap_or(&document);
    let mut html = String::new();
    for item in item_re.find_iter(body) {
        let xml = item.as_str();
        if xml.starts_with("<w:tbl") {
            html.push_str(&table_to_html(xml, &rels, &images));
        } else {
            html.push_str(&paragraph_to_html(xml, &rels, &images));
        }
    }
    if html.trim().is_empty() {
        html = "<p><br></p>".to_string();
    }
    Ok((html, vec!["docx.warning.commonFormatsOnly".to_string()]))
}

#[tauri::command]
pub async fn docx_read(
    state: State<'_, AppState>,
    input: DocxReadInput,
) -> Result<DocxReadResponse, String> {
    state.log("INFO", &format!("docx_read: {}", input.relative_path));
    let db_path = state.db_path.clone();
    spawn_blocking(move || {
        let file =
            storage::read_project_file_binary(&db_path, &input.project_id, &input.relative_path)?;
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
        let (images, image_rels) = extract_image_assets(&db_path, &input.project_id, &input.html);
        let document_xml = document_xml_from_html(&input.html, &image_rels);
        let bytes = match storage::read_project_file_binary(
            &db_path,
            &input.project_id,
            &input.relative_path,
        ) {
            Ok(existing) => replace_document_xml(&existing.bytes, &document_xml, &images)
                .or_else(|_| minimal_docx_bytes(&document_xml, &images))?,
            Err(_) => minimal_docx_bytes(&document_xml, &images)?,
        };
        storage::write_project_file_binary(
            &db_path,
            &input.project_id,
            &input.relative_path,
            &bytes,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}
