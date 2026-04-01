use super::*;
use std::fs;

fn temp_test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "latotex-library-pdf-preview-{}-{}",
        name,
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn pdf_bytes_valid_accepts_leading_whitespace_pdf_header() {
    assert!(pdf_bytes_valid(b"\n\r\t%PDF-1.7\n"));
}

#[test]
fn pdf_bytes_valid_rejects_html_payload() {
    assert!(!pdf_bytes_valid(b"<html><body>not a pdf</body></html>"));
}

#[test]
fn cached_pdf_file_ready_rejects_non_pdf_cached_file() {
    let dir = temp_test_dir("invalid-cache");
    let cache_path = dir.join("paper.pdf");
    fs::write(&cache_path, b"<html>denied</html>").unwrap();

    assert!(!cached_pdf_file_ready(&cache_path));

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn cached_pdf_file_ready_accepts_valid_pdf_header() {
    let dir = temp_test_dir("valid-cache");
    let cache_path = dir.join("paper.pdf");
    fs::write(&cache_path, b"%PDF-1.7\n1 0 obj\n").unwrap();

    assert!(cached_pdf_file_ready(&cache_path));

    let _ = fs::remove_dir_all(dir);
}
