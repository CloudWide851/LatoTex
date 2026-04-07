use super::{
    handle_local_resource_request, normalize_workspace_relative_path, workspace_file_response,
    LOCAL_RESOURCE_SCHEME,
};
use crate::state::AppState;
use crate::storage;
use std::collections::HashMap;
use std::fs;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Condvar, Mutex};
use std::path::{Path, PathBuf};
use tauri::http::{header::HeaderValue, Method, Request};
use urlencoding::encode;

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

struct TestFixture {
    state: AppState,
    project_id: String,
    project_root: PathBuf,
    temp_root: PathBuf,
}

impl Drop for TestFixture {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.temp_root);
    }
}

fn create_test_fixture(name: &str) -> TestFixture {
    let temp_root = std::env::temp_dir().join(format!(
        "latotex-local-resource-fixture-{}-{}",
        name,
        std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos()
    ));
    let runtime_root = temp_root.join("runtime");
    let app_data_dir = temp_root.join("app-data");
    let projects_dir = runtime_root.join("projects");
    let logs_dir = runtime_root.join("logs");
    let downloads_dir = runtime_root.join("downloads");
    let db_path = runtime_root.join("latotex.db");
    let session_log_path = logs_dir.join("session.log");

    fs::create_dir_all(&projects_dir).unwrap();
    fs::create_dir_all(&logs_dir).unwrap();
    fs::create_dir_all(&downloads_dir).unwrap();
    fs::create_dir_all(&app_data_dir).unwrap();
    fs::write(&session_log_path, b"").unwrap();

    storage::initialize_database(&db_path).unwrap();
    let snapshot = storage::create_project(&db_path, &projects_dir, "Local Resource Test").unwrap();
    let project_id = snapshot.summary.id;
    let project_root = PathBuf::from(snapshot.summary.root_path);

    let state = AppState {
        app_name: "LatoTex".to_string(),
        runtime_root,
        app_data_dir,
        projects_dir,
        db_path,
        logs_dir,
        downloads_dir,
        session_log_path,
        install_mode: "test".to_string(),
        app_version: "0.1.0-test".to_string(),
        git_download_tasks: Arc::new(Mutex::new(HashMap::new())),
        library_pdf_cache_tasks: Arc::new(Mutex::new(HashMap::new())),
        library_translate_tasks: Arc::new(Mutex::new(HashMap::new())),
        analysis_env_prepare_tasks: Arc::new(Mutex::new(HashMap::new())),
        latex_compile_tasks: Arc::new(Mutex::new(HashMap::new())),
        agent_slots: Arc::new((Mutex::new(0), Condvar::new())),
        agent_cancel_flags: Arc::new(Mutex::new(HashMap::<String, Arc<AtomicBool>>::new())),
    };

    TestFixture {
        state,
        project_id,
        project_root,
        temp_root,
    }
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
fn handle_local_resource_request_serves_library_pdf_from_workspace_route() {
    let fixture = create_test_fixture("library-pdf");
    let relative_path = ".latotex/papers/Deep Learning Survey 2026.pdf";
    let pdf_path = fixture.project_root.join(".latotex").join("papers").join("Deep Learning Survey 2026.pdf");
    fs::create_dir_all(pdf_path.parent().unwrap()).unwrap();
    fs::write(&pdf_path, b"%PDF-library-preview").unwrap();

    let request = Request::builder()
        .method(Method::GET)
        .uri(format!(
            "http://{}.localhost/workspace-file/{}/{}",
            LOCAL_RESOURCE_SCHEME,
            encode(&fixture.project_id),
            encode(relative_path),
        ))
        .body(Vec::new())
        .unwrap();

    let response = handle_local_resource_request(&fixture.state, &request);

    assert_eq!(response.status(), 200);
    assert_eq!(response.body(), b"%PDF-library-preview");
    assert_eq!(
        response.headers().get("Content-Type"),
        Some(&HeaderValue::from_static("application/pdf"))
    );
}

#[test]
fn handle_local_resource_request_preserves_head_and_range_for_library_pdf() {
    let fixture = create_test_fixture("library-range");
    let relative_path = ".latotex/papers/range-check.pdf";
    let pdf_path = fixture.project_root.join(".latotex").join("papers").join("range-check.pdf");
    fs::create_dir_all(pdf_path.parent().unwrap()).unwrap();
    fs::write(&pdf_path, b"%PDF-range-check").unwrap();

    let base_uri = format!(
        "http://{}.localhost/workspace-file/{}/{}",
        LOCAL_RESOURCE_SCHEME,
        encode(&fixture.project_id),
        encode(relative_path),
    );

    let head_request = Request::builder()
        .method(Method::HEAD)
        .uri(&base_uri)
        .body(Vec::new())
        .unwrap();
    let head_response = handle_local_resource_request(&fixture.state, &head_request);
    assert_eq!(head_response.status(), 200);
    assert!(head_response.body().is_empty());
    assert_eq!(
        head_response.headers().get("Content-Length"),
        Some(&HeaderValue::from_static("16"))
    );

    let range_request = Request::builder()
        .method(Method::GET)
        .uri(base_uri)
        .header("Range", "bytes=5-9")
        .body(Vec::new())
        .unwrap();
    let range_response = handle_local_resource_request(&fixture.state, &range_request);
    assert_eq!(range_response.status(), 206);
    assert_eq!(range_response.body(), b"range");
    assert_eq!(
        range_response.headers().get("Content-Range"),
        Some(&HeaderValue::from_static("bytes 5-9/16"))
    );
}

#[test]
fn handle_local_resource_request_serves_drawio_index_from_local_resources() {
    let fixture = create_test_fixture("drawio-index");
    let request = Request::builder()
        .method(Method::GET)
        .uri(format!(
            "http://{}.localhost/tool/drawio/index.html",
            LOCAL_RESOURCE_SCHEME
        ))
        .body(Vec::new())
        .unwrap();

    let response = handle_local_resource_request(&fixture.state, &request);

    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers().get("Content-Type"),
        Some(&HeaderValue::from_static("text/html; charset=utf-8"))
    );
    assert!(
        String::from_utf8_lossy(response.body()).contains("<!DOCTYPE html>")
            || String::from_utf8_lossy(response.body()).contains("<html"),
        "drawio host page should be served as html"
    );
}

