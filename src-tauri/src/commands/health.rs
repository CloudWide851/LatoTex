use crate::models::{Ack, HealthCheckResponse};
use crate::state::AppState;
use tauri::{AppHandle, Manager, State};

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
