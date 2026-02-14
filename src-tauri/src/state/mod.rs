use crate::storage;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};

pub struct AppState {
    pub app_name: String,
    pub _data_dir: PathBuf,
    pub projects_dir: PathBuf,
    pub db_path: PathBuf,
}

impl AppState {
    pub fn bootstrap(app: &AppHandle) -> Result<Self, String> {
        let data_dir = app.path().app_data_dir().map_err(|e| e.to_string())?;
        let projects_dir = data_dir.join("projects");
        let db_path = data_dir.join("latotex.db");

        fs::create_dir_all(&projects_dir).map_err(|e| e.to_string())?;
        storage::initialize_database(&db_path)?;

        Ok(Self {
            app_name: "LatoTex".to_string(),
            _data_dir: data_dir,
            projects_dir,
            db_path,
        })
    }
}
