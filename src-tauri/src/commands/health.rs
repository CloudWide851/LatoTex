use crate::models::{Ack, HealthCheckResponse, TauriSmokeConfig, TauriSmokeFinishInput, TrayLabelsInput};
use crate::state::AppState;
use serde_json::json;
use std::fs;
use std::path::PathBuf;
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
pub fn app_exit(app: AppHandle, state: State<'_, AppState>) -> Result<Ack, String> {
    state.log("INFO", "app_exit requested");
    app.exit(0);
    Ok(Ack {
        ok: true,
        message: "application exit requested".to_string(),
    })
}

fn smoke_enabled() -> bool {
    std::env::var("LATOTEX_SMOKE").ok().as_deref() == Some("1")
}

fn smoke_report_path(state: &AppState) -> PathBuf {
    std::env::var("LATOTEX_SMOKE_REPORT_PATH")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| state.runtime_root.join("tauri-smoke-report.json"))
}

#[tauri::command]
pub fn app_smoke_config(state: State<'_, AppState>) -> TauriSmokeConfig {
    let enabled = smoke_enabled();
    TauriSmokeConfig {
        enabled,
        report_path: enabled.then(|| smoke_report_path(&state).to_string_lossy().to_string()),
    }
}

#[tauri::command]
pub fn app_smoke_finish(
    app: AppHandle,
    state: State<'_, AppState>,
    input: TauriSmokeFinishInput,
) -> Result<Ack, String> {
    if !smoke_enabled() {
        return Err("tauri_smoke.disabled".to_string());
    }
    let report_path = smoke_report_path(&state);
    if let Some(parent) = report_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let report = json!({
        "ok": input.ok,
        "status": input.status,
        "steps": input.steps,
        "error": input.error,
        "version": state.app_version,
        "timestamp": crate::storage::now_iso(),
    });
    fs::write(
        &report_path,
        serde_json::to_string_pretty(&report).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    state.log(
        if input.ok { "INFO" } else { "ERROR" },
        &format!(
            "tauri_smoke.finish: ok={} report={}",
            input.ok,
            report_path.to_string_lossy()
        ),
    );
    app.exit(if input.ok { 0 } else { 1 });
    Ok(Ack {
        ok: true,
        message: "tauri smoke report written".to_string(),
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
