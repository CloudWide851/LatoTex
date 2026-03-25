use crate::models::{
    AnalysisPyodideCacheInfo,
    AnalysisPyodidePrepareInput,
    BusyTexCacheInfo,
    BusyTexCachePrepareInput,
    DrawioCacheInfo,
    DrawioCachePrepareInput,
    LocalResourceProbeEntry,
    LocalResourceProbeInput,
    LocalResourceProbeResponse,
};
use crate::state::AppState;
use std::fs;
use std::path::{Path, PathBuf};
use tauri::State;
use urlencoding::encode;

#[path = "busytex_package.rs"]
mod busytex_package;
pub use busytex_package::busytex_install_missing_package;

const REQUIRED_BUSYTEX_ASSETS: [&str; 5] = [
    "busytex.js",
    "busytex.wasm",
    "busytex_worker.js",
    "busytex_pipeline.js",
    "texlive-basic.js",
];

const REQUIRED_PYODIDE_ASSETS: [&str; 5] = [
    "pyodide.mjs",
    "pyodide.asm.js",
    "pyodide.asm.wasm",
    "pyodide-lock.json",
    "python_stdlib.zip",
];

const REQUIRED_DRAWIO_ASSETS: [&str; 6] = [
    "index.html",
    "app.html",
    "js/app.min.js",
    "js/bootstrap.js",
    "js/main.js",
    "styles/grapheditor.css",
];

pub(super) struct CachePrepareResult {
    policy: String,
    requested_dir: String,
    actual_dir: String,
    install_dir_writable: bool,
    using_fallback: bool,
    install_dir: String,
    appdata_dir: String,
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

fn missing_required_assets(dir: &Path, required_assets: &[&str]) -> Vec<String> {
    required_assets
        .iter()
        .filter(|name| !dir.join(name).exists())
        .map(|name| (*name).to_string())
        .collect()
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
        install_dir: install_dir.to_string_lossy().to_string(),
        appdata_dir: appdata_dir.to_string_lossy().to_string(),
        source_dir,
    })
}

pub(super) fn ensure_busytex_cache_dir(
    state: &State<'_, AppState>,
    policy: &str,
) -> Result<CachePrepareResult, String> {
    prepare_cache(
        state,
        policy,
        "busytex-cache",
        "busytex",
        &REQUIRED_BUSYTEX_ASSETS,
        "BusyTeX source assets were not found in app resources",
    )
}

fn ensure_pyodide_cache_dir(
    state: &State<'_, AppState>,
    policy: &str,
) -> Result<CachePrepareResult, String> {
    prepare_cache(
        state,
        policy,
        "analysis-pyodide-cache",
        "pyodide",
        &REQUIRED_PYODIDE_ASSETS,
        "Pyodide source assets were not found in app resources",
    )
}

fn ensure_drawio_cache_dir(
    state: &State<'_, AppState>,
    policy: &str,
) -> Result<CachePrepareResult, String> {
    let prepared = prepare_cache(
        state,
        policy,
        "drawio-cache",
        "drawio",
        &REQUIRED_DRAWIO_ASSETS,
        "Drawio source assets were not found in app resources",
    )?;

    sync_cache_files(
        Path::new(&prepared.actual_dir),
        &prepared.source_dir,
        &REQUIRED_DRAWIO_ASSETS,
    )?;

    Ok(prepared)
}

fn normalize_asset_localhost_path(actual_dir: &str) -> String {
    actual_dir.trim().replace('\\', "/").trim_end_matches('/').to_string()
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

fn push_cache_candidate_dir(candidate_dirs: &mut Vec<String>, dir: &str, required_assets: &[&str]) {
    let normalized = dir.trim();
    if normalized.is_empty() || !has_required_assets(Path::new(normalized), required_assets) {
        return;
    }
    if candidate_dirs.iter().any(|item| item == normalized) {
        return;
    }
    candidate_dirs.push(normalized.to_string());
}

fn build_cache_candidate_base_urls(prepared: &CachePrepareResult, required_assets: &[&str]) -> Vec<String> {
    let mut candidate_dirs = Vec::<String>::new();
    if prepared.policy == "appdata-only" {
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.appdata_dir, required_assets);
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.actual_dir, required_assets);
    } else {
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.install_dir, required_assets);
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.actual_dir, required_assets);
        push_cache_candidate_dir(&mut candidate_dirs, &prepared.appdata_dir, required_assets);
    }

    candidate_dirs
        .into_iter()
        .filter_map(|dir| build_asset_localhost_base_url(&dir))
        .collect()
}

