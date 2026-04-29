use super::*;
use std::fs;
use std::collections::HashMap;
use std::path::Path;
use std::sync::atomic::AtomicBool;
use std::sync::{Arc, Condvar, Mutex};

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

fn create_runtime_fixture(name: &str) -> (crate::state::AppState, String, PathBuf, PathBuf) {
    let temp_root = std::env::temp_dir().join(format!(
        "latotex-library-runtime-preview-{}-{}",
        name,
        uuid::Uuid::new_v4()
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

    crate::storage::initialize_database(&db_path).unwrap();
    let snapshot = crate::storage::create_project(&db_path, &projects_dir, "Library Runtime Test").unwrap();
    let project_id = snapshot.summary.id;
    let project_root = PathBuf::from(snapshot.summary.root_path);

    let state = crate::state::AppState {
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
        terminal_sessions: Arc::new(Mutex::new(HashMap::new())),
        agent_slots: Arc::new((Mutex::new(0), Condvar::new())),
        agent_cancel_flags: Arc::new(Mutex::new(HashMap::<String, Arc<AtomicBool>>::new())),
    };

    (state, project_id, project_root, temp_root)
}

fn write_library_source(papers_root: &Path, relative_path: &str) {
    fs::write(
        papers_root.join(relative_path),
        "@article{cachedpaper,\n  title={Cached Paper}\n}\n",
    )
    .unwrap();
}

fn build_test_summary(source_path: &str, source_url: &str) -> LibraryCitationSummaryResponse {
    LibraryCitationSummaryResponse {
        source_path: source_path.to_string(),
        bib_path: Some(source_path.to_string()),
        citation_key: Some("cachedpaper".to_string()),
        title: Some("Cached Paper".to_string()),
        authors: vec!["Test Author".to_string()],
        published_at: None,
        doi: None,
        arxiv_id: None,
        source: None,
        urls: vec![source_url.to_string()],
    }
}

#[test]
fn runtime_preview_returns_cached_remote_binding_without_remote_lookup() {
    let (state, project_id, project_root, temp_root) = create_runtime_fixture("cached-binding");
    let papers_root = crate::storage::library_root(&project_root);
    fs::create_dir_all(&papers_root).unwrap();

    let source_relative = "cached-paper.bib";
    write_library_source(&papers_root, source_relative);

    let cache_dir = papers_root.join(".cache").join("remote-pdf");
    fs::create_dir_all(&cache_dir).unwrap();
    let cache_path = cache_dir.join("cached-paper.pdf");
    fs::write(&cache_path, b"%PDF-1.7\ncached\n").unwrap();

    let ctx = prepare_library_pdf_preview_context(&state.db_path, &project_id, source_relative).unwrap();
    write_remote_cache_binding(&ctx, "https://example.com/cached-paper.pdf", &cache_path).unwrap();

    let preview = library_resolve_pdf_preview_runtime(&state, &project_id, source_relative, false).unwrap();

    assert_eq!(preview.cache_state, LIBRARY_PDF_CACHE_STATE_READY);
    assert_eq!(preview.source_url.as_deref(), Some("https://example.com/cached-paper.pdf"));
    assert_eq!(
        preview.relative_path.as_deref(),
        Some(".latotex/papers/.cache/remote-pdf/cached-paper.pdf")
    );

    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn runtime_preview_migrates_legacy_binding_and_cache_to_stable_names() {
    let (state, project_id, project_root, temp_root) = create_runtime_fixture("legacy-binding");
    let papers_root = crate::storage::library_root(&project_root);
    fs::create_dir_all(&papers_root).unwrap();

    let source_relative = "legacy-paper.bib";
    let source_url = "https://example.com/legacy-paper.pdf";
    write_library_source(&papers_root, source_relative);

    let ctx = prepare_library_pdf_preview_context(&state.db_path, &project_id, source_relative).unwrap();
    let legacy_cache_path = build_legacy_remote_cache_path(&ctx, source_url).unwrap();
    if let Some(parent) = legacy_cache_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&legacy_cache_path, b"%PDF-1.7\nlegacy\n").unwrap();

    let legacy_binding_path =
        legacy_remote_pdf_cache_binding_path_for_relative_path(&papers_root, source_relative).unwrap();
    let legacy_binding = RemotePdfCacheBinding {
        source_url: source_url.to_string(),
        cache_file_name: legacy_cache_path.file_name().unwrap().to_string_lossy().to_string(),
        updated_at_unix_ms: current_unix_ms(),
    };
    fs::write(&legacy_binding_path, serde_json::to_string(&legacy_binding).unwrap()).unwrap();

    let preview = library_resolve_pdf_preview_runtime(&state, &project_id, source_relative, false).unwrap();
    let stable_cache_path = build_remote_cache_path(&ctx, source_url).unwrap();
    let stable_binding_path = remote_pdf_cache_binding_path(&ctx).unwrap();
    let expected_relative_path = format!(
        ".latotex/papers/.cache/remote-pdf/{}",
        stable_cache_path.file_name().unwrap().to_string_lossy()
    );

    assert_eq!(preview.cache_state, LIBRARY_PDF_CACHE_STATE_READY);
    assert_eq!(preview.source_url.as_deref(), Some(source_url));
    assert_eq!(preview.relative_path.as_deref(), Some(expected_relative_path.as_str()));
    assert!(stable_cache_path.exists());
    assert!(!legacy_cache_path.exists());
    assert!(stable_binding_path.exists());
    assert!(!legacy_binding_path.exists());

    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn runtime_preview_reuses_legacy_cache_without_binding_and_writes_stable_binding() {
    let (state, project_id, project_root, temp_root) = create_runtime_fixture("legacy-cache-only");
    let papers_root = crate::storage::library_root(&project_root);
    fs::create_dir_all(&papers_root).unwrap();

    let source_relative = "legacy-cache-only.bib";
    let source_url = "https://example.com/legacy-cache-only.pdf";
    write_library_source(&papers_root, source_relative);

    let ctx = prepare_library_pdf_preview_context(&state.db_path, &project_id, source_relative).unwrap();
    let legacy_cache_path = build_legacy_remote_cache_path(&ctx, source_url).unwrap();
    if let Some(parent) = legacy_cache_path.parent() {
        fs::create_dir_all(parent).unwrap();
    }
    fs::write(&legacy_cache_path, b"%PDF-1.7\nlegacy-only\n").unwrap();

    let summary = build_test_summary(source_relative, source_url);
    let preview = resolve_runtime_remote_preview(&state, &ctx, &project_id, &summary, false).unwrap();
    let stable_cache_path = build_remote_cache_path(&ctx, source_url).unwrap();
    let stable_binding_path = remote_pdf_cache_binding_path(&ctx).unwrap();

    assert_eq!(preview.cache_state, LIBRARY_PDF_CACHE_STATE_READY);
    assert_eq!(preview.source_url.as_deref(), Some(source_url));
    assert!(preview.cached);
    assert!(stable_cache_path.exists());
    assert!(!legacy_cache_path.exists());
    assert!(stable_binding_path.exists());

    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn cached_pdf_file_ready_accepts_valid_pdf_header() {
    let dir = temp_test_dir("valid-cache");
    let cache_path = dir.join("paper.pdf");
    fs::write(&cache_path, b"%PDF-1.7\n1 0 obj\n").unwrap();

    assert!(cached_pdf_file_ready(&cache_path));

    let _ = fs::remove_dir_all(dir);
}

#[test]
fn clear_pdf_cache_entry_removes_temp_download_and_task() {
    let dir = temp_test_dir("clear-cache-entry");
    let cache_path = dir.join("paper.pdf");
    let temp_path = temp_cache_path(&cache_path);
    fs::write(&temp_path, b"partial-download").unwrap();

    let task_key = "project-1::paper.bib".to_string();
    let mut tasks = HashMap::new();
    tasks.insert(
        task_key.clone(),
        crate::state::LibraryPdfCacheTask {
            status: Arc::new(Mutex::new("error".to_string())),
            error: Arc::new(Mutex::new(Some("HTTP 403".to_string()))),
            downloaded_bytes: Arc::new(std::sync::atomic::AtomicU64::new(12)),
            total_bytes: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            updated_at_unix_ms: Arc::new(std::sync::atomic::AtomicU64::new(0)),
        },
    );

    let tasks = Arc::new(Mutex::new(tasks));
    clear_pdf_cache_entry(&tasks, &task_key, &cache_path);

    assert!(!temp_path.exists());
    assert!(tasks.lock().unwrap().is_empty());

    let _ = fs::remove_dir_all(dir);
}
