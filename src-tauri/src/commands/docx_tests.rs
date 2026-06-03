use super::*;
use super::super::docx::docx_bytes_to_html;
use std::collections::HashMap;
use std::io::{Cursor, Read};
use zip::ZipArchive;

fn image_asset() -> DocxImageAsset {
    DocxImageAsset {
        resource_path: "fig.png".to_string(),
        rel_id: "rIdLatotexImage1".to_string(),
        media_name: "latotex-image-1.png".to_string(),
        content_type: "image/png".to_string(),
        bytes: vec![137, 80, 78, 71, 13, 10, 26, 10],
    }
}

#[test]
fn image_only_docx_paragraph_generates_drawing_run() {
    let image_rels = HashMap::from([("fig.png".to_string(), "rIdLatotexImage1".to_string())]);
    let xml = document_xml_from_html(
        r#"<p><img data-docx-resource="fig.png" src="blob:fig" alt="Figure" /></p>"#,
        &image_rels,
    );

    assert!(xml.contains("<w:drawing>"));
    assert!(xml.contains(r#"r:embed="rIdLatotexImage1""#));
}

#[test]
fn minimal_docx_persists_images_and_reads_them_back() {
    let image_rels = HashMap::from([("fig.png".to_string(), "rIdLatotexImage1".to_string())]);
    let document_xml = document_xml_from_html(
        r#"<p><img data-docx-resource="fig.png" src="blob:fig" alt="Figure" /></p>"#,
        &image_rels,
    );
    let image = image_asset();
    let bytes = minimal_docx_bytes(&document_xml, &[image]).expect("docx bytes");
    let mut archive = ZipArchive::new(Cursor::new(bytes.as_slice())).expect("zip archive");

    let mut rels = String::new();
    archive
        .by_name("word/_rels/document.xml.rels")
        .expect("document rels")
        .read_to_string(&mut rels)
        .expect("rels text");
    assert!(rels.contains(r#"Id="rIdLatotexImage1""#));
    assert!(archive.by_name("word/media/latotex-image-1.png").is_ok());

    let mut content_types = String::new();
    archive
        .by_name("[Content_Types].xml")
        .expect("content types")
        .read_to_string(&mut content_types)
        .expect("content types text");
    assert!(content_types.contains(r#"Extension="png""#));
    drop(archive);

    let (html, _warnings) = docx_bytes_to_html(&bytes).expect("read generated docx");
    assert!(html.contains("data-docx-embedded"));
    assert!(html.contains("data:image/png;base64,"));
}

#[test]
fn generated_image_relationships_replace_previous_generated_entries() {
    let rels = append_image_relationships(
        Some(r#"<?xml version="1.0"?><Relationships><Relationship Id="rIdLatotexImage1" Type="old" Target="media/old.png"/><Relationship Id="rIdExternal" Type="other" Target="settings.xml"/></Relationships>"#.to_string()),
        &[image_asset()],
    );

    assert_eq!(rels.matches("rIdLatotexImage1").count(), 1);
    assert!(rels.contains("rIdExternal"));
    assert!(!rels.contains("media/old.png"));
}
