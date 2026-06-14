use crate::models::{
    Ack, ProjectPathActionInput, ProjectSearchBatch, ProjectSearchHit,
    ProjectSearchIncrementalInput, ProjectSearchIndexPrepareInput, ProjectSearchInput,
};
use crate::state::AppState;
use crate::storage;
use latotex_workspace::resolve_workspace_target_path;
use std::process::Command;
use tauri::{async_runtime::spawn_blocking, State};

#[tauri::command]
pub async fn project_search_content(
    state: State<'_, AppState>,
    input: ProjectSearchInput,
) -> Result<Vec<ProjectSearchHit>, String> {
    state.log(
        "INFO",
        &format!(
            "project_search_content: project={}, query={}",
            input.project_id, input.query
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::search_project_content(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn project_search_content_incremental(
    state: State<'_, AppState>,
    input: ProjectSearchIncrementalInput,
) -> Result<ProjectSearchBatch, String> {
    state.log(
        "INFO",
        &format!(
            "project_search_content_incremental: project={}, query={}, cursor={}",
            input.project_id,
            input.query,
            input.cursor.as_deref().unwrap_or("")
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::search_project_content_incremental(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn project_prepare_search_index(
    state: State<'_, AppState>,
    input: ProjectSearchIndexPrepareInput,
) -> Result<Ack, String> {
    state.log(
        "INFO",
        &format!(
            "project_prepare_search_index: {}, mode={}",
            input.project_id,
            input.mode.as_deref().unwrap_or("full")
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let mode = input.mode.unwrap_or_else(|| "full".to_string());
    let focus_paths = input.focus_paths.unwrap_or_default();
    spawn_blocking(move || {
        if mode == "focused" && !focus_paths.is_empty() {
            storage::prepare_project_search_index_focused(&db_path, &project_id, &focus_paths)
        } else {
            storage::prepare_project_search_index(&db_path, &project_id)
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn workspace_reveal_in_system(
    state: State<'_, AppState>,
    input: ProjectPathActionInput,
) -> Result<Ack, String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let target = resolve_workspace_target_path(&project_root, input.relative_path.as_deref())?;
    state.log(
        "INFO",
        &format!(
            "workspace_reveal_in_system: project={}, path={}",
            input.project_id,
            target.to_string_lossy()
        ),
    );

    #[cfg(target_os = "windows")]
    {
        let mut command = Command::new("explorer");
        if target.is_file() {
            command.arg("/select,").arg(&target);
        } else {
            command.arg(&target);
        }
        command.spawn().map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        if target.is_file() {
            Command::new("open")
                .arg("-R")
                .arg(&target)
                .spawn()
                .map_err(|e| e.to_string())?;
        } else {
            Command::new("open")
                .arg(&target)
                .spawn()
                .map_err(|e| e.to_string())?;
        }
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let open_target = if target.is_file() {
            target.parent().unwrap_or(&target).to_path_buf()
        } else {
            target.clone()
        };
        Command::new("xdg-open")
            .arg(open_target)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(Ack {
        ok: true,
        message: "Opened in system file manager".to_string(),
    })
}