fn build_asset_entry_url(base_url: Option<&str>, relative_path: &str) -> Option<String> {
    let base = base_url?.trim().trim_end_matches('/');
    let relative = relative_path.trim().trim_start_matches('/');
    if base.is_empty() || relative.is_empty() {
        return None;
    }
    Some(format!("{base}/{relative}"))
}

fn module_url_for_resource(key: &str, base_url: Option<&str>) -> Option<String> {
    if key == "pyodide" {
        return build_asset_entry_url(base_url, "pyodide.mjs");
    }
    None
}

fn index_url_for_resource(key: &str, base_url: Option<&str>) -> Option<String> {
    if key == "pyodide" {
        return base_url
            .map(|value| value.trim().trim_end_matches('/').to_string())
            .filter(|value| !value.is_empty())
            .map(|value| format!("{value}/"));
    }
    None
}

fn host_url_for_resource(key: &str, base_url: Option<&str>) -> Option<String> {
    if key == "drawio" {
        return build_asset_entry_url(base_url, "index.html");
    }
    None
}

fn preferred_init_mode_for_resource(key: &str) -> Option<String> {
    if key == "busytex" {
        return Some("direct".to_string());
    }
    None
}

fn build_local_resource_probe_entry(
    key: &str,
    policy: &str,
    prepare_result: Result<CachePrepareResult, String>,
    required_assets: &[&str],
) -> LocalResourceProbeEntry {
    match prepare_result {
        Ok(prepared) => {
            let missing_assets = missing_required_assets(Path::new(&prepared.actual_dir), required_assets);
            let actual_dir = prepared.actual_dir;
            let base_url = build_asset_localhost_base_url(&actual_dir);
            LocalResourceProbeEntry {
                key: key.to_string(),
                policy: prepared.policy,
                requested_dir: Some(prepared.requested_dir),
                actual_dir: Some(actual_dir.clone()),
                install_dir_writable: Some(prepared.install_dir_writable),
                using_fallback: Some(prepared.using_fallback),
                base_url: base_url.clone(),
                module_url: module_url_for_resource(key, base_url.as_deref()),
                index_url: index_url_for_resource(key, base_url.as_deref()),
                host_url: host_url_for_resource(key, base_url.as_deref()),
                preferred_init_mode: preferred_init_mode_for_resource(key),
                ready: missing_assets.is_empty(),
                missing_assets,
                error: None,
            }
        }
        Err(error) => LocalResourceProbeEntry {
            key: key.to_string(),
            policy: policy.to_string(),
            requested_dir: None,
            actual_dir: None,
            install_dir_writable: None,
            using_fallback: None,
            base_url: None,
            module_url: None,
            index_url: None,
            host_url: None,
            preferred_init_mode: preferred_init_mode_for_resource(key),
            ready: false,
            missing_assets: required_assets.iter().map(|item| (*item).to_string()).collect(),
            error: Some(error),
        },
    }
}

#[tauri::command]
pub fn busytex_cache_prepare(
    state: State<'_, AppState>,
    input: BusyTexCachePrepareInput,
) -> Result<BusyTexCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = ensure_busytex_cache_dir(&state, policy)?;

    let candidate_base_urls = build_cache_candidate_base_urls(&prepared, &REQUIRED_BUSYTEX_ASSETS);
    let actual_dir = prepared.actual_dir.clone();
    Ok(BusyTexCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: actual_dir.clone(),
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
        base_url: build_asset_localhost_base_url(&actual_dir),
        candidate_base_urls,
        preferred_init_mode: Some("direct".to_string()),
    })
}

#[tauri::command]
pub fn analysis_pyodide_prepare(
    state: State<'_, AppState>,
    input: AnalysisPyodidePrepareInput,
) -> Result<AnalysisPyodideCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = ensure_pyodide_cache_dir(&state, policy)?;

    let base_url = build_asset_localhost_base_url(&prepared.actual_dir);

    Ok(AnalysisPyodideCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
        base_url: base_url.clone(),
        module_url: module_url_for_resource("pyodide", base_url.as_deref()),
        index_url: index_url_for_resource("pyodide", base_url.as_deref()),
    })
}

#[tauri::command]
pub fn drawio_cache_prepare(
    state: State<'_, AppState>,
    input: DrawioCachePrepareInput,
) -> Result<DrawioCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = ensure_drawio_cache_dir(&state, policy)?;

    let candidate_base_urls = build_cache_candidate_base_urls(&prepared, &REQUIRED_DRAWIO_ASSETS);
    let base_url = build_asset_localhost_base_url(&prepared.actual_dir);
    let candidate_host_urls = candidate_base_urls
        .iter()
        .filter_map(|candidate| host_url_for_resource("drawio", Some(candidate.as_str())))
        .collect::<Vec<_>>();

    Ok(DrawioCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
        base_url: base_url.clone(),
        host_url: host_url_for_resource("drawio", base_url.as_deref()),
        candidate_host_urls,
    })
}

