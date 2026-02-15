use crate::models::{BusyTexCacheInfo, BusyTexCachePrepareInput};
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

fn copy_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let from = item.path();
            let to = target.join(item.file_name());
            copy_recursively(&from, &to)?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn candidate_source_dirs() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    // Dev workspace path.
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("../public/core/busytex"));
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources/core/busytex"));
            candidates.push(exe_dir.join("core/busytex"));
            candidates.push(exe_dir.join("../resources/core/busytex"));
        }
    }
    candidates
}

fn choose_existing_source_dir() -> Option<PathBuf> {
    let required = ["busytex.js", "busytex.wasm", "busytex_worker.js", "texlive-basic.js"];
    candidate_source_dirs().into_iter().find(|dir| {
        required.iter().all(|name| dir.join(name).exists())
    })
}

fn ensure_cache_dir(cache_dir: &Path, source_dir: &Path) -> Result<(), String> {
    if cache_dir.exists() {
        return Ok(());
    }
    fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    copy_recursively(source_dir, cache_dir)?;
    Ok(())
}

fn is_permission_denied(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("os error 5")
}

#[tauri::command]
pub fn busytex_cache_prepare(
    state: State<'_, AppState>,
    input: BusyTexCachePrepareInput,
) -> Result<BusyTexCacheInfo, String> {
    let policy = input.policy.trim().to_string();
    let source_dir = choose_existing_source_dir()
        .ok_or_else(|| "BusyTeX source assets were not found in app resources".to_string())?;

    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("busytex-cache")))
        .unwrap_or_else(|| state.downloads_dir.join("busytex-cache"));
    let appdata_dir = state._data_dir.join("busytex-cache");

    let requested_dir = if policy == "appdata-only" {
        appdata_dir.clone()
    } else {
        install_dir.clone()
    };

    let mut actual_dir = requested_dir.clone();
    let mut install_dir_writable = true;
    let mut using_fallback = false;

    let ensure_result = ensure_cache_dir(&requested_dir, &source_dir);
    if let Err(error) = ensure_result {
        if requested_dir == install_dir && is_permission_denied(&error) {
            install_dir_writable = false;
            using_fallback = true;
            actual_dir = appdata_dir.clone();
            ensure_cache_dir(&actual_dir, &source_dir)?;
        } else {
            return Err(error);
        }
    }

    let marker_path = actual_dir.join(".cache-info.json");
    let marker_json = serde_json::json!({
        "policy": policy,
        "requestedDir": requested_dir.to_string_lossy().to_string(),
        "actualDir": actual_dir.to_string_lossy().to_string(),
        "usingFallback": using_fallback
    });
    let _ = fs::write(
        marker_path,
        serde_json::to_string_pretty(&marker_json).unwrap_or_else(|_| "{}".to_string()),
    );

    Ok(BusyTexCacheInfo {
        policy,
        requested_dir: requested_dir.to_string_lossy().to_string(),
        actual_dir: actual_dir.to_string_lossy().to_string(),
        install_dir_writable,
        using_fallback,
    })
}
