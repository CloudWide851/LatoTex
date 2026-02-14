use crate::models::HealthCheckResponse;
use crate::state::AppState;
use tauri::State;

#[tauri::command]
pub fn health_check(state: State<'_, AppState>) -> HealthCheckResponse {
    state.log("DEBUG", "health_check");
    HealthCheckResponse {
        app: state.app_name.clone(),
        version: env!("CARGO_PKG_VERSION").to_string(),
        timestamp: crate::storage::now_iso(),
    }
}
