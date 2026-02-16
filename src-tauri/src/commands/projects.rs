use crate::models::{
    Ack, CreateProjectInput, FileReadInput, FileReadResponse, FileWriteInput, FsOperationInput,
    FsOperationResult, LibraryLinkImportInput, LibraryRefInput, ProjectPathActionInput,
    ProjectRefInput, ProjectSearchHit, ProjectSearchInput, ProjectSnapshot, ProjectSummary,
    ResourceNode,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
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
