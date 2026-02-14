use crate::models::{
    Ack, CreateProjectInput, FileReadInput, FileReadResponse, FileWriteInput, ProjectRefInput,
    ProjectSnapshot, ProjectSummary, ResourceNode,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use tauri::State;

#[tauri::command]
pub fn project_list(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
    state.log("INFO", "project_list");
    storage::list_projects(&state.db_path)
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
pub fn project_open(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<ProjectSnapshot, String> {
    state.log("INFO", &format!("project_open: {}", input.project_id));
    storage::project_snapshot(&state.db_path, &input.project_id)
}

#[tauri::command]
pub fn project_init_from_folder(state: State<'_, AppState>) -> Result<Option<ProjectSnapshot>, String> {
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
pub fn workspace_tree(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<Vec<ResourceNode>, String> {
    state.log("INFO", &format!("workspace_tree: {}", input.project_id));
    let snapshot = storage::project_snapshot(&state.db_path, &input.project_id)?;
    Ok(snapshot.tree)
}

#[tauri::command]
pub fn file_read(
    state: State<'_, AppState>,
    input: FileReadInput,
) -> Result<FileReadResponse, String> {
    state.log(
        "INFO",
        &format!("file_read: {} ({})", input.relative_path, input.project_id),
    );
    storage::read_project_file(&state.db_path, &input.project_id, &input.relative_path)
}

#[tauri::command]
pub fn file_write(state: State<'_, AppState>, input: FileWriteInput) -> Result<Ack, String> {
    state.log(
        "INFO",
        &format!("file_write: {} ({})", input.relative_path, input.project_id),
    );
    storage::write_project_file(&state.db_path, input)
}
