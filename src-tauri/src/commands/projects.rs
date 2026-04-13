use crate::models::{
    Ack, CreateProjectInput, DrawExportAssetInput, DrawExportAssetResponse,
    FileReadBinaryResponse, FileReadInput, FileReadResponse, FileWriteBinaryInput, FileWriteInput,
    FsOperationInput, FsOperationResult, LibraryCitationSummaryInput,
    LibraryCitationSummaryResponse, LibraryLinkImportInput, LibraryLinkImportResponse,
    LibraryPdfPreviewInput, LibraryPdfPreviewResponse, LibraryPdfResumeResponse, LibraryRefInput,
    LibraryZoteroSyncInput, LibraryZoteroSyncResponse, OpenExternalLinkInput,
    ProjectIntegrityStatus, ProjectPathActionInput, ProjectRefInput, ProjectSearchHit,
    ProjectSearchInput, ProjectSnapshot, ProjectSummary, ResourceNode, WorkspaceExportPdfInput,
    WorkspaceExportAssetInput, WorkspaceExportAssetResponse, WorkspaceExportPdfResponse,
};
use crate::state::AppState;
use crate::storage;
use latotex_workspace::{
    ensure_within_workspace_root, normalize_export_pdf_file_name, resolve_workspace_target_path,
    validate_external_http_url,
};
use rfd::FileDialog;
use std::fs;
use std::process::Command;
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
    spawn_blocking(move || storage::project_snapshot(&db_path, &project_id).map(|snapshot| snapshot.tree))
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

