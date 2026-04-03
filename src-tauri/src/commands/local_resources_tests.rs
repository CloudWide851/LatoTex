use super::{
    build_workspace_file_resource_url, normalize_relative_asset_path,
    normalize_workspace_relative_path, resolve_drawio_marker_dir, workspace_file_response,
    LOCAL_RESOURCE_SCHEME,
};
use std::fs;
use std::path::{Path, PathBuf};
use tauri::http::{header::HeaderValue, Method};

fn temp_workspace_file_path(name: &str, bytes: &[u8]) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "latotex-local-resource-test-{}-{}",
        name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    fs::create_dir_all(&dir).unwrap();
    let path = dir.join(name);
    fs::write(&path, bytes).unwrap();
    path
}

fn cleanup_temp_workspace_file(path: &Path) {
    if let Some(parent) = path.parent() {
        let _ = fs::remove_dir_all(parent);
    }
}

#[test]
fn drawio_entry_url_uses_custom_local_resource_scheme() {
    let value = format!("http://{}.localhost/tool/drawio/index.html", LOCAL_RESOURCE_SCHEME);
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
    let path = temp_workspace_file_path("sample.pdf", b"%PDF-demo");
    let response = workspace_file_response(
        &Method::GET,
        &path,
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
    cleanup_temp_workspace_file(&path);
}

#[test]
fn workspace_file_response_supports_single_byte_ranges() {
    let path = temp_workspace_file_path("range.pdf", b"0123456789");
    let response = workspace_file_response(
        &Method::GET,
        &path,
        "application/pdf",
        Some("bytes=2-5"),
    );
    assert_eq!(response.status(), 206);
    assert_eq!(response.body(), b"2345");
    assert_eq!(
        response.headers().get("Content-Range"),
        Some(&HeaderValue::from_static("bytes 2-5/10"))
    );
    cleanup_temp_workspace_file(&path);
}

#[test]
fn workspace_file_response_rejects_unsatisfiable_ranges() {
    let path = temp_workspace_file_path("unsat.pdf", b"0123");
    let response = workspace_file_response(
        &Method::GET,
        &path,
        "application/pdf",
        Some("bytes=99-120"),
    );
    assert_eq!(response.status(), 416);
    assert_eq!(
        response.headers().get("Content-Range"),
        Some(&HeaderValue::from_static("bytes */4"))
    );
    cleanup_temp_workspace_file(&path);
}

#[test]
fn workspace_file_response_head_reports_real_content_length() {
    let path = temp_workspace_file_path("head.pdf", b"%PDF-1.7\npayload");
    let response = workspace_file_response(
        &Method::HEAD,
        &path,
        "application/pdf",
        None,
    );
    assert_eq!(response.status(), 200);
    assert!(response.body().is_empty());
    assert_eq!(
        response.headers().get("Content-Length"),
        Some(&HeaderValue::from_static("16"))
    );
    cleanup_temp_workspace_file(&path);
}

#[test]
fn normalize_workspace_relative_path_rejects_traversal() {
    assert!(normalize_workspace_relative_path("../secret.pdf").is_err());
}

#[test]
fn resolve_drawio_marker_dir_prefers_marker_actual_dir() {
    let base = std::env::temp_dir().join(format!(
        "latotex-drawio-marker-{}",
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let marker_dir = base.join("install-cache");
    let actual_dir = base.join("appdata-cache");
    fs::create_dir_all(actual_dir.join("js")).unwrap();
    fs::create_dir_all(actual_dir.join("styles")).unwrap();
    fs::write(actual_dir.join("index.html"), "ok").unwrap();
    fs::write(actual_dir.join("app.html"), "ok").unwrap();
    fs::write(actual_dir.join("js/app.min.js"), "ok").unwrap();
    fs::write(actual_dir.join("js/bootstrap.js"), "ok").unwrap();
    fs::write(actual_dir.join("js/main.js"), "ok").unwrap();
    fs::write(actual_dir.join("styles/grapheditor.css"), "ok").unwrap();
    fs::create_dir_all(&marker_dir).unwrap();
    fs::write(
        marker_dir.join(".cache-info.json"),
        format!(
            "{{\"actualDir\":\"{}\"}}",
            actual_dir.to_string_lossy().replace('\\', "\\\\")
        ),
    )
    .unwrap();

    let resolved = resolve_drawio_marker_dir(&marker_dir).unwrap();
    assert_eq!(resolved, actual_dir);

    let _ = fs::remove_dir_all(base);
}
