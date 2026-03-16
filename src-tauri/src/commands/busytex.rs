use crate::models::{
    AnalysisPyodideCacheInfo,
    AnalysisPyodidePrepareInput,
    BusyTexCacheInfo,
    BusyTexCachePrepareInput,
    DrawioCacheInfo,
    DrawioCachePrepareInput,
};
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;

const REQUIRED_BUSYTEX_ASSETS: [&str; 5] =
    ["busytex.js", "busytex.wasm", "busytex_worker.js", "busytex_pipeline.js", "texlive-basic.js"];

const REQUIRED_PYODIDE_ASSETS: [&str; 5] =
    ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"];

const REQUIRED_DRAWIO_ASSETS: [&str; 6] =
    ["index.html", "app.html", "js/app.min.js", "js/bootstrap.js", "js/main.js", "styles/grapheditor.css"];

struct CachePrepareResult {
    policy: String,
    requested_dir: String,
    actual_dir: String,
    install_dir_writable: bool,
    using_fallback: bool,
    source_dir: PathBuf,
}

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

fn has_required_assets(dir: &Path, required_assets: &[&str]) -> bool {
    required_assets.iter().all(|name| dir.join(name).exists())
}

fn candidate_source_dirs(relative_subdir: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("resources/core/{relative_subdir}")));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../public/core/{relative_subdir}")));
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(format!("resources/core/{relative_subdir}")));
            candidates.push(exe_dir.join(format!("core/{relative_subdir}")));
            candidates.push(exe_dir.join(format!("../resources/core/{relative_subdir}")));
        }
    }
    candidates
}

fn choose_existing_source_dir(required_assets: &[&str], relative_subdir: &str) -> Option<PathBuf> {
    candidate_source_dirs(relative_subdir)
        .into_iter()
        .find(|dir| has_required_assets(dir, required_assets))
}

fn ensure_cache_dir(cache_dir: &Path, source_dir: &Path, required_assets: &[&str]) -> Result<(), String> {
    if cache_dir.exists() && has_required_assets(cache_dir, required_assets) {
        return Ok(());
    }
    if !cache_dir.exists() {
        fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    }
    copy_recursively(source_dir, cache_dir)?;
    Ok(())
}

fn sync_cache_files(cache_dir: &Path, source_dir: &Path, files: &[&str]) -> Result<(), String> {
    for relative in files {
        let source = source_dir.join(relative);
        if !source.exists() {
            continue;
        }
        let target = cache_dir.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&source, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn is_permission_denied(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("os error 5")
}

fn write_cache_marker(
    actual_dir: &Path,
    policy: &str,
    requested_dir: &Path,
    using_fallback: bool,
) {
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
}

fn prepare_cache(
    state: &State<'_, AppState>,
    policy: &str,
    cache_dir_name: &str,
    source_relative_subdir: &str,
    required_assets: &[&str],
    missing_hint: &str,
) -> Result<CachePrepareResult, String> {
    let source_dir = choose_existing_source_dir(required_assets, source_relative_subdir)
        .ok_or_else(|| missing_hint.to_string())?;

    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join(cache_dir_name)))
        .unwrap_or_else(|| state.runtime_root.join(cache_dir_name));
    let appdata_dir = state.app_data_dir.join(cache_dir_name);

    let requested_dir = if policy == "appdata-only" {
        appdata_dir.clone()
    } else {
        install_dir.clone()
    };

    let mut actual_dir = requested_dir.clone();
    let mut install_dir_writable = true;
    let mut using_fallback = false;

    let ensure_result = ensure_cache_dir(&requested_dir, &source_dir, required_assets);
    if let Err(error) = ensure_result {
        if requested_dir == install_dir && is_permission_denied(&error) {
            install_dir_writable = false;
            using_fallback = true;
            actual_dir = appdata_dir.clone();
            ensure_cache_dir(&actual_dir, &source_dir, required_assets)?;
        } else {
            return Err(error);
        }
    }

    write_cache_marker(&actual_dir, policy, &requested_dir, using_fallback);

    Ok(CachePrepareResult {
        policy: policy.to_string(),
        requested_dir: requested_dir.to_string_lossy().to_string(),
        actual_dir: actual_dir.to_string_lossy().to_string(),
        install_dir_writable,
        using_fallback,
        source_dir,
    })
}

#[tauri::command]
pub fn busytex_cache_prepare(
    state: State<'_, AppState>,
    input: BusyTexCachePrepareInput,
) -> Result<BusyTexCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_cache(
        &state,
        policy,
        "busytex-cache",
        "busytex",
        &REQUIRED_BUSYTEX_ASSETS,
        "BusyTeX source assets were not found in app resources",
    )?;

    Ok(BusyTexCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
    })
}

#[tauri::command]
pub fn analysis_pyodide_prepare(
    state: State<'_, AppState>,
    input: AnalysisPyodidePrepareInput,
) -> Result<AnalysisPyodideCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_cache(
        &state,
        policy,
        "analysis-pyodide-cache",
        "pyodide",
        &REQUIRED_PYODIDE_ASSETS,
        "Pyodide source assets were not found in app resources",
    )?;

    Ok(AnalysisPyodideCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
    })
}

#[tauri::command]
pub fn drawio_cache_prepare(
    state: State<'_, AppState>,
    input: DrawioCachePrepareInput,
) -> Result<DrawioCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_cache(
        &state,
        policy,
        "drawio-cache",
        "drawio",
        &REQUIRED_DRAWIO_ASSETS,
        "Drawio source assets were not found in app resources",
    )?;

    sync_cache_files(
        Path::new(&prepared.actual_dir),
        &prepared.source_dir,
        &["index.html"],
    )?;

    Ok(DrawioCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
    })
}