#[tauri::command]
pub fn local_resource_probe(
    state: State<'_, AppState>,
    input: LocalResourceProbeInput,
) -> Result<LocalResourceProbeResponse, String> {
    let policy = input.policy.unwrap_or_else(|| "install-first".to_string());
    let normalized_policy = policy.trim();

    Ok(LocalResourceProbeResponse {
        busytex: build_local_resource_probe_entry(
            "busytex",
            normalized_policy,
            ensure_busytex_cache_dir(&state, normalized_policy),
            &REQUIRED_BUSYTEX_ASSETS,
        ),
        pyodide: build_local_resource_probe_entry(
            "pyodide",
            normalized_policy,
            ensure_pyodide_cache_dir(&state, normalized_policy),
            &REQUIRED_PYODIDE_ASSETS,
        ),
        drawio: build_local_resource_probe_entry(
            "drawio",
            normalized_policy,
            ensure_drawio_cache_dir(&state, normalized_policy),
            &REQUIRED_DRAWIO_ASSETS,
        ),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_asset_localhost_base_url, build_cache_candidate_base_urls, build_local_resource_probe_entry,
        missing_required_assets, CachePrepareResult,
    };
    use std::fs;
    use std::path::PathBuf;

    #[test]
    fn build_asset_localhost_base_url_keeps_windows_drive_unescaped() {
        let base_url = build_asset_localhost_base_url("F:\\LatoTex\\drawio-cache");

        assert_eq!(
            base_url.as_deref(),
            Some("http://asset.localhost/F:/LatoTex/drawio-cache")
        );
    }

    #[test]
    fn missing_required_assets_reports_only_absent_files() {
        let root = std::env::temp_dir().join(format!(
            "latotex-local-resource-probe-{}",
            std::process::id()
        ));
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join("js")).unwrap();
        fs::write(root.join("index.html"), "ok").unwrap();
        fs::write(root.join("js/app.min.js"), "ok").unwrap();

        let missing = missing_required_assets(
            &root,
            &["index.html", "js/app.min.js", "styles/grapheditor.css"],
        );

        assert_eq!(missing, vec!["styles/grapheditor.css".to_string()]);
        let _ = fs::remove_dir_all(&root);
    }

    #[test]
    fn build_local_resource_probe_entry_marks_ready_only_when_cache_is_complete() {
        let prepared = CachePrepareResult {
            policy: "install-first".to_string(),
            requested_dir: "F:/cache".to_string(),
            actual_dir: "F:/cache".to_string(),
            install_dir_writable: true,
            using_fallback: false,
            install_dir: "F:/cache".to_string(),
            appdata_dir: "C:/Users/test/AppData/Roaming/LatoTex/cache".to_string(),
            source_dir: PathBuf::from("F:/source"),
        };

        let entry = build_local_resource_probe_entry(
            "drawio",
            "install-first",
            Ok(prepared),
            &[],
        );

        assert_eq!(entry.key, "drawio");
        assert!(entry.ready);
        assert!(entry.error.is_none());
        assert_eq!(entry.actual_dir.as_deref(), Some("F:/cache"));
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
        fs::create_dir_all(&install_dir).unwrap();
        fs::create_dir_all(&appdata_dir).unwrap();
        fs::write(install_dir.join("index.html"), "ok").unwrap();
        fs::write(appdata_dir.join("index.html"), "ok").unwrap();

        let prepared = CachePrepareResult {
            policy: "install-first".to_string(),
            requested_dir: install_dir.to_string_lossy().to_string(),
            actual_dir: install_dir.to_string_lossy().to_string(),
            install_dir_writable: true,
            using_fallback: false,
            install_dir: install_dir.to_string_lossy().to_string(),
            appdata_dir: appdata_dir.to_string_lossy().to_string(),
            source_dir: PathBuf::from("F:/source"),
        };

        let candidates = build_cache_candidate_base_urls(&prepared, &["index.html"]);

        assert_eq!(candidates.len(), 2);
        assert_eq!(candidates[0], format!("http://asset.localhost/{}", install_dir.to_string_lossy().replace('\\', "/")));
        assert_eq!(candidates[1], format!("http://asset.localhost/{}", appdata_dir.to_string_lossy().replace('\\', "/")));
        let _ = fs::remove_dir_all(&root);
    }
}
