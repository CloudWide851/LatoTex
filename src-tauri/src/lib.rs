mod commands;
mod logging;
mod models;
mod secure;
mod single_instance;
mod smoke;
mod state;
mod storage;

use commands::agent_workflows::{
    chat_workflow_start, completion_latex_start, git_summary_workflow_start, latex_edit_start,
    latex_paper_analyze_start, latex_reference_check_start, latex_review_fix_start,
};
use commands::analysis::{
    analysis_export_artifact, analysis_list_reports, analysis_save_report, reference_check,
};
use commands::channels::{channels_telegram_poll, channels_telegram_send, channels_telegram_test};
use commands::channels_dingtalk::{
    channels_dingtalk_poll, channels_dingtalk_send, channels_dingtalk_test,
};
use commands::git::{
    git_branches, git_check_installed, git_checkout, git_commit, git_commit_files, git_diff_file,
    git_download_cancel, git_download_installer_start, git_download_status, git_fetch,
    git_init_repo, git_log, git_pull, git_push, git_run_installer, git_stage, git_status,
    git_unstage,
};
use commands::health::{
    app_exit, app_smoke_config, app_smoke_finish, app_smoke_progress, health_check, tray_set_labels,
    window_sync_icon,
};
use commands::docx::{docx_read, docx_write};
use commands::local_resources::{handle_local_resource_request, LOCAL_RESOURCE_SCHEME};
use commands::native_runtime::{
    analysis_env_pick_directory, analysis_env_prepare, analysis_env_prepare_start,
    analysis_env_prepare_status, analysis_env_status, analysis_run_python, latex_compile_native,
    latex_compile_start, latex_compile_status,
};
use commands::projects::{
    draw_export_asset, file_read, file_read_binary, file_write, file_write_binary, fs_operation,
    library_citation_index_rebuild, library_citation_index_status, library_citation_resolve,
    library_citation_summary, library_citation_summary_remote, library_import_link,
    library_import_pdf, library_rescan, library_resolve_pdf_preview, library_resume_pdf_downloads,
    library_tree, library_zotero_sync, open_external_link, project_create,
    project_init_from_folder, project_integrity_repair, project_integrity_status, project_list,
    project_open, project_prepare_search_index, project_search_content,
    project_search_content_incremental, workspace_export_asset, workspace_export_pdf,
    workspace_open_terminal, workspace_reveal_in_system, workspace_tree,
};
use commands::projects_translation::{
    library_extract_paper_context, library_translate_document, library_translate_start,
    library_translate_status,
};
use commands::plugins::{
    plugin_install, plugin_installed_list, plugin_marketplace_catalog, plugin_set_enabled,
    plugin_uninstall, plugin_validate_manifest,
};
use commands::settings::{
    model_api_key_get, model_api_key_save_verified, model_api_key_set, model_test,
    model_test_draft, protocol_test, runtime_diagnostics_bundle_export,
    runtime_log_clear_current_session, runtime_log_info, runtime_log_list_sessions,
    runtime_log_read, runtime_log_write, runtime_memory_snapshot, runtime_system_font_probe,
    settings_get, settings_pick_background_image, settings_read_background_image,
    settings_remove_background_image, settings_update,
};
use commands::share::{share_session_create, share_session_status, share_session_stop};
use commands::swarm::{
    agent_execute_cancel, agent_execute_start, agent_mcp_validate, agent_runs_recover,
    agent_skill_validate, events_subscribe, latex_compile_record,
};
use commands::terminal::{
    terminal_read, terminal_resize, terminal_start, terminal_stop, terminal_write,
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    webview::PageLoadEvent,
    AppHandle, Manager, WebviewUrl, WebviewWindowBuilder,
};

const TRAY_MENU_SHOW_ID: &str = "tray_show_main";
const TRAY_MENU_EXIT_ID: &str = "tray_exit_app";
const TRAY_ID: &str = "latotex-tray";

