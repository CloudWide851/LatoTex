use super::{
    build_workspace_file_resource_url, candidate_source_dirs, normalize_relative_asset_path,
    normalize_workspace_relative_path, workspace_file_response, LOCAL_RESOURCE_SCHEME,
    REQUIRED_DRAWIO_ASSETS,
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
fn candidate_source_dirs_include_packaged_and_dev_drawio_locations() {
    let values = candidate_source_dirs("drawio")
        .iter()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .collect::<Vec<_>>();

    assert!(values.iter().any(|value| value.ends_with("/resources/core/drawio")));
    assert!(values.iter().any(|value| value.ends_with("/public/core/drawio")));
}

#[test]
fn required_drawio_assets_include_runtime_lazy_scripts() {
    assert!(REQUIRED_DRAWIO_ASSETS.contains(&"js/extensions.min.js"));
    assert!(REQUIRED_DRAWIO_ASSETS.contains(&"js/stencils.min.js"));
    assert!(REQUIRED_DRAWIO_ASSETS.contains(&"js/shapes-14-6-5.min.js"));
}
