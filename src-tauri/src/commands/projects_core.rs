use crate::models::{
    CreateProjectInput, FileReadInput, FileReadResponse, ProjectIntegrityStatus, ProjectRefInput,
    ProjectSnapshot, ProjectSummary, ResourceNode,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use tauri::{async_runtime::spawn_blocking, State};

#[tauri::command]
pub async fn project_list(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    state.log("INFO", "project_list");
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::list_projects(&db_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn project_create(
    state: State<'_, AppState>,
    input: CreateProjectInput,
) -> Result<ProjectSnapshot, String> {
    let trimmed = input.name.trim();
    if trimmed.is_empty() {
        return Err("Project name cannot be empty".to_string());
    }
    state.log("INFO", &format!("project_create: {}", trimmed));
    storage::create_project(&state.db_path, &state.projects_dir, trimmed)
}

#[tauri::command]
pub async fn project_open(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<ProjectSnapshot, String> {
    state.log("INFO", &format!("project_open: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::project_snapshot(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn project_integrity_status(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<ProjectIntegrityStatus, String> {
    state.log(
        "INFO",
        &format!("project_integrity_status: {}", input.project_id),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::project_integrity_status(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn project_integrity_repair(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<ProjectIntegrityStatus, String> {
    state.log(
        "INFO",
        &format!("project_integrity_repair: {}", input.project_id),
    );
    storage::repair_project_integrity(&state.db_path, &input.project_id)
}

#[tauri::command]
pub fn project_init_from_folder(
    state: State<'_, AppState>,
) -> Result<Option<ProjectSnapshot>, String> {
    state.log("INFO", "project_init_from_folder");
    let selected = FileDialog::new().pick_folder();
    match selected {
        Some(path) => {
            let snapshot = storage::initialize_project_from_folder(&state.db_path, &path)?;
            Ok(Some(snapshot))
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn workspace_tree(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<Vec<ResourceNode>, String> {
    state.log("INFO", &format!("workspace_tree: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || {
        storage::project_snapshot(&db_path, &project_id).map(|snapshot| snapshot.tree)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn file_read(
    state: State<'_, AppState>,
    input: FileReadInput,
) -> Result<FileReadResponse, String> {
    state.log(
        "INFO",
        &format!("file_read: {} ({})", input.relative_path, input.project_id),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    spawn_blocking(move || storage::read_project_file(&db_path, &project_id, &relative_path))
        .await
        .map_err(|e| e.to_string())?
}
