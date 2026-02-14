use crate::logging;
use crate::storage;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct AppState {
    pub app_name: String,
    pub _data_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub db_path: PathBuf,
    pub logs_dir: PathBuf,
    pub session_log_path: PathBuf,
    pub install_mode: String,
    pub app_version: String,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstallState {
    version: String,
    installed_at: String,
    last_started_at: String,
    launch_count: u64,
}

impl AppState {
    pub fn bootstrap(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let projects_dir = data_dir.join("projects");
        let db_path = data_dir.join("latotex.db");
        let logs_dir = data_dir.join("logs");
        let session_log_path = logging::create_session_log(&logs_dir)?;

        fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
        storage::initialize_database(&db_path)?;
        logging::install_panic_hook(logs_dir.clone(), session_log_path.clone());

        let app_version = env!("CARGO_PKG_VERSION").to_string();
        let install_mode = detect_install_mode_and_persist(&data_dir, &app_version)?;

        let state = Self {
            app_name: "LatoTex".to_string(),
            _data_dir: data_dir,
            projects_dir,
            db_path,
            logs_dir,
            session_log_path,
            install_mode,
            app_version,
        };
        state.log("INFO", "application startup completed");
        Ok(state)
    }

    pub fn log(&self, level: &str, message: &str) {
        let _ = logging::append_log_line(&self.session_log_path, level, message);
    }
}

fn detect_install_mode_and_persist(data_dir: &PathBuf, app_version: &str) -> Result<String, String> {
    let marker_path = data_dir.join("install-state.json");
    let now = Utc::now().to_rfc3339();
    if !marker_path.exists() {
        let state = InstallState {
            version: app_version.to_string(),
            installed_at: now.clone(),
            last_started_at: now,
            launch_count: 1,
        };
        write_install_state(&marker_path, &state)?;
        return Ok("fresh-install".to_string());
    }

    let raw = fs::read_to_string(&marker_path).map_err(|e| e.to_string())?;
    let mut previous: InstallState = serde_json::from_str(&raw).map_err(|e| e.to_string())?;
    let mode = if previous.version != app_version {
        "updated-install"
    } else {
        "existing-install"
    }
    .to_string();

    if previous.version != app_version {
        previous.version = app_version.to_string();
    }
    previous.last_started_at = now;
    previous.launch_count = previous.launch_count.saturating_add(1);
    write_install_state(&marker_path, &previous)?;
    Ok(mode)
}

fn write_install_state(path: &PathBuf, state: &InstallState) -> Result<(), String> {
    let serialized = serde_json::to_string_pretty(state).map_err(|e| e.to_string())?;
    fs::write(path, serialized).map_err(|e| e.to_string())
}
