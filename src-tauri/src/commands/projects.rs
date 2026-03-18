use crate::models::{
    Ack, CreateProjectInput, FileReadBinaryResponse, FileReadInput, FileReadResponse, FileWriteBinaryInput,
    FileWriteInput,
    FsOperationInput, FsOperationResult, LibraryLinkImportInput, LibraryRefInput, LibraryZoteroSyncInput, LibraryZoteroSyncResponse,
    LibraryCitationSummaryInput, LibraryCitationSummaryResponse, LibraryPdfPreviewInput, LibraryPdfPreviewResponse,
    OpenExternalLinkInput, ProjectPathActionInput,
    ProjectIntegrityStatus, ProjectRefInput, ProjectSearchHit, ProjectSearchInput, ProjectSnapshot, ProjectSummary,
    ResourceNode, WorkspaceExportPdfInput, WorkspaceExportPdfResponse,
};
use crate::state::AppState;
use crate::storage;
use reqwest::Url;
use rfd::FileDialog;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
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
pub fn project_integrity_status(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<ProjectIntegrityStatus, String> {
    state.log(
        "INFO",
        &format!("project_integrity_status: {}", input.project_id),
    );
    storage::project_integrity_status(&state.db_path, &input.project_id)
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
pub fn file_read_binary(
    state: State<'_, AppState>,
    input: FileReadInput,
) -> Result<FileReadBinaryResponse, String> {
    state.log(
        "INFO",
        &format!("file_read_binary: {} ({})", input.relative_path, input.project_id),
    );
    storage::read_project_file_binary(&state.db_path, &input.project_id, &input.relative_path)
}

#[tauri::command]
pub fn file_write(state: State<'_, AppState>, input: FileWriteInput) -> Result<Ack, String> {
    state.log(
        "INFO",
        &format!("file_write: {} ({})", input.relative_path, input.project_id),
    );
    storage::write_project_file(&state.db_path, input)
}

#[tauri::command]
pub fn file_write_binary(
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
    storage::write_project_file_binary(
        &state.db_path,
        &input.project_id,
        &input.relative_path,
        &input.bytes,
    )
}

fn ensure_within_project_root(root: &PathBuf, candidate: &PathBuf) -> Result<(), String> {
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let parent = candidate
        .parent()
        .ok_or_else(|| "Cannot resolve save directory".to_string())?;
    let canonical_parent = parent.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_parent.starts_with(&canonical_root) {
        return Err("Export path must stay inside project workspace".to_string());
    }
    Ok(())
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
    let default_name_raw = input.default_file_name.trim();
    let default_name = if default_name_raw.is_empty() {
        "document.pdf".to_string()
    } else if default_name_raw.to_lowercase().ends_with(".pdf") {
        default_name_raw.to_string()
    } else {
        format!("{default_name_raw}.pdf")
    };

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
    ensure_within_project_root(&project_root, &save_path)?;
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
pub fn library_tree(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Vec<ResourceNode>, String> {
    state.log("INFO", &format!("library_tree: {}", input.project_id));
    storage::list_library_tree(&state.db_path, &input.project_id)
}

#[tauri::command]
pub fn library_rescan(state: State<'_, AppState>, input: LibraryRefInput) -> Result<Ack, String> {
    state.log("INFO", &format!("library_rescan: {}", input.project_id));
    storage::rescan_library(&state.db_path, &input.project_id)
}

#[tauri::command]
pub fn library_import_pdf(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Option<Ack>, String> {
    state.log("INFO", &format!("library_import_pdf: {}", input.project_id));
    let selected = FileDialog::new()
        .add_filter("PDF", &["pdf"])
        .pick_file();
    match selected {
        Some(path) => storage::import_library_pdf(&state.db_path, &input.project_id, &path).map(Some),
        None => Ok(None),
    }
}

#[tauri::command]
pub fn library_import_link(
    state: State<'_, AppState>,
    input: LibraryLinkImportInput,
) -> Result<Ack, String> {
    state.log("INFO", &format!("library_import_link: {}", input.project_id));
    storage::import_library_link(&state.db_path, &input.project_id, input.link.trim())
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
pub fn library_resolve_pdf_preview(
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
    storage::library_resolve_pdf_preview(&state.db_path, &input.project_id, &input.relative_path)
}

#[tauri::command]
pub fn fs_operation(
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
    storage::fs_operation(&state.db_path, input)
}

#[tauri::command]
pub fn project_search_content(
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
    storage::search_project_content(&state.db_path, input)
}

fn resolve_workspace_path(
    state: &State<'_, AppState>,
    input: &ProjectPathActionInput,
) -> Result<std::path::PathBuf, String> {
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;
    let relative = input
        .relative_path
        .as_deref()
        .unwrap_or_default()
        .trim()
        .replace('\\', "/");
    if relative.is_empty() {
        return Ok(canonical_root);
    }
    let candidate = canonical_root.join(relative);
    if !candidate.exists() {
        return Err("Path does not exist".to_string());
    }
    let canonical_target = candidate.canonicalize().map_err(|e| e.to_string())?;
    if !canonical_target.starts_with(&canonical_root) {
        return Err("Path traversal detected".to_string());
    }
    Ok(canonical_target)
}

#[tauri::command]
pub fn workspace_reveal_in_system(
    state: State<'_, AppState>,
    input: ProjectPathActionInput,
) -> Result<Ack, String> {
    let target = resolve_workspace_path(&state, &input)?;
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
    let target = resolve_workspace_path(&state, &input)?;
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
    let trimmed = input.url.trim();
    if trimmed.is_empty() {
        return Err("URL cannot be empty".to_string());
    }
    let parsed = Url::parse(trimmed).map_err(|_| "Invalid URL".to_string())?;
    let scheme = parsed.scheme();
    if scheme != "http" && scheme != "https" {
        return Err("Only http/https links are supported".to_string());
    }

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



