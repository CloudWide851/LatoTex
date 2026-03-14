mod commands;
mod logging;
mod models;
mod secure;
mod single_instance;
mod state;
mod storage;

use commands::analysis::{
    analysis_export_artifact, analysis_list_reports, analysis_save_report, reference_check,
};
use commands::busytex::{analysis_pyodide_prepare, busytex_cache_prepare};
use commands::channels::{channels_telegram_poll, channels_telegram_send};
use commands::git::{
    git_branches, git_check_installed, git_checkout, git_commit, git_download_cancel,
    git_commit_files,
    git_diff_file, git_download_installer_start, git_download_status, git_fetch, git_init_repo,
    git_log, git_pull, git_push, git_run_installer, git_stage, git_status, git_unstage,
};
use commands::health::{health_check, tray_set_labels, window_sync_icon};
use commands::projects::{
    file_read, file_read_binary, file_write, file_write_binary, fs_operation, library_import_link, library_import_pdf,
    library_translate_document,
    library_zotero_sync,
    open_external_link,
    library_citation_summary, library_rescan, library_resolve_pdf_preview, library_tree, project_create,
    project_init_from_folder, project_integrity_repair, project_integrity_status, project_list, project_open, project_search_content,
    workspace_export_pdf, workspace_open_terminal, workspace_reveal_in_system, workspace_tree,
};
use commands::share::{share_session_create, share_session_status, share_session_stop};
use commands::settings::{
    model_api_key_get, model_api_key_save_verified, model_api_key_set, model_test, model_test_draft, protocol_test, runtime_log_clear_current_session,
    runtime_log_info, runtime_log_read, runtime_log_write, runtime_memory_snapshot, settings_get, settings_pick_background_image, settings_read_background_image, settings_remove_background_image, settings_update,
};
use commands::swarm::{agent_run, agent_run_cancel, agent_run_start, events_subscribe, latex_compile_record};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_MENU_SHOW_ID: &str = "tray_show_main";
const TRAY_MENU_EXIT_ID: &str = "tray_exit_app";
const TRAY_ID: &str = "latotex-tray";

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if !single_instance::acquire_or_focus_existing() {
        return;
    }
    tauri::Builder::default()
        .setup(|app| {
            let app_state = state::AppState::bootstrap(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
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
            tray_set_labels,
            project_list,
            project_create,
            project_init_from_folder,
            project_open,
            project_integrity_status,
            project_integrity_repair,
            project_search_content,
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
            workspace_export_pdf,
            library_tree,
            library_rescan,
            library_import_pdf,
            library_import_link,
            library_translate_document,
            library_zotero_sync,
            library_citation_summary,
            library_resolve_pdf_preview,
            share_session_create,
            share_session_status,
            share_session_stop,
            channels_telegram_poll,
            channels_telegram_send,
            fs_operation,
            latex_compile_record,
            agent_run,
            agent_run_start,
            agent_run_cancel,
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
            runtime_log_read,
            runtime_memory_snapshot,
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
            busytex_cache_prepare,
            analysis_pyodide_prepare
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

