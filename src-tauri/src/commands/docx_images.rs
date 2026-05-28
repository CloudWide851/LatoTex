use crate::storage;
use regex::Regex;
use std::collections::HashMap;
use std::path::Path;

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

pub(crate) fn extract_image_assets(
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