#[test]
fn handle_local_resource_request_serves_drawio_runtime_script() {
    let fixture = create_test_fixture("drawio-script");
    let request = Request::builder()
        .method(Method::GET)
        .uri(format!(
            "http://{}.localhost/tool/drawio/js/bootstrap.js",
            LOCAL_RESOURCE_SCHEME
        ))
        .body(Vec::new())
        .unwrap();

    let response = handle_local_resource_request(&fixture.state, &request);

    assert_eq!(response.status(), 200);
    assert_eq!(
        response.headers().get("Content-Type"),
        Some(&HeaderValue::from_static("application/javascript; charset=utf-8"))
    );
    assert!(
        !response.body().is_empty(),
        "drawio runtime script should not be empty"
    );
}

#[test]
fn handle_local_resource_request_serves_required_drawio_support_assets() {
    let fixture = create_test_fixture("drawio-support-assets");
    for (request_path, expected_content_type) in [
        ("mxgraph/css/common.css", "text/css; charset=utf-8"),
        ("math4/es5/startup.js", "application/javascript; charset=utf-8"),
        ("resources/dia.txt", "application/octet-stream"),
    ] {
        let request = Request::builder()
            .method(Method::GET)
            .uri(format!(
                "http://{}.localhost/tool/drawio/{}",
                LOCAL_RESOURCE_SCHEME, request_path
            ))
            .body(Vec::new())
            .unwrap();

        let response = handle_local_resource_request(&fixture.state, &request);

        assert_eq!(response.status(), 200, "expected {request_path} to be served");
        assert_eq!(
            response.headers().get("Content-Type"),
            Some(&HeaderValue::from_str(expected_content_type).unwrap())
        );
        assert!(
            !response.body().is_empty(),
            "expected {request_path} body to be non-empty"
        );
    }
}
