use crate::models::{Ack, AppBackgroundImage, AppBackgroundImagePayload, BackgroundImageReadInput};
use crate::state::AppState;
use rfd::FileDialog;
use std::fs;
use std::path::Path;
use tauri::State;

fn normalized_image_extension(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "jpg",
        "webp" => "webp",
        "bmp" => "bmp",
        _ => "png",
    }
}

fn detect_image_mime(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "jpg" | "jpeg" => "image/jpeg",
        "webp" => "image/webp",
        "bmp" => "image/bmp",
        "gif" => "image/gif",
        "svg" => "image/svg+xml",
        _ => "image/png",
    }
}

fn wallpaper_root(state: &AppState) -> std::path::PathBuf {
    state.app_data_dir.join("wallpapers")
}

fn is_inside_wallpaper_root(state: &AppState, candidate: &Path) -> bool {
    let Ok(candidate_abs) = candidate.canonicalize() else {
        return false;
    };
    let root = wallpaper_root(state);
    let Ok(root_abs) = root.canonicalize() else {
        return false;
    };
    candidate_abs.starts_with(root_abs)
}

#[tauri::command]
pub fn settings_pick_background_image(
    state: State<'_, AppState>,
) -> Result<Option<AppBackgroundImage>, String> {
    let selected = FileDialog::new()
        .add_filter("Image", &["png", "jpg", "jpeg", "webp", "bmp"])
        .pick_file();
    let Some(source) = selected else {
        return Ok(None);
    };
    let wallpapers_dir = wallpaper_root(&state);
    fs::create_dir_all(&wallpapers_dir).map_err(|e| e.to_string())?;
    let ext = normalized_image_extension(&source);
    let target = wallpapers_dir.join(format!("wallpaper-{}.{}", uuid::Uuid::new_v4(), ext));
    fs::copy(&source, &target).map_err(|e| e.to_string())?;
    state.log(
        "INFO",
        &format!(
            "settings_pick_background_image: {}",
            target.to_string_lossy()
        ),
    );
    Ok(Some(AppBackgroundImage {
        path: target.to_string_lossy().to_string(),
    }))
}

#[tauri::command]
pub fn settings_remove_background_image(
    state: State<'_, AppState>,
    input: BackgroundImageReadInput,
) -> Result<Ack, String> {
    let raw = input.path.trim();
    if raw.is_empty() {
        return Ok(Ack {
            ok: true,
            message: "empty path".to_string(),
        });
    }
    let path = Path::new(raw);
    if !path.exists() {
        state.log(
            "WARN",
            &format!("settings_remove_background_image missing: {raw}"),
        );
        return Ok(Ack {
            ok: true,
            message: "already missing".to_string(),
        });
    }
    if !is_inside_wallpaper_root(&state, path) {
        return Err("background image path is outside app wallpaper directory".to_string());
    }
    fs::remove_file(path).map_err(|e| e.to_string())?;
    state.log(
        "INFO",
        &format!(
            "settings_remove_background_image: {}",
            path.to_string_lossy()
        ),
    );
    Ok(Ack {
        ok: true,
        message: "removed".to_string(),
    })
}

#[tauri::command]
pub fn settings_read_background_image(
    state: State<'_, AppState>,
    input: BackgroundImageReadInput,
) -> Result<Option<AppBackgroundImagePayload>, String> {
    let raw = input.path.trim();
    if raw.is_empty() {
        return Ok(None);
    }
    let path = Path::new(raw);
    if !path.exists() || !path.is_file() {
        state.log(
            "WARN",
            &format!("settings_read_background_image missing: {raw}"),
        );
        return Ok(None);
    }
    let bytes = fs::read(path).map_err(|e| e.to_string())?;
    let mime = detect_image_mime(path).to_string();
    Ok(Some(AppBackgroundImagePayload {
        path: raw.to_string(),
        mime,
        bytes,
    }))
}
