use crate::models::{Ack, DocxReadInput, DocxReadResponse, DocxWriteInput};
use crate::state::AppState;
use crate::storage;
use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use std::path::Path;
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

#[derive(Clone)]
struct DocxImageAsset {
    resource_path: String,
    rel_id: String,
    media_name: String,
    content_type: String,
    bytes: Vec<u8>,
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?is)\b{}\s*=\s*["']([^"']+)["']"#, regex::escape(name))).ok()?;
    re.captures(tag)
        .and_then(|capture| capture.get(1))
        .map(|item| html_unescape(item.as_str()))
}

fn image_content_type(path: &str) -> Option<&'static str> {
    match path.rsplit('.').next().unwrap_or("").to_ascii_lowercase().as_str() {
        "png" => Some("image/png"),
        "jpg" | "jpeg" => Some("image/jpeg"),
        "gif" => Some("image/gif"),
        "webp" => Some("image/webp"),
        "svg" => Some("image/svg+xml"),
        _ => None,
    }
}

fn strip_tags(value: &str) -> String {
    let tag_re = Regex::new(r"(?is)<[^>]+>").unwrap();
    html_unescape(tag_re.replace_all(value, "").trim())
}

fn rel_targets(archive: &mut ZipArchive<Cursor<&[u8]>>) -> HashMap<String, String> {
    let mut rels = String::new();
    let Ok(mut file) = archive.by_name("word/_rels/document.xml.rels") else {
        return HashMap::new();
    };
    if file.read_to_string(&mut rels).is_err() {
        return HashMap::new();
    }
    let rel_re = Regex::new(r#"(?is)<Relationship\b[^>]*Id="([^"]+)"[^>]*Target="([^"]+)""#).unwrap();
    rel_re
        .captures_iter(&rels)
        .map(|capture| {
            (
                capture.get(1).map(|item| item.as_str()).unwrap_or("").to_string(),
                capture.get(2).map(|item| item.as_str()).unwrap_or("").to_string(),
            )
        })
        .filter(|(id, target)| !id.is_empty() && !target.is_empty())
        .collect()
}

fn runs_to_html(body: &str, rels: &HashMap<String, String>) -> String {
    let hyperlink_re = Regex::new(r#"(?is)<w:hyperlink\b[^>]*r:id="([^"]+)"[^>]*>(.*?)</w:hyperlink>"#).unwrap();
    let mut output = String::new();
    let mut last = 0;
    for link in hyperlink_re.captures_iter(body) {
        let Some(full) = link.get(0) else { continue };
        output.push_str(&plain_runs_to_html(&body[last..full.start()]));
        let id = link.get(1).map(|item| item.as_str()).unwrap_or("");
        let link_body = link.get(2).map(|item| item.as_str()).unwrap_or("");
        let href = rels.get(id).cloned().unwrap_or_default();
        output.push_str(&format!(
            r#"<a href="{}">{}</a>"#,
            html_escape(&href),
            plain_runs_to_html(link_body)
        ));
        last = full.end();
    }
    output.push_str(&plain_runs_to_html(&body[last..]));
    output
}

fn plain_runs_to_html(body: &str) -> String {
    let run_re = Regex::new(r"(?is)<w:r\b[^>]*>(.*?)</w:r>").unwrap();
    let text_re = Regex::new(r"(?is)<w:t\b[^>]*>(.*?)</w:t>").unwrap();
    let blip_re = Regex::new(r#"(?is)<a:blip\b[^>]*(?:r:embed|r:link)="([^"]+)""#).unwrap();
    let mut line = String::new();
    for run in run_re.captures_iter(body) {
        let run_xml = run.get(1).map(|item| item.as_str()).unwrap_or("");
        if let Some(blip) = blip_re.captures(run_xml) {
            let image_id = blip.get(1).map(|item| item.as_str()).unwrap_or("image");
            line.push_str(&format!(
                r#"<span data-docx-image="{}" contenteditable="false">[image: {}]</span>"#,
                html_escape(image_id),
                html_escape(image_id)
            ));
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

fn paragraph_to_html(paragraph: &str, rels: &HashMap<String, String>) -> String {
    let style_re = Regex::new(r#"(?is)<w:pStyle\b[^>]*w:val="([^"]+)""#).unwrap();
    let style = style_re
        .captures(paragraph)
        .and_then(|capture| capture.get(1))
        .map(|item| item.as_str().to_ascii_lowercase())
        .unwrap_or_default();
    let line = runs_to_html(paragraph, rels);
    let body = if line.trim().is_empty() { "<br>".to_string() } else { line };
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

fn table_to_html(table: &str, rels: &HashMap<String, String>) -> String {
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
                cell_html.push_str(&runs_to_html(paragraph.get(1).map(|item| item.as_str()).unwrap_or(""), rels));
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

fn docx_bytes_to_html(bytes: &[u8]) -> Result<(String, Vec<String>), String> {
    let mut archive = ZipArchive::new(Cursor::new(bytes)).map_err(|e| e.to_string())?;
    let rels = rel_targets(&mut archive);
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
            html.push_str(&table_to_html(xml, &rels));
        } else {
            html.push_str(&paragraph_to_html(xml, &rels));
        }
    }
    if html.trim().is_empty() {
        html = "<p><br></p>".to_string();
    }
    Ok((html, vec!["docx.warning.commonFormatsOnly".to_string()]))
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

fn image_drawing_xml(rel_id: &str) -> String {
    format!(
        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3657600" cy="2743200"/><wp:docPr id="1" name="LatoTex image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3657600" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
        xml_escape(rel_id)
    )
}

fn inline_html_to_runs(
    inline: &str,
    heading: u8,
    prefix: Option<&str>,
    images: &HashMap<String, String>,
) -> String {
    let tag_re = Regex::new(r#"(?is)<[^>]+>"#).unwrap();
    let href_re = Regex::new(r#"(?is)href=["']([^"']+)["']"#).unwrap();
    let mut style = InlineStyle { heading, ..InlineStyle::default() };
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
        if lower.starts_with("<img") {
            if let Some(path) = attr_value(tag.as_str(), "data-docx-resource") {
                if let Some(rel_id) = images.get(&path) {
                    runs.push_str(&image_drawing_xml(rel_id));
                } else {
                    runs.push_str(&text_run(&format!("[image: {path}]"), style));
                }
            }
        } else if lower.starts_with("<strong") || lower.starts_with("<b") {
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
        } else if lower.starts_with("<a") {
            if let Some(url) = href_re.captures(tag.as_str()).and_then(|capture| capture.get(1)) {
                runs.push_str(&format!(
                    r#"<w:hyperlink w:history="1"><w:r><w:fldChar w:fldCharType="begin"/></w:r><w:r><w:instrText xml:space="preserve"> HYPERLINK "{}" </w:instrText></w:r><w:r><w:fldChar w:fldCharType="separate"/></w:r>"#,
                    xml_escape(url.as_str())
                ));
            }
        } else if lower.starts_with("</a") {
            runs.push_str(r#"<w:r><w:fldChar w:fldCharType="end"/></w:r></w:hyperlink>"#);
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

fn paragraph_xml(
    body: &str,
    heading: u8,
    prefix: Option<&str>,
    images: &HashMap<String, String>,
) -> String {
    let props = match heading {
        1 => r#"<w:pPr><w:pStyle w:val="Heading1"/></w:pPr>"#,
        2 => r#"<w:pPr><w:pStyle w:val="Heading2"/></w:pPr>"#,
        _ => "",
    };
    format!("<w:p>{props}{}</w:p>", inline_html_to_runs(body, heading, prefix, images))
}

fn table_xml(table: &str, images: &HashMap<String, String>) -> String {
    let row_re = Regex::new(r"(?is)<tr\b[^>]*>(.*?)</tr>").unwrap();
    let cell_re = Regex::new(r"(?is)<t[dh]\b[^>]*>(.*?)</t[dh]>").unwrap();
    let mut xml = String::from("<w:tbl><w:tblPr><w:tblW w:w=\"0\" w:type=\"auto\"/></w:tblPr>");
    for row in row_re.captures_iter(table) {
        xml.push_str("<w:tr>");
        let row_body = row.get(1).map(|item| item.as_str()).unwrap_or("");
        for cell in cell_re.captures_iter(row_body) {
            let cell_body = cell.get(1).map(|item| item.as_str()).unwrap_or("");
            xml.push_str("<w:tc><w:tcPr><w:tcW w:w=\"2400\" w:type=\"dxa\"/></w:tcPr>");
            xml.push_str(&paragraph_xml(cell_body, 0, None, images));
            xml.push_str("</w:tc>");
        }
        xml.push_str("</w:tr>");
    }
    xml.push_str("</w:tbl>");
    xml
}

fn blocks_from_html(html: &str, images: &HashMap<String, String>) -> Vec<String> {
    let block_re = Regex::new(r"(?is)<table\b[^>]*>.*?</table>|<(h1|h2|h3|p|div|li)\b[^>]*>(.*?)</(?:h1|h2|h3|p|div|li)>").unwrap();
    let mut out = Vec::new();
    let mut ordered_index = 1_u32;
    for block in block_re.captures_iter(html) {
        let full = block.get(0).map(|item| item.as_str()).unwrap_or("");
        if full.to_ascii_lowercase().starts_with("<table") {
            out.push(table_xml(full, images));
            continue;
        }
        let tag = block.get(1).map(|item| item.as_str().to_ascii_lowercase()).unwrap_or_default();
        let body = block.get(2).map(|item| item.as_str()).unwrap_or("");
        if strip_tags(body).trim().is_empty() {
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
        out.push(paragraph_xml(body, heading, prefix.as_deref(), images));
    }
    if out.is_empty() {
        let text = strip_tags(html);
        vec![paragraph_xml(&html_escape(&text), 0, None, images)]
    } else {
        out
    }
}

fn document_xml_from_html(html: &str, images: &HashMap<String, String>) -> String {
    let blocks = blocks_from_html(html, images).into_iter().collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{blocks}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#
    )
}

fn minimal_docx_bytes(document_xml: &str) -> Result<Vec<u8>, String> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("[Content_Types].xml", options).map_err(|e| e.to_string())?;
    writer.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#).map_err(|e| e.to_string())?;
    writer.start_file("_rels/.rels", options).map_err(|e| e.to_string())?;
    writer.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#).map_err(|e| e.to_string())?;
    writer.start_file("word/document.xml", options).map_err(|e| e.to_string())?;
    writer.write_all(document_xml.as_bytes()).map_err(|e| e.to_string())?;
    writer.finish().map_err(|e| e.to_string()).map(|cursor| cursor.into_inner())
}

fn extract_image_assets(
    db_path: &Path,
    project_id: &str,
    html: &str,
) -> (Vec<DocxImageAsset>, HashMap<String, String>) {
    let img_re = Regex::new(r#"(?is)<img\b[^>]*data-docx-resource=["']([^"']+)["'][^>]*>"#).unwrap();
    let mut assets = Vec::new();
    let mut rels = HashMap::new();
    for capture in img_re.captures_iter(html) {
        let Some(path_match) = capture.get(1) else { continue };
        let resource_path = html_unescape(path_match.as_str());
        if rels.contains_key(&resource_path) || resource_path.contains("..") {
            continue;
        }
        let Some(content_type) = image_content_type(&resource_path) else { continue };
        let Ok(file) = storage::read_project_file_binary(db_path, project_id, &resource_path) else {
            continue;
        };
        let extension = resource_path.rsplit('.').next().unwrap_or("bin").to_ascii_lowercase();
        let rel_id = format!("rIdLatotexImage{}", assets.len() + 1);
        let media_name = format!("latotex-image-{}.{}", assets.len() + 1, extension);
        rels.insert(resource_path.clone(), rel_id.clone());
        assets.push(DocxImageAsset { resource_path, rel_id, media_name, content_type: content_type.to_string(), bytes: file.bytes });
    }
    (assets, rels)
}

fn append_image_relationships(existing: Option<String>, images: &[DocxImageAsset]) -> String {
    let mut rels = existing.unwrap_or_else(|| {
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>"#.to_string()
    });
    let insert = images
        .iter()
        .map(|image| {
            format!(
                r#"<Relationship Id="{}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/{}"/>"#,
                xml_escape(&image.rel_id),
                xml_escape(&image.media_name)
            )
        })
        .collect::<String>();
    if let Some(index) = rels.rfind("</Relationships>") {
        rels.insert_str(index, &insert);
    }
    rels
}

fn patch_content_types(existing: String, images: &[DocxImageAsset]) -> String {
    let mut next = existing;
    for image in images {
        let ext = image.media_name.rsplit('.').next().unwrap_or("");
        if ext.is_empty() || next.contains(&format!(r#"Extension="{ext}""#)) {
            continue;
        }
        let default = format!(
            r#"<Default Extension="{}" ContentType="{}"/>"#,
            xml_escape(ext),
            xml_escape(&image.content_type)
        );
        if let Some(index) = next.rfind("</Types>") {
            next.insert_str(index, &default);
        }
    }
    next
}

fn replace_document_xml(original: &[u8], document_xml: &str, images: &[DocxImageAsset]) -> Result<Vec<u8>, String> {
    let mut archive = ZipArchive::new(Cursor::new(original)).map_err(|e| e.to_string())?;
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut replaced = false;
    let mut rels_replaced = false;
    let mut content_types_replaced = false;
    for index in 0..archive.len() {
        let mut file = archive.by_index(index).map_err(|e| e.to_string())?;
        let name = file.name().to_string();
        if name.ends_with('/') {
            writer.add_directory(name, options).map_err(|e| e.to_string())?;
            continue;
        }
        writer.start_file(name.clone(), options).map_err(|e| e.to_string())?;
        if name == "word/document.xml" {
            writer.write_all(document_xml.as_bytes()).map_err(|e| e.to_string())?;
            replaced = true;
        } else if name == "word/_rels/document.xml.rels" {
            let mut text = String::new();
            file.read_to_string(&mut text).map_err(|e| e.to_string())?;
            writer.write_all(append_image_relationships(Some(text), images).as_bytes()).map_err(|e| e.to_string())?;
            rels_replaced = true;
        } else if name == "[Content_Types].xml" {
            let mut text = String::new();
            file.read_to_string(&mut text).map_err(|e| e.to_string())?;
            writer.write_all(patch_content_types(text, images).as_bytes()).map_err(|e| e.to_string())?;
            content_types_replaced = true;
        } else {
            let mut bytes = Vec::new();
            file.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
            writer.write_all(&bytes).map_err(|e| e.to_string())?;
        }
    }
    if !replaced {
        writer.start_file("word/document.xml", options).map_err(|e| e.to_string())?;
        writer.write_all(document_xml.as_bytes()).map_err(|e| e.to_string())?;
    }
    if !rels_replaced && !images.is_empty() {
        writer.start_file("word/_rels/document.xml.rels", options).map_err(|e| e.to_string())?;
        writer.write_all(append_image_relationships(None, images).as_bytes()).map_err(|e| e.to_string())?;
    }
    if !content_types_replaced && !images.is_empty() {
        writer.start_file("[Content_Types].xml", options).map_err(|e| e.to_string())?;
        writer.write_all(patch_content_types(String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#), images).as_bytes()).map_err(|e| e.to_string())?;
    }
    for image in images {
        let _ = &image.resource_path;
        writer.start_file(format!("word/media/{}", image.media_name), options).map_err(|e| e.to_string())?;
        writer.write_all(&image.bytes).map_err(|e| e.to_string())?;
    }
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
        let (images, image_rels) = extract_image_assets(&db_path, &input.project_id, &input.html);
        let document_xml = document_xml_from_html(&input.html, &image_rels);
        let bytes = match storage::read_project_file_binary(&db_path, &input.project_id, &input.relative_path) {
            Ok(existing) => replace_document_xml(&existing.bytes, &document_xml, &images)
                .or_else(|_| minimal_docx_bytes(&document_xml))?,
            Err(_) => minimal_docx_bytes(&document_xml)?,
        };
        storage::write_project_file_binary(&db_path, &input.project_id, &input.relative_path, &bytes)
    })
    .await
    .map_err(|e| e.to_string())?
}
