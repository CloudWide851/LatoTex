use crate::models::{Ack, HealthCheckResponse, TrayLabelsInput};
use crate::state::AppState;
use tauri::{menu::MenuBuilder, AppHandle, Manager, State};

const TRAY_MENU_SHOW_ID: &str = "tray_show_main";
const TRAY_MENU_EXIT_ID: &str = "tray_exit_app";
const TRAY_ID: &str = "latotex-tray";

#[tauri::command]
pub fn health_check(state: State<'_, AppState>) -> HealthCheckResponse {
    state.log("DEBUG", "health_check");
    HealthCheckResponse {
        app: state.app_name.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: crate::storage::now_iso(),
    }
}

#[tauri::command]
pub fn window_sync_icon(app: AppHandle, state: State<'_, AppState>) -> Result<Ack, String> {
    let icon = app
        .default_window_icon()
        .ok_or_else(|| "default window icon is unavailable".to_string())?;
    for (_, window) in app.webview_windows() {
        let _ = window.set_icon(icon.clone());
    }
    state.log("INFO", "window_sync_icon applied");
    Ok(Ack {
        ok: true,
        message: "window icons synced".to_string(),
    })
}

#[tauri::command]
pub fn tray_set_labels(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TrayLabelsInput,
) -> Result<Ack, String> {
    let tray = app
        .tray_by_id(TRAY_ID)
        .ok_or_else(|| "tray icon is unavailable".to_string())?;
    let menu = MenuBuilder::new(&app)
        .text(TRAY_MENU_SHOW_ID, input.show_label)
        .separator()
        .text(TRAY_MENU_EXIT_ID, input.exit_label)
        .build()
        .map_err(|e| e.to_string())?;
    tray.set_menu(Some(menu)).map_err(|e| e.to_string())?;
    tray.set_tooltip(Some(input.tooltip))
        .map_err(|e| e.to_string())?;
    state.log("INFO", "tray labels synced");
    Ok(Ack {
        ok: true,
        message: "tray labels synced".to_string(),
    })
}
