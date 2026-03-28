use super::{
    build_drawio_entry_url, build_workspace_file_resource_url, normalize_relative_asset_path,
    normalize_workspace_relative_path, workspace_file_response_bytes, LOCAL_RESOURCE_SCHEME,
};
use std::path::PathBuf;
use tauri::http::{header::HeaderValue, Method};

#[test]
fn drawio_entry_url_uses_custom_local_resource_scheme() {
    let value = build_drawio_entry_url();
    assert!(value.contains(LOCAL_RESOURCE_SCHEME));
    assert!(value.ends_with("/tool/drawio/index.html"));
}

#[test]
fn normalize_relative_asset_path_defaults_to_index() {
    assert_eq!(
        normalize_relative_asset_path("/tool/drawio").unwrap(),
        PathBuf::from("index.html")
    );
}

#[test]
fn normalize_relative_asset_path_rejects_traversal() {
    assert!(normalize_relative_asset_path("/tool/drawio/../secret.txt").is_err());
}

#[test]
fn workspace_file_resource_url_encodes_project_and_relative_path() {
    let value = build_workspace_file_resource_url("project/one", ".latotex/papers/cache file.pdf");
    assert!(value.contains(LOCAL_RESOURCE_SCHEME));
    assert!(value.contains("project%2Fone"));
    assert!(value.contains("cache%20file.pdf"));
}

#[test]
fn workspace_file_response_sets_cors_headers_for_pdf_reads() {
    let response = workspace_file_response_bytes(
        &Method::GET,
        b"%PDF-demo".to_vec(),
        "application/pdf",
        None,
    );
    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers().get("Access-Control-Allow-Origin"),
        Some(&HeaderValue::from_static("*"))
    );
    assert_eq!(
        response.headers().get("Accept-Ranges"),
        Some(&HeaderValue::from_static("bytes"))
    );
    assert_eq!(
        response.headers().get("Content-Length"),
        Some(&HeaderValue::from_static("9"))
    );
}

#[test]
fn workspace_file_response_supports_single_byte_ranges() {
    let response = workspace_file_response_bytes(
        &Method::GET,
        b"0123456789".to_vec(),
        "application/pdf",
        Some("bytes=2-5"),
    );
    assert_eq!(response.status(), 206);
    assert_eq!(response.body(), b"2345");
    assert_eq!(
        response.headers().get("Content-Range"),
        Some(&HeaderValue::from_static("bytes 2-5/10"))
    );
}

#[test]
fn workspace_file_response_rejects_unsatisfiable_ranges() {
    let response = workspace_file_response_bytes(
        &Method::GET,
        b"0123".to_vec(),
        "application/pdf",
        Some("bytes=99-120"),
    );
    assert_eq!(response.status(), 416);
    assert_eq!(
        response.headers().get("Content-Range"),
        Some(&HeaderValue::from_static("bytes */4"))
    );
}

#[test]
fn normalize_workspace_relative_path_rejects_traversal() {
    assert!(normalize_workspace_relative_path("../secret.pdf").is_err());
}
