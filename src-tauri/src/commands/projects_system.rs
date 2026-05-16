use crate::models::{Ack, OpenExternalLinkInput, ProjectPathActionInput};
use crate::state::AppState;
use crate::storage;
use latotex_workspace::{resolve_workspace_target_path, validate_external_http_url};
use std::process::Command;
use tauri::State;

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
