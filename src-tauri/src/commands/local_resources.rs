use crate::models::{DrawioCacheInfo, DrawioCachePrepareInput};
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use urlencoding::encode;

const REQUIRED_DRAWIO_ASSETS: [&str; 6] = [
    "index.html",
    "app.html",
    "js/app.min.js",
    "js/bootstrap.js",
    "js/main.js",
    "styles/grapheditor.css",
];

struct CachePrepareResult {
    policy: String,
    requested_dir: String,
    actual_dir: String,
    install_dir_writable: bool,
    using_fallback: bool,
    install_dir: String,
    appdata_dir: String,
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
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("resources/core/{relative_subdir}")),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../public/core/{relative_subdir}")),
    );
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

fn ensure_cache_dir(
    cache_dir: &Path,
    source_dir: &Path,
    required_assets: &[&str],
) -> Result<(), String> {
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

fn write_cache_marker(actual_dir: &Path, policy: &str, requested_dir: &Path, using_fallback: bool) {
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

fn prepare_drawio_cache(
    state: &State<'_, AppState>,
    policy: &str,
) -> Result<CachePrepareResult, String> {
    let source_dir = choose_existing_source_dir(&REQUIRED_DRAWIO_ASSETS, "drawio")
        .ok_or_else(|| "Drawio source assets were not found in app resources".to_string())?;

    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("drawio-cache")))
        .unwrap_or_else(|| state.runtime_root.join("drawio-cache"));
    let appdata_dir = state.app_data_dir.join("drawio-cache");

    let requested_dir = if policy == "appdata-only" {
        appdata_dir.clone()
    } else {
        install_dir.clone()
    };

    let mut actual_dir = requested_dir.clone();
    let mut install_dir_writable = true;
    let mut using_fallback = false;

    let ensure_result = ensure_cache_dir(&requested_dir, &source_dir, &REQUIRED_DRAWIO_ASSETS);
    if let Err(error) = ensure_result {
        if requested_dir == install_dir && is_permission_denied(&error) {
            install_dir_writable = false;
            using_fallback = true;
            actual_dir = appdata_dir.clone();
            ensure_cache_dir(&actual_dir, &source_dir, &REQUIRED_DRAWIO_ASSETS)?;
        } else {
            return Err(error);
        }
    }

    sync_cache_files(&actual_dir, &source_dir, &REQUIRED_DRAWIO_ASSETS)?;
    write_cache_marker(&actual_dir, policy, &requested_dir, using_fallback);

    Ok(CachePrepareResult {
        policy: policy.to_string(),
        requested_dir: requested_dir.to_string_lossy().to_string(),
        actual_dir: actual_dir.to_string_lossy().to_string(),
        install_dir_writable,
        using_fallback,
        install_dir: install_dir.to_string_lossy().to_string(),
        appdata_dir: appdata_dir.to_string_lossy().to_string(),
    })
}

fn normalize_asset_localhost_path(actual_dir: &str) -> String {
    actual_dir
        .trim()
        .replace('\\', "/")
        .trim_end_matches('/')
        .to_string()
}

fn encode_asset_path_segment(segment: &str, index: usize) -> String {
    if segment.is_empty() {
        return String::new();
    }
    if index == 0
        && segment.len() == 2
        && segment.ends_with(':')
        && segment
            .chars()
            .next()
            .map(|value| value.is_ascii_alphabetic())
            .unwrap_or(false)
    {
        return segment.to_string();
    }
    encode(segment).into_owned()
}

fn build_asset_localhost_base_url(actual_dir: &str) -> Option<String> {
    let normalized = normalize_asset_localhost_path(actual_dir);
    if normalized.is_empty() {
        return None;
    }
    let encoded = normalized
        .split('/')
        .enumerate()
        .map(|(index, segment)| encode_asset_path_segment(segment, index))
        .collect::<Vec<_>>()
        .join("/");
    Some(format!("http://asset.localhost/{encoded}"))
}

fn host_url_for_base(base_url: Option<&str>) -> Option<String> {
    let base = base_url?.trim().trim_end_matches('/');
    if base.is_empty() {
        return None;
    }
    Some(format!("{base}/index.html"))
}

