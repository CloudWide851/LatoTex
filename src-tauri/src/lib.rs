mod commands;
mod logging;
mod models;
mod secure;
mod state;
mod storage;

use commands::busytex::busytex_cache_prepare;
use commands::git::{
    git_branches, git_check_installed, git_checkout, git_commit, git_download_cancel,
    git_diff_file, git_download_installer_start, git_download_status, git_fetch, git_init_repo,
    git_log, git_pull, git_push, git_run_installer, git_stage, git_status, git_unstage,
};
use commands::health::health_check;
use commands::projects::{
    file_read, file_write, fs_operation, library_import_link, library_import_pdf, library_rescan,
    library_tree, project_create, project_init_from_folder, project_list, project_open,
    project_search_content, workspace_tree,
};
use commands::settings::{
    protocol_test, runtime_log_info, runtime_log_write, settings_get, settings_update,
};
use commands::swarm::{agent_run, events_subscribe, latex_compile_record};
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .setup(|app| {
            let app_state = state::AppState::bootstrap(app.handle())
                .map_err(|e| std::io::Error::new(std::io::ErrorKind::Other, e))?;
            app.manage(app_state);
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            project_list,
            project_create,
            project_init_from_folder,
            project_open,
            project_search_content,
            workspace_tree,
            file_read,
            file_write,
            library_tree,
            library_rescan,
            library_import_pdf,
            library_import_link,
            fs_operation,
            latex_compile_record,
            agent_run,
            events_subscribe,
            settings_get,
            settings_update,
            protocol_test,
            runtime_log_write,
            runtime_log_info,
            git_status,
            git_check_installed,
            git_init_repo,
            git_download_installer_start,
            git_download_status,
            git_download_cancel,
            git_run_installer,
            git_branches,
            git_log,
            git_stage,
            git_unstage,
            git_commit,
            git_checkout,
            git_diff_file,
            git_fetch,
            git_pull,
            git_push,
            busytex_cache_prepare
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
