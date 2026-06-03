use super::docx_images::{
    append_image_relationships, patch_content_types, DocxImageAsset,
};
use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read, Write};
use zip::{write::SimpleFileOptions, ZipArchive, ZipWriter};

fn xml_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn html_escape(value: &str) -> String {
    value.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

fn html_unescape(value: &str) -> String {
    value.replace("&nbsp;", " ").replace("&amp;", "&").replace("&lt;", "<").replace("&gt;", ">").replace("&quot;", "\"")
}

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?is)\b{}\s*=\s*["']([^"']+)["']"#, regex::escape(name))).ok()?;
    re.captures(tag).and_then(|capture| capture.get(1)).map(|item| html_unescape(item.as_str()))
}

fn strip_tags(value: &str) -> String {
    let tag_re = Regex::new(r"(?is)<[^>]+>").unwrap();
    html_unescape(tag_re.replace_all(value, "").trim())
}

#[derive(Clone, Copy, Default)]
struct InlineStyle {
    bold: bool,
    italic: bool,
    underline: bool,
    strike: bool,
    subscript: bool,
    superscript: bool,
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
    if style.strike {
        props.push_str("<w:strike/>");
    }
    if style.subscript {
        props.push_str(r#"<w:vertAlign w:val="subscript"/>"#);
    } else if style.superscript {
        props.push_str(r#"<w:vertAlign w:val="superscript"/>"#);
    }
    if style.heading == 1 {
        props.push_str(r#"<w:sz w:val="32"/>"#);
    } else if style.heading == 2 {
        props.push_str(r#"<w:sz w:val="26"/>"#);
    }
    if props.is_empty() { String::new() } else { format!("<w:rPr>{props}</w:rPr>") }
}

fn text_run(text: &str, style: InlineStyle) -> String {
    format!(r#"<w:r>{}<w:t xml:space="preserve">{}</w:t></w:r>"#, run_props(style), xml_escape(text))
}

fn image_drawing_xml(rel_id: &str) -> String {
    format!(
        r#"<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="3657600" cy="2743200"/><wp:docPr id="1" name="LatoTex image"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="1" name="image"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="{}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="3657600" cy="2743200"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>"#,
        xml_escape(rel_id)
    )
}

fn inline_html_to_runs(inline: &str, heading: u8, prefix: Option<&str>, images: &HashMap<String, String>) -> String {
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
            let image_key = attr_value(tag.as_str(), "data-docx-resource")
                .or_else(|| attr_value(tag.as_str(), "data-docx-embedded"))
                .or_else(|| attr_value(tag.as_str(), "data-docx-media"));
            if let Some(path) = image_key {
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
        } else if lower.starts_with("<s") {
            style.strike = true;
        } else if lower.starts_with("</s") {
            style.strike = false;
        } else if lower.starts_with("<sub") {
            style.subscript = true;
            style.superscript = false;
        } else if lower.starts_with("</sub") {
            style.subscript = false;
        } else if lower.starts_with("<sup") {
            style.superscript = true;
            style.subscript = false;
        } else if lower.starts_with("</sup") {
            style.superscript = false;
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
    if runs.is_empty() { "<w:r><w:t></w:t></w:r>".to_string() } else { runs }
}

fn paragraph_xml(body: &str, heading: u8, prefix: Option<&str>, images: &HashMap<String, String>) -> String {
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
        if full.to_ascii_lowercase().contains("data-docx-page-break=\"true\"") {
            out.push("<w:p><w:r><w:br w:type=\"page\"/></w:r></w:p>".to_string());
            continue;
        }
        let has_image = body.to_ascii_lowercase().contains("<img");
        if strip_tags(body).trim().is_empty() && !has_image {
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

pub(super) fn document_xml_from_html(html: &str, images: &HashMap<String, String>) -> String {
    let blocks = blocks_from_html(html, images).into_iter().collect::<String>();
    format!(
        r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:body>{blocks}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr></w:body></w:document>"#
    )
}

pub(super) fn minimal_docx_bytes(document_xml: &str, images: &[DocxImageAsset]) -> Result<Vec<u8>, String> {
    let mut writer = ZipWriter::new(Cursor::new(Vec::new()));
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    writer.start_file("[Content_Types].xml", options).map_err(|e| e.to_string())?;
    writer.write_all(patch_content_types(String::from(r#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>"#), images).as_bytes()).map_err(|e| e.to_string())?;
    writer.start_file("_rels/.rels", options).map_err(|e| e.to_string())?;
    writer.write_all(br#"<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>"#).map_err(|e| e.to_string())?;
    writer.start_file("word/document.xml", options).map_err(|e| e.to_string())?;
    writer.write_all(document_xml.as_bytes()).map_err(|e| e.to_string())?;
    if !images.is_empty() {
        writer.start_file("word/_rels/document.xml.rels", options).map_err(|e| e.to_string())?;
        writer.write_all(append_image_relationships(None, images).as_bytes()).map_err(|e| e.to_string())?;
        for image in images {
            writer.start_file(format!("word/media/{}", image.media_name), options).map_err(|e| e.to_string())?;
            writer.write_all(&image.bytes).map_err(|e| e.to_string())?;
        }
    }
    writer.finish().map_err(|e| e.to_string()).map(|cursor| cursor.into_inner())
}

pub(super) fn replace_document_xml(original: &[u8], document_xml: &str, images: &[DocxImageAsset]) -> Result<Vec<u8>, String> {
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
        if images.iter().any(|image| name == format!("word/media/{}", image.media_name)) {
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

#[cfg(test)]
#[path = "docx_tests.rs"]
mod docx_tests;