fn push_cache_candidate_dir(candidate_dirs: &mut Vec<String>, dir: &str) {
    let normalized = dir.trim();
    if normalized.is_empty() || !has_required_assets(Path::new(normalized), &REQUIRED_DRAWIO_ASSETS) {
        return;
    }
    if candidate_dirs.iter().any(|item| item == normalized) {
        return;
    }
    candidate_dirs.push(normalized.to_string());
}

fn build_cache_candidate_base_urls(prepared: &CachePrepareResult) -> Vec<String> {
    let mut candidate_dirs = Vec::<String>::new();
    if prepared.policy == "appdata-only" {
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.appdata_dir);
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.actual_dir);
    } else {
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.install_dir);
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.actual_dir);
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.appdata_dir);
    }

    candidate_dirs
        .into_iter()
        .filter_map(|dir| build_asset_localhost_base_url(&dir))
        .collect()
}

#[tauri::command]
pub fn drawio_cache_prepare(
    state: State<'_, AppState>,
    input: DrawioCachePrepareInput,
) -> Result<DrawioCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_drawio_cache(&state, policy)?;

    let candidate_base_urls = build_cache_candidate_base_urls(&prepared);
    let base_url = build_asset_localhost_base_url(&prepared.actual_dir);
    let candidate_host_urls = candidate_base_urls
        .iter()
        .filter_map(|candidate| host_url_for_base(Some(candidate.as_str())))
        .collect::<Vec<_>>();

    Ok(DrawioCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
        base_url: base_url.clone(),
        host_url: host_url_for_base(base_url.as_deref()),
        candidate_host_urls,
    })
}

#[cfg(test)]
mod tests {
    use super::{build_asset_localhost_base_url, build_cache_candidate_base_urls, CachePrepareResult};
    use std::fs;

    #[test]
    fn build_asset_localhost_base_url_keeps_windows_drive_unescaped() {
        let base_url = build_asset_localhost_base_url("F:\\LatoTex\\drawio-cache");

        assert_eq!(
            base_url.as_deref(),
            Some("http://asset.localhost/F:/LatoTex/drawio-cache")
        );
    }

    #[test]
    fn build_cache_candidate_base_urls_prefers_install_then_appdata_when_available() {
        let root = std::env::temp_dir().join(format!(
            "latotex-cache-candidates-{}",
            std::process::id()
        ));
        let install_dir = root.join("install-cache");
        let appdata_dir = root.join("appdata-cache");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(install_dir.join("js")).unwrap();
        fs::create_dir_all(install_dir.join("styles")).unwrap();
        fs::create_dir_all(appdata_dir.join("js")).unwrap();
        fs::create_dir_all(appdata_dir.join("styles")).unwrap();
        for dir in [&install_dir, &appdata_dir] {
            fs::write(dir.join("index.html"), "ok").unwrap();
            fs::write(dir.join("app.html"), "ok").unwrap();
            fs::write(dir.join("js/app.min.js"), "ok").unwrap();
            fs::write(dir.join("js/bootstrap.js"), "ok").unwrap();
            fs::write(dir.join("js/main.js"), "ok").unwrap();
            fs::write(dir.join("styles/grapheditor.css"), "ok").unwrap();
        }

        let prepared = CachePrepareResult {
            policy: "install-first".to_string(),
            requested_dir: install_dir.to_string_lossy().to_string(),
            actual_dir: install_dir.to_string_lossy().to_string(),
            install_dir_writable: true,
            using_fallback: false,
            install_dir: install_dir.to_string_lossy().to_string(),
            appdata_dir: appdata_dir.to_string_lossy().to_string(),
        };

        let candidates = build_cache_candidate_base_urls(&prepared);

        assert_eq!(candidates.len(), 2);
        assert_eq!(
            candidates[0],
            format!(
                "http://asset.localhost/{}",
                install_dir.to_string_lossy().replace('\\', "/")
            )
        );
        assert_eq!(
            candidates[1],
            format!(
                "http://asset.localhost/{}",
                appdata_dir.to_string_lossy().replace('\\', "/")
            )
        );
        let _ = fs::remove_dir_all(&root);
    }
}