#[tauri::command]
pub async fn library_rescan(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Ack, String> {
    state.log("INFO", &format!("library_rescan: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::rescan_library(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_import_pdf(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Option<crate::models::LibraryPdfImportResponse>, String> {
    state.log("INFO", &format!("library_import_pdf: {}", input.project_id));
    let selected = FileDialog::new().add_filter("PDF", &["pdf"]).pick_file();
    match selected {
        Some(path) => {
            let db_path = state.db_path.clone();
            let project_id = input.project_id;
            spawn_blocking(move || storage::import_library_pdf(&db_path, &project_id, &path))
                .await
                .map_err(|e| e.to_string())?
                .map(Some)
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn library_import_link(
    state: State<'_, AppState>,
    input: LibraryLinkImportInput,
) -> Result<LibraryLinkImportResponse, String> {
    state.log(
        "INFO",
        &format!("library_import_link: {}", input.project_id),
    );
    let app_state = state.inner().clone();
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let queue_project_id = project_id.clone();
    let link = input.link.trim().to_string();
    let scope = input.scope.clone();
    let owner_id = input.owner_id.clone();
    let api_key = input.api_key.clone();
    let mut result =
        spawn_blocking(move || {
            storage::import_library_link(
                &db_path,
                &project_id,
                &link,
                scope.as_deref(),
                owner_id.as_deref(),
                api_key.as_deref(),
            )
        })
            .await
            .map_err(|e| e.to_string())??;
    result.pdf_preview =
        storage::queue_library_pdf_download(&app_state, &queue_project_id, &result.relative_path)?;
    Ok(result)
}

#[tauri::command]
pub async fn library_resume_pdf_downloads(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<LibraryPdfResumeResponse, String> {
    state.log(
        "INFO",
        &format!("library_resume_pdf_downloads: {}", input.project_id),
    );
    let project_id = input.project_id;
    let app_state = state.inner().clone();
    spawn_blocking(move || storage::resume_library_pdf_downloads(&app_state, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn library_zotero_sync(
    state: State<'_, AppState>,
    input: LibraryZoteroSyncInput,
) -> Result<LibraryZoteroSyncResponse, String> {
    let scope = input.scope.as_deref().unwrap_or("users").trim().to_string();
    state.log(
        "INFO",
        &format!(
            "library_zotero_sync: project={}, scope={}, owner={}",
            input.project_id, scope, input.owner_id
        ),
    );
    storage::sync_zotero_library(
        &state.db_path,
        &input.project_id,
        Some(&scope),
        input.owner_id.trim(),
        input.api_key.trim(),
    )
}

#[tauri::command]
pub fn library_citation_summary(
    state: State<'_, AppState>,
    input: LibraryCitationSummaryInput,
) -> Result<LibraryCitationSummaryResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_summary: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    storage::library_citation_summary(&state.db_path, &input.project_id, &input.relative_path)
}

#[tauri::command]
pub async fn library_citation_summary_remote(
    state: State<'_, AppState>,
    input: LibraryCitationSummaryInput,
) -> Result<LibraryCitationSummaryResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_summary_remote: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    spawn_blocking(move || storage::library_citation_summary_remote(&db_path, &project_id, &relative_path))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_resolve_pdf_preview(
    state: State<'_, AppState>,
    input: LibraryPdfPreviewInput,
) -> Result<LibraryPdfPreviewResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_resolve_pdf_preview: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    let app_state = state.inner().clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let bust_cache = input.bust_cache.unwrap_or(false);
    spawn_blocking(move || {
        storage::library_resolve_pdf_preview_runtime(
            &app_state,
            &project_id,
            &relative_path,
            bust_cache,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_operation(
    state: State<'_, AppState>,
    input: FsOperationInput,
) -> Result<FsOperationResult, String> {
    state.log(
        "INFO",
        &format!(
            "fs_operation: action={}, scope={}, path={}, project={}",
            input.action, input.scope, input.path, input.project_id
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::fs_operation(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}

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
pub async fn project_prepare_search_index(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<Ack, String> {
    state.log(
        "INFO",
        &format!("project_prepare_search_index: {}", input.project_id),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::prepare_project_search_index(&db_path, &project_id))
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

#[tauri::command]
pub fn workspace_open_terminal(
    state: State<'_, AppState>,
    input: ProjectPathActionInput,
) -> Result<Ack, String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let target = resolve_workspace_target_path(&project_root, input.relative_path.as_deref())?;
    let directory = if target.is_file() {
        target
            .parent()
            .ok_or_else(|| "Cannot resolve parent directory".to_string())?
            .to_path_buf()
    } else {
        target
    };

    state.log(
        "INFO",
        &format!(
            "workspace_open_terminal: project={}, dir={}",
            input.project_id,
            directory.to_string_lossy()
        ),
    );

    #[cfg(target_os = "windows")]
    {
        Command::new("cmd")
            .arg("/K")
            .arg(format!("cd /d \"{}\"", directory.to_string_lossy()))
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg("-a")
            .arg("Terminal")
            .arg(&directory)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        let directory_string = directory.to_string_lossy().to_string();
        let mut launched = false;
        if Command::new("x-terminal-emulator")
            .arg("--working-directory")
            .arg(&directory_string)
            .spawn()
            .is_ok()
        {
            launched = true;
        } else if Command::new("gnome-terminal")
            .arg("--working-directory")
            .arg(&directory_string)
            .spawn()
            .is_ok()
        {
            launched = true;
        } else if Command::new("konsole")
            .arg("--workdir")
            .arg(&directory_string)
            .spawn()
            .is_ok()
        {
            launched = true;
        }
        if !launched {
            return Err("No terminal application available".to_string());
        }
    }

    Ok(Ack {
        ok: true,
        message: "Terminal opened".to_string(),
    })
}

#[tauri::command]
pub fn open_external_link(
    state: State<'_, AppState>,
    input: OpenExternalLinkInput,
) -> Result<Ack, String> {
    let trimmed = validate_external_http_url(&input.url)?;

    state.log("INFO", &format!("open_external_link: {}", trimmed));

    #[cfg(target_os = "windows")]
    {
        Command::new("rundll32")
            .arg("url.dll,FileProtocolHandler")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(target_os = "macos")]
    {
        Command::new("open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    #[cfg(all(unix, not(target_os = "macos")))]
    {
        Command::new("xdg-open")
            .arg(trimmed)
            .spawn()
            .map_err(|e| e.to_string())?;
    }

    Ok(Ack {
        ok: true,
        message: "External link opened".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::normalize_export_asset_file_name;

    #[test]
    fn normalizes_export_asset_file_names() {
        assert_eq!(normalize_export_asset_file_name(""), "diagram.png");
        assert_eq!(normalize_export_asset_file_name("diagram.svg"), "diagram.svg");
        assert_eq!(
            normalize_export_asset_file_name("drawings/sub/diagram export?.png"),
            "diagram-export-.png"
        );
    }
}
