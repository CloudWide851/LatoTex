use crate::models::{
    Ack, DrawExportAssetInput, DrawExportAssetResponse, FileReadBinaryResponse, FileReadInput,
    FileWriteBinaryInput, FileWriteInput, LibraryRefInput, ResourceNode, WorkspaceExportAssetInput,
    WorkspaceExportAssetResponse, WorkspaceExportPdfInput, WorkspaceExportPdfResponse,
};
use crate::state::AppState;
use crate::storage;
use latotex_workspace::{ensure_within_workspace_root, normalize_export_pdf_file_name};
use rfd::FileDialog;
use std::fs;
use tauri::{async_runtime::spawn_blocking, State};

fn normalize_export_asset_file_name(raw: &str) -> String {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return "diagram.png".to_string();
    }
    let file_name = trimmed
        .split(['\\', '/'])
        .next_back()
        .unwrap_or("diagram.png")
        .trim();
    let sanitized = file_name
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '.' | '_' | '-') {
                ch
            } else {
                '-'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        return "diagram.png".to_string();
    }
    sanitized
}

#[tauri::command]
pub async fn file_read_binary(
    state: State<'_, AppState>,
    input: FileReadInput,
) -> Result<FileReadBinaryResponse, String> {
    state.log(
        "INFO",
        &format!(
            "file_read_binary: {} ({})",
            input.relative_path, input.project_id
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    spawn_blocking(move || storage::read_project_file_binary(&db_path, &project_id, &relative_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn file_write(state: State<'_, AppState>, input: FileWriteInput) -> Result<Ack, String> {
    state.log(
        "INFO",
        &format!("file_write: {} ({})", input.relative_path, input.project_id),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::write_project_file(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn file_write_binary(
    state: State<'_, AppState>,
    input: FileWriteBinaryInput,
) -> Result<Ack, String> {
    state.log(
        "INFO",
        &format!(
            "file_write_binary: {} ({}), bytes={}",
            input.relative_path,
            input.project_id,
            input.bytes.len()
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || {
        storage::write_project_file_binary(
            &db_path,
            &input.project_id,
            &input.relative_path,
            &input.bytes,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn draw_export_asset(
    state: State<'_, AppState>,
    input: DrawExportAssetInput,
) -> Result<DrawExportAssetResponse, String> {
    state.log(
        "INFO",
        &format!(
            "draw_export_asset: {} ({}) bytes={}",
            input.relative_path,
            input.project_id,
            input.bytes.len()
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || {
        storage::save_draw_export_asset(
            &db_path,
            &input.project_id,
            &input.relative_path,
            &input.bytes,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn workspace_export_pdf(
    state: State<'_, AppState>,
    input: WorkspaceExportPdfInput,
) -> Result<Option<WorkspaceExportPdfResponse>, String> {
    if input.bytes.is_empty() {
        return Err("PDF bytes are empty".to_string());
    }
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let default_name = normalize_export_pdf_file_name(&input.default_file_name);

    let selected = FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .set_directory(&project_root)
        .set_file_name(&default_name)
        .save_file();

    let Some(mut save_path) = selected else {
        return Ok(None);
    };

    if save_path.extension().is_none() {
        save_path.set_extension("pdf");
    }
    ensure_within_workspace_root(&project_root, &save_path)?;
    fs::write(&save_path, &input.bytes).map_err(|e| e.to_string())?;

    let canonical_root = project_root.canonicalize().map_err(|e| e.to_string())?;
    let saved_relative = save_path
        .strip_prefix(&canonical_root)
        .map_err(|_| "Saved file is outside project root".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let file_name = save_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "document.pdf".to_string());

    state.log(
        "INFO",
        &format!(
            "workspace_export_pdf: project={}, path={}",
            input.project_id,
            save_path.to_string_lossy()
        ),
    );

    Ok(Some(WorkspaceExportPdfResponse {
        saved_path: saved_relative,
        file_name,
    }))
}

#[tauri::command]
pub fn workspace_export_asset(
    state: State<'_, AppState>,
    input: WorkspaceExportAssetInput,
) -> Result<Option<WorkspaceExportAssetResponse>, String> {
    if input.bytes.is_empty() {
        return Err("Export bytes are empty".to_string());
    }

    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let default_relative_dir = input.default_relative_dir.trim().replace('\\', "/");
    let default_file_name = normalize_export_asset_file_name(&input.default_file_name);
    let default_dir = if default_relative_dir.is_empty() {
        project_root.clone()
    } else {
        let target = project_root.join(&default_relative_dir);
        fs::create_dir_all(&target).map_err(|e| e.to_string())?;
        target
    };

    let selected = FileDialog::new()
        .set_directory(&default_dir)
        .set_file_name(&default_file_name)
        .save_file();

    let Some(mut save_path) = selected else {
        return Ok(None);
    };

    if save_path.extension().is_none() {
        let ext = std::path::Path::new(&default_file_name)
            .extension()
            .and_then(|value| value.to_str())
            .unwrap_or("png");
        save_path.set_extension(ext);
    }

    ensure_within_workspace_root(&project_root, &save_path)?;
    fs::write(&save_path, &input.bytes).map_err(|e| e.to_string())?;

    let metadata = fs::metadata(&save_path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Export verification failed".to_string());
    }

    let canonical_root = project_root.canonicalize().map_err(|e| e.to_string())?;
    let saved_relative = save_path
        .strip_prefix(&canonical_root)
        .map_err(|_| "Saved file is outside project root".to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let file_name = save_path
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| default_file_name.clone());

    state.log(
        "INFO",
        &format!(
            "workspace_export_asset: project={}, path={}",
            input.project_id,
            save_path.to_string_lossy()
        ),
    );

    Ok(Some(WorkspaceExportAssetResponse {
        saved_path: saved_relative,
        file_name,
    }))
}

#[tauri::command]
pub async fn library_tree(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Vec<ResourceNode>, String> {
    state.log("INFO", &format!("library_tree: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::list_library_tree(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[cfg(test)]
mod tests {
    use super::normalize_export_asset_file_name;

    #[test]
    fn normalizes_export_asset_file_names() {
        assert_eq!(normalize_export_asset_file_name(""), "diagram.png");
        assert_eq!(
            normalize_export_asset_file_name("diagram.svg"),
            "diagram.svg"
        );
        assert_eq!(
            normalize_export_asset_file_name("drawings/sub/diagram export?.png"),
            "diagram-export-.png"
        );
    }
}
