use super::*;
use std::collections::HashMap;
use std::fs;
use std::sync::{Arc, Condvar, Mutex};

fn temp_test_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "latotex-library-document-{}-{}",
        name,
        uuid::Uuid::new_v4()
    ));
    fs::create_dir_all(&dir).unwrap();
    dir
}

fn test_state(base: &Path) -> crate::state::AppState {
    crate::state::AppState {
        app_name: "LatoTex".to_string(),
        runtime_root: base.join("runtime"),
        app_data_dir: base.join("appdata"),
        projects_dir: base.join("projects"),
        db_path: base.join("latotex.db"),
        logs_dir: base.join("logs"),
        downloads_dir: base.join("downloads"),
        session_log_path: base.join("logs").join("session.log"),
        install_mode: "test".to_string(),
        app_version: "0.1.0".to_string(),
        git_download_tasks: Arc::new(Mutex::new(HashMap::new())),
        library_pdf_cache_tasks: Arc::new(Mutex::new(HashMap::new())),
        library_translate_tasks: Arc::new(Mutex::new(HashMap::new())),
        analysis_env_prepare_tasks: Arc::new(Mutex::new(HashMap::new())),
        latex_compile_tasks: Arc::new(Mutex::new(HashMap::new())),
        agent_slots: Arc::new((Mutex::new(0), Condvar::new())),
        agent_cancel_flags: Arc::new(Mutex::new(HashMap::new())),
    }
}

fn setup_project(name: &str) -> (PathBuf, crate::state::AppState, String, PathBuf) {
    let base = temp_test_dir(name);
    fs::create_dir_all(base.join("projects")).unwrap();
    fs::create_dir_all(base.join("logs")).unwrap();
    fs::create_dir_all(base.join("downloads")).unwrap();
    initialize_database(&base.join("latotex.db")).unwrap();
    let snapshot = create_project(&base.join("latotex.db"), &base.join("projects"), name).unwrap();
    let project_root = load_project_root(&base.join("latotex.db"), &snapshot.summary.id).unwrap();
    (base.clone(), test_state(&base), snapshot.summary.id, library_root(&project_root))
}

#[test]
fn library_open_document_reads_local_pdf_and_companion_bib() {
    let (base, state, project_id, papers_root) = setup_project("paper-pdf");
    fs::create_dir_all(&papers_root).unwrap();
    fs::write(papers_root.join("sample.pdf"), b"%PDF-1.7\nmock").unwrap();
    fs::write(
        papers_root.join("sample.bib"),
        "@article{sample,\n  title = {Sample Paper}\n}\n",
    )
    .unwrap();

    let result = library_open_document_runtime(&state, &project_id, "sample.pdf", false).unwrap();
    assert_eq!(result.pdf_preview.cache_state, "ready");
    assert!(result.bib_preview.contains("@article{sample"));
    assert_eq!(result.citation.title.as_deref(), Some("Sample Paper"));
    assert_eq!(
        result.pdf_preview.relative_path.as_deref(),
        Some(".latotex/papers/sample.pdf")
    );

    let _ = fs::remove_dir_all(base);
}

#[test]
fn library_open_document_returns_missing_pdf_for_bib_only_entry() {
    let (base, state, project_id, papers_root) = setup_project("paper-bib");
    fs::create_dir_all(&papers_root).unwrap();
    fs::write(
        papers_root.join("remote-only.bib"),
        "@misc{remoteonly,\n  url = {https://example.com/paper}\n}\n",
    )
    .unwrap();

    let result =
        library_open_document_runtime(&state, &project_id, "remote-only.bib", false).unwrap();
    assert_eq!(result.pdf_preview.cache_state, "missing");
    assert!(result.bib_preview.contains("https://example.com/paper"));
    assert!(result.pdf_preview.relative_path.is_none());

    let _ = fs::remove_dir_all(base);
}

#[test]
fn library_open_document_reuses_cached_remote_pdf_without_remote_lookup() {
    let (base, state, project_id, papers_root) = setup_project("paper-remote-cache");
    fs::create_dir_all(&papers_root).unwrap();
    fs::write(
        papers_root.join("remote-cached.bib"),
        "@misc{remotecached,\n  url = {https://example.com/paper}\n}\n",
    )
    .unwrap();

    let ctx =
        prepare_library_pdf_preview_context(&state.db_path, &project_id, "remote-cached.bib")
            .unwrap();
    let source_url = "https://example.com/files/remote-cached.pdf";
    let cache_path = build_remote_cache_path(&ctx, source_url).unwrap();
    fs::write(&cache_path, b"%PDF-1.7\ncached").unwrap();
    write_remote_cache_binding(&ctx, source_url, &cache_path).unwrap();

    let result =
        library_open_document_runtime(&state, &project_id, "remote-cached.bib", false).unwrap();
    assert_eq!(result.pdf_preview.cache_state, "ready");
    assert!(result.pdf_preview.cached);
    assert_eq!(result.pdf_preview.source_url.as_deref(), Some(source_url));
    let expected_relative =
        to_workspace_relative(&ctx.project_root, &cache_path).unwrap();
    assert_eq!(
        result.pdf_preview.relative_path.as_deref(),
        Some(expected_relative.as_str())
    );

    let _ = fs::remove_dir_all(base);
}
