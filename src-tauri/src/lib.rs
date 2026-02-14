mod commands;
mod models;
mod secure;
mod state;
mod storage;

use commands::health::health_check;
use commands::projects::{
    file_read, file_write, project_create, project_list, project_open, workspace_tree,
};
use commands::settings::{provider_test, settings_get, settings_update};
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
            project_open,
            workspace_tree,
            file_read,
            file_write,
            latex_compile_record,
            agent_run,
            events_subscribe,
            settings_get,
            settings_update,
            provider_test
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