fn run_native_smoke_fallback_if_requested() -> bool {
    let smoke_mode = smoke::enabled();
    let native_fallback =
        std::env::var("LATOTEX_SMOKE_NATIVE_FALLBACK").ok().as_deref() == Some("1")
            || smoke::arg_flag("--latotex-smoke-native-fallback");
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
    let report_path =
        smoke::report_path(None).ok_or_else(|| "LATOTEX_SMOKE_REPORT_PATH is required".to_string())?;
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
    let runtime_root =
        smoke::runtime_root().ok_or_else(|| "LATOTEX_E2E_RUNTIME_ROOT is required".to_string())?;
    let projects_dir = runtime_root.join("projects");
    let db_path = runtime_root.join("latotex.db");
    std::fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
    storage::initialize_database(&db_path)?;
    let mut steps = Vec::<serde_json::Value>::new();
    let snapshot = storage::create_project(&db_path, &projects_dir, "Smoke Project Native")?;
    let project_id = snapshot.summary.id;
    steps.push(serde_json::json!({"name":"native.project.create","ok":true,"detail":project_id}));
    storage::write_project_file(
        &db_path,
        crate::models::FileWriteInput {
            project_id: project_id.clone(),
            relative_path: "main.tex".to_string(),
            content: "\\documentclass{article}\n\\begin{document}\nSmoke path\n\\end{document}\n"
                .to_string(),
        },
    )?;
    steps.push(serde_json::json!({"name":"native.file.write","ok":true}));
    let file = storage::read_project_file(&db_path, &project_id, "main.tex")?;
    let file_read_ok = file.content.contains("Smoke path");
    steps.push(serde_json::json!({
        "name":"native.file.read",
        "ok": file_read_ok,
        "detail": file.relative_path
    }));
    if !file_read_ok {
        return Err("native smoke file read verification failed".to_string());
    }
    let tree = storage::list_workspace_tree(std::path::Path::new(&snapshot.summary.root_path))?;
    let tree_ok = tree.iter().any(|node| node.relative_path == "main.tex");
    steps.push(serde_json::json!({
        "name":"native.workspace.tree",
        "ok": tree_ok
    }));
    if !tree_ok {
        return Err("native smoke workspace tree verification failed".to_string());
    }
    let integrity = storage::project_integrity_status(&db_path, &project_id)?;
    let integrity_ok = integrity.missing_required.is_empty();
    steps.push(serde_json::json!({
        "name":"native.project.integrity",
        "ok": integrity_ok,
        "detail": integrity.missing_required.len()
    }));
    if !integrity_ok {
        return Err("native smoke project integrity verification failed".to_string());
    }
    storage::prepare_project_search_index(&db_path, &project_id)?;
    let hits = storage::search_project_content(
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

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

fn create_smoke_main_window(app: &AppHandle) {
    smoke::write_progress("window.create.start", "ok", None);
    match WebviewWindowBuilder::new(app, "main", WebviewUrl::App("index.html".into()))
        .title("LatoTex")
        .inner_size(1200.0, 760.0)
        .resizable(true)
        .decorations(false)
        .visible(true)
        .on_navigation(|url| {
            smoke::write_progress(
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
            smoke::write_progress(
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
            smoke::write_progress("window.ready", "ok", None);
        }
        Err(error) => smoke::write_progress(
            "window.create.error",
            "error",
            Some(serde_json::json!({ "message": error.to_string() })),
        ),
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    smoke::write_boot_marker();
    if run_native_smoke_fallback_if_requested() {
        return;
    }
    let smoke_mode = smoke::enabled();
    if !smoke_mode && !single_instance::acquire_or_focus_existing() {
        return;
    }
    let mut context = tauri::generate_context!();
    if smoke_mode {
        context.config_mut().app.windows.clear();
    }
    smoke::write_progress("tauri.builder.start", "ok", None);
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            LOCAL_RESOURCE_SCHEME,
            |ctx, request, responder| {
                let response = if let Some(state) = ctx.app_handle().try_state::<state::AppState>()
                {
                    handle_local_resource_request(&state, &request)
                } else {
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .header(
                            tauri::http::header::CONTENT_TYPE,
                            "text/plain; charset=utf-8",
                        )
                        .body(b"resource.state.unavailable".to_vec())
                        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
                };
                responder.respond(response);
            },
        )
        .setup(move |app| {
            smoke::write_progress("tauri.setup.start", "ok", None);
            let app_state = state::AppState::bootstrap(app.handle())
                .map_err(|e| {
                    smoke::write_progress(
                        "tauri.setup.error",
                        "error",
                        Some(serde_json::json!({ "message": e })),
                    );
                    std::io::Error::new(std::io::ErrorKind::Other, e)
                })?;
            app.manage(app_state);
            let tray_menu = MenuBuilder::new(app)
                .text(TRAY_MENU_SHOW_ID, "Show LatoTex")
                .separator()
                .text(TRAY_MENU_EXIT_ID, "Exit")
                .build()?;
            let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&tray_menu)
                .tooltip("LatoTex")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _ = tray_builder.build(app)?;
            smoke::write_progress("tauri.setup.done", "ok", None);
            if smoke_mode {
                let app_handle = app.handle().clone();
                std::thread::spawn(move || {
                    std::thread::sleep(std::time::Duration::from_millis(1000));
                    create_smoke_main_window(&app_handle);
                });
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => show_main_window(app),
            TRAY_MENU_EXIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|app, event| {
            if event.id().as_ref() != TRAY_ID {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            window_sync_icon,
            app_exit,
            app_smoke_config,
            app_smoke_finish,
            app_smoke_progress,
            tray_set_labels,
            project_list,
            project_create,
            project_init_from_folder,
            project_open,
            project_integrity_status,
            project_integrity_repair,
            project_search_content,
            project_search_content_incremental,
            project_prepare_search_index,
            reference_check,
            analysis_save_report,
            analysis_list_reports,
            analysis_export_artifact,
            workspace_reveal_in_system,
            workspace_open_terminal,
            open_external_link,
            workspace_tree,
            file_read,
            file_read_binary,
            file_write,
            file_write_binary,
            docx_read,
            docx_write,
            draw_export_asset,
            workspace_export_asset,
            workspace_export_pdf,
            library_tree,
            library_rescan,
            library_import_pdf,
            library_import_link,
            library_resume_pdf_downloads,
            library_translate_document,
            library_extract_paper_context,
            library_translate_start,
            library_translate_status,
            library_zotero_sync,
            library_citation_resolve,
            library_citation_index_status,
            library_citation_index_rebuild,
            library_citation_summary,
            library_citation_summary_remote,
            library_resolve_pdf_preview,
            share_session_create,
            share_session_status,
            share_session_stop,
            channels_telegram_poll,
            channels_telegram_send,
            channels_telegram_test,
            channels_dingtalk_poll,
            channels_dingtalk_send,
            channels_dingtalk_test,
            fs_operation,
            latex_compile_record,
            agent_execute_start,
            agent_execute_cancel,
            agent_runs_recover,
            agent_mcp_validate,
            agent_skill_validate,
            latex_edit_start,
            latex_review_fix_start,
            latex_reference_check_start,
            latex_paper_analyze_start,
            chat_workflow_start,
            completion_latex_start,
            git_summary_workflow_start,
            events_subscribe,
            settings_get,
            settings_update,
            settings_pick_background_image,
            settings_read_background_image,
            settings_remove_background_image,
            protocol_test,
            model_test,
            model_test_draft,
            model_api_key_set,
            model_api_key_get,
            model_api_key_save_verified,
            runtime_log_write,
            runtime_log_info,
            runtime_log_list_sessions,
            runtime_log_read,
            runtime_diagnostics_bundle_export,
            runtime_memory_snapshot,
            runtime_system_font_probe,
            runtime_log_clear_current_session,
            git_status,
            git_check_installed,
            git_init_repo,
            git_download_installer_start,
            git_download_status,
            git_download_cancel,
            git_run_installer,
            git_branches,
            git_log,
            git_commit_files,
            git_stage,
            git_unstage,
            git_commit,
            git_checkout,
            git_diff_file,
            git_fetch,
            git_pull,
            git_push,
            latex_compile_native,
            latex_compile_start,
            latex_compile_status,
            analysis_env_pick_directory,
            analysis_env_prepare,
            analysis_env_prepare_start,
            analysis_env_prepare_status,
            analysis_env_status,
            analysis_run_python,
            terminal_start,
            terminal_write,
            terminal_read,
            terminal_resize,
            terminal_stop,
            plugin_marketplace_catalog,
            plugin_installed_list,
            plugin_install,
            plugin_uninstall,
            plugin_set_enabled,
            plugin_validate_manifest,
        ])
        .run(context)
        .expect("error while running tauri application");
}
