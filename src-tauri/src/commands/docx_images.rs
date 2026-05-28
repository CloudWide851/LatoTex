use crate::storage;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use regex::Regex;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use std::path::Path;
use zip::ZipArchive;

#[derive(Clone)]
pub(crate) struct DocxImageAsset {
    pub(crate) resource_path: String,
    pub(crate) rel_id: String,
    pub(crate) media_name: String,
    pub(crate) content_type: String,
    pub(crate) bytes: Vec<u8>,
}

fn xml_escape(value: &str) -> String {
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

fn attr_value(tag: &str, name: &str) -> Option<String> {
    let re = Regex::new(&format!(r#"(?is)\b{}\s*=\s*["']([^"']+)["']"#, regex::escape(name))).ok()?;
    re.captures(tag)
        .and_then(|capture| capture.get(1))
        .map(|item| html_unescape(item.as_str()))
}

fn media_name_from_target(target: &str) -> Option<String> {
    let normalized = target.replace('\\', "/");
    let file_name = normalized.rsplit('/').next()?.trim();
    if file_name.is_empty() || file_name.contains("..") {
        None
    } else {
        Some(file_name.to_string())
    }
}

fn decode_image_data_url(src: &str) -> Option<(String, Vec<u8>)> {
    let rest = src.strip_prefix("data:")?;
    let (meta, data) = rest.split_once(',')?;
    if !meta.ends_with(";base64") {
        return None;
    }
    let mime = meta.trim_end_matches(";base64").to_string();
    if !matches!(mime.as_str(), "image/png" | "image/jpeg" | "image/gif" | "image/webp" | "image/svg+xml") {
        return None;
    }
    let bytes = BASE64_STANDARD.decode(data.as_bytes()).ok()?;
    Some((mime, bytes))
}

pub(crate) fn embedded_image_sources(
    archive: &mut ZipArchive<Cursor<&[u8]>>,
    rels: &HashMap<String, String>,
) -> HashMap<String, String> {
    let mut out = HashMap::new();
    for (rel_id, target) in rels {
        let Some(media_name) = media_name_from_target(target) else { continue };
        let Some(content_type) = image_content_type(&media_name) else { continue };
        let normalized = target.replace('\\', "/");
        let path = if normalized.starts_with("word/") {
            normalized
        } else if normalized.starts_with("/word/") {
            normalized.trim_start_matches('/').to_string()
        } else {
            format!("word/{}", normalized.trim_start_matches('/'))
        };
        let Ok(mut file) = archive.by_name(&path) else { continue };
        let mut bytes = Vec::new();
        if file.read_to_end(&mut bytes).is_err() {
            continue;
        }
        let encoded = BASE64_STANDARD.encode(bytes);
        out.insert(rel_id.clone(), format!("data:{};base64,{}", content_type, encoded));
    }
    out
}

pub(crate) fn extract_image_assets(
    db_path: &Path,
    project_id: &str,
    html: &str,
) -> (Vec<DocxImageAsset>, HashMap<String, String>) {
    let img_re = Regex::new(r#"(?is)<img\b[^>]*>"#).unwrap();
    let mut assets = Vec::new();
    let mut rels = HashMap::new();
    for img in img_re.find_iter(html) {
        let tag = img.as_str();
        let resource_path = attr_value(tag, "data-docx-resource");
        let embedded_key = attr_value(tag, "data-docx-embedded")
            .or_else(|| attr_value(tag, "data-docx-media"));
        let Some(key) = resource_path.clone().or(embedded_key) else { continue };
        if rels.contains_key(&key) || key.contains("..") {
            continue;
        }
        let (content_type, bytes, extension) = if let Some(path) = resource_path {
            let Some(content_type) = image_content_type(&path) else { continue };
            let Ok(file) = storage::read_project_file_binary(db_path, project_id, &path) else {
                continue;
            };
            (
                content_type.to_string(),
                file.bytes,
                path.rsplit('.').next().unwrap_or("bin").to_ascii_lowercase(),
            )
        } else {
            let Some(src) = attr_value(tag, "src") else { continue };
            let Some((content_type, bytes)) = decode_image_data_url(&src) else { continue };
            let extension = match content_type.as_str() {
                "image/png" => "png",
                "image/jpeg" => "jpg",
                "image/gif" => "gif",
                "image/webp" => "webp",
                "image/svg+xml" => "svg",
                _ => "bin",
            };
            (content_type, bytes, extension.to_string())
        };
        let rel_id = format!("rIdLatotexImage{}", assets.len() + 1);
        let media_name = format!("latotex-image-{}.{}", assets.len() + 1, extension);
        rels.insert(key.clone(), rel_id.clone());
        assets.push(DocxImageAsset { resource_path: key, rel_id, media_name, content_type, bytes });
    }
    (assets, rels)
}

pub(crate) fn append_image_relationships(existing: Option<String>, images: &[DocxImageAsset]) -> String {
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

pub(crate) fn patch_content_types(existing: String, images: &[DocxImageAsset]) -> String {
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
