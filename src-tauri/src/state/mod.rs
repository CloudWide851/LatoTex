use crate::logging;
use crate::storage;
use chrono::Utc;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::io::ErrorKind;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64};
use std::sync::{Arc, Condvar, Mutex};
use tauri::{AppHandle, Manager};

#[derive(Clone)]
pub struct GitDownloadTask {
    pub id: String,
    pub file_name: String,
    pub download_url: String,
    pub destination_path: PathBuf,
    pub downloaded_bytes: Arc<AtomicU64>,
    pub total_bytes: Arc<AtomicU64>,
    pub speed_bps: Arc<AtomicU64>,
    pub cancel_flag: Arc<AtomicBool>,
    pub status: Arc<Mutex<String>>,
    pub error: Arc<Mutex<Option<String>>>,
}

pub struct AppState {
    pub app_name: String,
    pub runtime_root: PathBuf,
    pub app_data_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub db_path: PathBuf,
    pub logs_dir: PathBuf,
    pub downloads_dir: PathBuf,
    pub session_log_path: PathBuf,
    pub install_mode: String,
    pub app_version: String,
    pub git_download_tasks: Arc<Mutex<HashMap<String, GitDownloadTask>>>,
    pub agent_slots: Arc<(Mutex<u32>, Condvar)>,
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
        let app_data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let runtime_root = resolve_runtime_root()?;
        migrate_legacy_data_if_needed(&app_data_dir, &runtime_root)?;

        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");
        let logs_dir = runtime_root.join("logs");
        let downloads_dir = runtime_root.join("downloads");

        fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&downloads_dir).map_err(|e| e.to_string())?;
        fs::create_dir_all(&logs_dir).map_err(|e| e.to_string())?;
        let session_log_path = logging::create_session_log(&logs_dir)?;
        storage::initialize_database(&db_path)?;
        logging::install_panic_hook(logs_dir.clone(), session_log_path.clone());

        let app_version = env!("CARGO_PKG_VERSION").to_string();
        let install_mode = detect_install_mode_and_persist(&runtime_root, &app_version)?;

        let state = Self {
            app_name: "LatoTex".to_string(),
            runtime_root,
            app_data_dir,
            projects_dir,
            db_path,
            logs_dir,
            downloads_dir,
            session_log_path,
            install_mode,
            app_version,
            git_download_tasks: Arc::new(Mutex::new(HashMap::new())),
            agent_slots: Arc::new((Mutex::new(0), Condvar::new())),
        };
        state.log("INFO", "application startup completed");
        Ok(state)
    }

    pub fn log(&self, level: &str, message: &str) {
        let _ = logging::append_log_line(&self.session_log_path, level, message);
    }
}

fn resolve_runtime_root() -> Result<PathBuf, String> {
    let exe_path = std::env::current_exe().map_err(|e| e.to_string())?;
    let exe_dir = exe_path
        .parent()
        .ok_or_else(|| "Unable to resolve executable directory".to_string())?;
    let runtime_root = exe_dir.join("runtime-data");
    fs::create_dir_all(&runtime_root).map_err(|e| {
        format!(
            "Failed to create runtime-data folder in install directory ({}): {}",
            runtime_root.to_string_lossy(),
            e
        )
    })?;
    Ok(runtime_root)
}

fn copy_recursively(source: &PathBuf, target: &PathBuf) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let from = item.path();
            let to = target.join(item.file_name());
            copy_recursively(&from, &to)?;
        }
        return Ok(());
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn migrate_legacy_data_if_needed(legacy_data_dir: &PathBuf, runtime_root: &PathBuf) -> Result<(), String> {
    if legacy_data_dir == runtime_root {
        return Ok(());
    }
    if !legacy_data_dir.exists() {
        return Ok(());
    }
    let marker = runtime_root.join(".migrated-from-appdata");
    if marker.exists() {
        return Ok(());
    }

    let candidates = vec![
        "latotex.db",
        "install-state.json",
        "projects",
        "downloads",
        "busytex-cache",
    ];

    for name in candidates {
        let source = legacy_data_dir.join(name);
        if !source.exists() {
            continue;
        }
        let target = runtime_root.join(name);
        if target.exists() {
            continue;
        }
        copy_recursively(&source, &target)?;
    }

    let marker_content = format!("migrated_at={}", Utc::now().to_rfc3339());
    match fs::write(marker, marker_content) {
        Ok(_) => Ok(()),
        Err(error) if error.kind() == ErrorKind::PermissionDenied => Ok(()),
        Err(error) => Err(error.to_string()),
    }
}

fn detect_install_mode_and_persist(runtime_root: &PathBuf, app_version: &str) -> Result<String, String> {
    let marker_path = runtime_root.join("install-state.json");
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
