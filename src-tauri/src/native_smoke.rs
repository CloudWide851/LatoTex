use tauri::{webview::PageLoadEvent, AppHandle, Manager, WebviewUrl, WebviewWindowBuilder};

pub(crate) fn run_native_smoke_fallback_if_requested() -> bool {
    let smoke_mode = crate::smoke::enabled();
    let native_fallback = std::env::var("LATOTEX_SMOKE_NATIVE_FALLBACK")
        .ok()
        .as_deref()
        == Some("1")
        || crate::smoke::arg_flag("--latotex-smoke-native-fallback");
    if !smoke_mode || !native_fallback {
        return false;
    }
    let result = run_native_smoke_fallback();
    if let Err(error) = result {
        let _ = write_native_smoke_report(false, vec![], Some(error));
    }
    true
}

fn write_native_smoke_report(
    ok: bool,
    steps: Vec<serde_json::Value>,
    error: Option<String>,
) -> Result<(), String> {
    let report_path = crate::smoke::report_path(None)
        .ok_or_else(|| "LATOTEX_SMOKE_REPORT_PATH is required".to_string())?;
    if let Some(parent) = report_path.parent() {
        std::fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let report = serde_json::json!({
        "schema": "latotex.tauri-smoke.v1",
        "ok": ok,
        "status": if ok { "passed" } else { "failed" },
        "mode": "native-fallback",
        "steps": steps,
        "error": error,
        "version": env!("CARGO_PKG_VERSION"),
        "timestamp": crate::storage::now_iso(),
    });
    std::fs::write(
        report_path,
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())
}

fn run_native_smoke_fallback() -> Result<(), String> {
    let runtime_root = crate::smoke::runtime_root()
        .ok_or_else(|| "LATOTEX_E2E_RUNTIME_ROOT is required".to_string())?;
    let projects_dir = runtime_root.join("projects");
    let db_path = runtime_root.join("latotex.db");
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
    crate::storage::initialize_database(&db_path)?;
    let mut steps = Vec::<serde_json::Value>::new();
    let snapshot = crate::storage::create_project(&db_path, &projects_dir, "Smoke Project Native")?;
    let project_id = snapshot.summary.id;
    steps.push(serde_json::json!({"name":"native.project.create","ok":true,"detail":project_id}));
    crate::storage::write_project_file(
        &db_path,
        crate::models::FileWriteInput {
            project_id: project_id.clone(),
            relative_path: "main.tex".to_string(),
            content: "\\documentclass{article}\n\\begin{document}\nSmoke path\n\\end{document}\n"
                .to_string(),
            knowledge_approval_token: None,
        },
    )?;
    steps.push(serde_json::json!({"name":"native.file.write","ok":true}));
    let file = crate::storage::read_project_file(&db_path, &project_id, "main.tex")?;
    let file_read_ok = file.content.contains("Smoke path");
    steps.push(serde_json::json!({
        "name":"native.file.read",
        "ok": file_read_ok,
        "detail": file.relative_path
    }));
    if !file_read_ok {
        return Err("native smoke file read verification failed".to_string());
    }
    let tree =
        crate::storage::list_workspace_tree(std::path::Path::new(&snapshot.summary.root_path))?;
    let tree_ok = tree.iter().any(|node| node.relative_path == "main.tex");
    steps.push(serde_json::json!({
        "name":"native.workspace.tree",
        "ok": tree_ok
    }));
    if !tree_ok {
        return Err("native smoke workspace tree verification failed".to_string());
    }
    let integrity = crate::storage::project_integrity_status(&db_path, &project_id)?;
    let integrity_ok = integrity.missing_required.is_empty();
    steps.push(serde_json::json!({
        "name":"native.project.integrity",
        "ok": integrity_ok,
        "detail": integrity.missing_required.len()
    }));
    if !integrity_ok {
        return Err("native smoke project integrity verification failed".to_string());
    }
    crate::storage::prepare_project_search_index(&db_path, &project_id)?;
    let hits = crate::storage::search_project_content(
        &db_path,
        crate::models::ProjectSearchInput {
            project_id,
            query: "Smoke".to_string(),
            limit: Some(5),
            scopes: Some(vec!["file_content".to_string()]),
        },
    )?;
    let search_ok = !hits.is_empty();
    steps.push(serde_json::json!({
        "name":"native.project.search",
        "ok": search_ok,
        "detail": hits.len()
    }));
    if !search_ok {
        return Err("native smoke search verification failed".to_string());
    }
    write_native_smoke_report(true, steps, None)
}

pub(crate) fn create_smoke_main_window(app: &AppHandle) {
    crate::smoke::write_progress("window.create.start", "ok", None);
    let Some(state) = app.try_state::<crate::state::AppState>() else {
        crate::smoke::write_progress("window.data_directory.error", "error", None);
        return;
    };
    let data_directory = crate::smoke::webview_data_path(&state.runtime_root);
    drop(state);
    if let Err(error) = std::fs::create_dir_all(&data_directory) {
        crate::smoke::write_progress(
            "window.data_directory.error",
            "error",
            Some(serde_json::json!({ "message": error.to_string() })),
        );
        return;
    }
    let entry = crate::smoke::scenario()
        .filter(|scenario| {
            scenario
                .chars()
                .all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_'))
        })
        .map(|scenario| format!("index.html?latotexSmokeScenario={scenario}"))
        .unwrap_or_else(|| "index.html".to_string());
    match WebviewWindowBuilder::new(app, "main", WebviewUrl::App(entry.into()))
        .title("LatoTex")
        .data_directory(data_directory)
        .inner_size(1200.0, 760.0)
        .resizable(true)
        .decorations(false)
        .visible(true)
        .on_navigation(|url| {
            crate::smoke::write_progress(
                "window.navigation",
                "ok",
                Some(serde_json::json!({ "url": url.to_string() })),
            );
            true
        })
        .on_page_load(|_, payload| {
            let event = match payload.event() {
                PageLoadEvent::Started => "started",
                PageLoadEvent::Finished => "finished",
            };
            crate::smoke::write_progress(
                "window.page_load",
                event,
                Some(serde_json::json!({ "url": payload.url().to_string() })),
            );
        })
        .build()
    {
        Ok(window) => {
            let _ = window.show();
            let _ = window.unminimize();
            let _ = window.set_focus();
            crate::smoke::write_progress("window.ready", "ok", None);
        }
        Err(error) => crate::smoke::write_progress(
            "window.create.error",
            "error",
            Some(serde_json::json!({ "message": error.to_string() })),
        ),
    }
}
