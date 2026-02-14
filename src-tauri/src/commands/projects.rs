use crate::models::{
    Ack, CreateProjectInput, FileReadInput, FileReadResponse, FileWriteInput, ProjectRefInput,
    ProjectSnapshot, ProjectSummary, ResourceNode,
};
use crate::state::AppState;
use crate::storage;
use tauri::State;

#[tauri::command]
pub fn project_list(state: State<'_, AppState>) -> Result<Vec<ProjectSummary>, String> {
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
    storage::create_project(&state.db_path, &state.projects_dir, trimmed)
}

#[tauri::command]
pub fn project_open(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<ProjectSnapshot, String> {
    storage::project_snapshot(&state.db_path, &input.project_id)
}

#[tauri::command]
pub fn workspace_tree(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<Vec<ResourceNode>, String> {
    let snapshot = storage::project_snapshot(&state.db_path, &input.project_id)?;
    Ok(snapshot.tree)
}

#[tauri::command]
pub fn file_read(
    state: State<'_, AppState>,
    input: FileReadInput,
) -> Result<FileReadResponse, String> {
    storage::read_project_file(&state.db_path, &input.project_id, &input.relative_path)
}

#[tauri::command]
pub fn file_write(state: State<'_, AppState>, input: FileWriteInput) -> Result<Ack, String> {
    storage::write_project_file(&state.db_path, input)
}
