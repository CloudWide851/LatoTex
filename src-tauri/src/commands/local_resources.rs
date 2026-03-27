use crate::models::{DrawioCacheInfo, DrawioCachePrepareInput};
use crate::state::AppState;
use crate::storage;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::http::{
    header::{CACHE_CONTROL, CONTENT_TYPE},
    Request, Response, StatusCode,
};
use tauri::State;
use urlencoding::{decode, encode};

pub const LOCAL_RESOURCE_SCHEME: &str = "latotex-resource";
const DRAWIO_ROUTE_PREFIX: &str = "/tool/drawio";
const WORKSPACE_FILE_ROUTE_PREFIX: &str = "/workspace-file";
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
}

struct DrawioCacheDirs {
    install_dir: PathBuf,
    appdata_dir: PathBuf,
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
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../public/core/{relative_subdir}")),
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

fn drawio_cache_dirs(state: &AppState) -> DrawioCacheDirs {
    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join("drawio-cache")))
        .unwrap_or_else(|| state.runtime_root.join("drawio-cache"));
    let appdata_dir = state.app_data_dir.join("drawio-cache");
    DrawioCacheDirs {
        install_dir,
        appdata_dir,
    }
}

fn prepare_drawio_cache(state: &AppState, policy: &str) -> Result<CachePrepareResult, String> {
    let source_dir = choose_existing_source_dir(&REQUIRED_DRAWIO_ASSETS, "drawio")
        .ok_or_else(|| "Drawio source assets were not found in app resources".to_string())?;
    let dirs = drawio_cache_dirs(state);

    let requested_dir = if policy == "appdata-only" {
        dirs.appdata_dir.clone()
    } else {
        dirs.install_dir.clone()
    };

    let mut actual_dir = requested_dir.clone();
    let mut install_dir_writable = true;
    let mut using_fallback = false;

    let ensure_result = ensure_cache_dir(&requested_dir, &source_dir, &REQUIRED_DRAWIO_ASSETS);
    if let Err(error) = ensure_result {
        if requested_dir == dirs.install_dir && is_permission_denied(&error) {
            install_dir_writable = false;
            using_fallback = true;
            actual_dir = dirs.appdata_dir.clone();
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
    })
}

fn resolve_existing_drawio_dir(state: &AppState) -> Option<PathBuf> {
    let dirs = drawio_cache_dirs(state);
    [dirs.install_dir, dirs.appdata_dir]
        .into_iter()
        .find(|dir| has_required_assets(dir, &REQUIRED_DRAWIO_ASSETS))
}

fn ensure_drawio_serving_dir(state: &AppState) -> Result<PathBuf, String> {
    if let Some(dir) = resolve_existing_drawio_dir(state) {
        return Ok(dir);
    }
    let prepared = prepare_drawio_cache(state, "install-first")?;
    Ok(PathBuf::from(prepared.actual_dir))
}

fn normalize_relative_asset_path(request_path: &str) -> Result<PathBuf, String> {
    let relative = request_path
        .trim()
        .strip_prefix(DRAWIO_ROUTE_PREFIX)
        .ok_or_else(|| "resource.path.unsupported".to_string())?
        .trim_start_matches('/');
    if relative.is_empty() {
        return Ok(PathBuf::from("index.html"));
    }

    let mut out = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) => out.push(value),
            Component::CurDir => {}
            _ => return Err("resource.path.invalid".to_string()),
        }
    }

    if out.as_os_str().is_empty() {
        return Ok(PathBuf::from("index.html"));
    }
    Ok(out)
}

fn mime_type_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase()
        .as_str()
    {
        "html" => "text/html; charset=utf-8",
        "js" => "application/javascript; charset=utf-8",
        "css" => "text/css; charset=utf-8",
        "svg" => "image/svg+xml",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "json" => "application/json; charset=utf-8",
        "xml" => "application/xml; charset=utf-8",
        "wasm" => "application/wasm",
        "pdf" => "application/pdf",
        _ => "application/octet-stream",
    }
}

fn build_text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .body(message.as_bytes().to_vec())
        .unwrap_or_else(|_| Response::new(message.as_bytes().to_vec()))
}

fn build_binary_response(status: StatusCode, mime: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime)
        .header(CACHE_CONTROL, "no-store")
        .body(bytes)
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn build_drawio_entry_url() -> String {
    #[cfg(target_os = "windows")]
    {
        return format!(
            "http://{}.localhost{DRAWIO_ROUTE_PREFIX}/index.html",
            LOCAL_RESOURCE_SCHEME
        );
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!("{LOCAL_RESOURCE_SCHEME}://localhost{DRAWIO_ROUTE_PREFIX}/index.html")
    }
}

pub fn build_workspace_file_resource_url(project_id: &str, relative_path: &str) -> String {
    let encoded_project_id = encode(project_id.trim());
    let encoded_relative_path = encode(relative_path.trim().trim_start_matches('/'));
    #[cfg(target_os = "windows")]
    {
        return format!(
            "http://{}.localhost{WORKSPACE_FILE_ROUTE_PREFIX}/{}/{}",
            LOCAL_RESOURCE_SCHEME, encoded_project_id, encoded_relative_path
        );
    }
    #[cfg(not(target_os = "windows"))]
    {
        format!(
            "{LOCAL_RESOURCE_SCHEME}://localhost{WORKSPACE_FILE_ROUTE_PREFIX}/{}/{}",
            encoded_project_id, encoded_relative_path
        )
    }
}

fn normalize_workspace_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let normalized = relative_path.trim().replace('\\', "/");
    let trimmed = normalized.trim_start_matches('/');
    if trimmed.is_empty() {
        return Err("resource.path.invalid".to_string());
    }
    let mut out = PathBuf::new();
    for component in Path::new(trimmed).components() {
        match component {
            Component::Normal(value) => out.push(value),
            Component::CurDir => {}
            _ => return Err("resource.path.invalid".to_string()),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("resource.path.invalid".to_string());
    }
    Ok(out)
}

fn resolve_workspace_file_request(
    state: &AppState,
    request_path: &str,
) -> Result<PathBuf, String> {
    let tail = request_path
        .trim()
        .strip_prefix(WORKSPACE_FILE_ROUTE_PREFIX)
        .ok_or_else(|| "resource.path.unsupported".to_string())?
        .trim_start_matches('/');
    let (project_id_raw, relative_path_raw) = tail
        .split_once('/')
        .ok_or_else(|| "resource.path.invalid".to_string())?;
    let project_id = decode(project_id_raw)
        .map_err(|_| "resource.path.invalid".to_string())?
        .into_owned();
    let relative_path = decode(relative_path_raw)
        .map_err(|_| "resource.path.invalid".to_string())?
        .into_owned();
    let project_root = storage::load_project_root(&state.db_path, &project_id)?;
    let safe_relative_path = normalize_workspace_relative_path(&relative_path)?;
    Ok(project_root.join(safe_relative_path))
}

fn serve_workspace_file(state: &AppState, request_path: &str) -> Response<Vec<u8>> {
    let asset_path = match resolve_workspace_file_request(state, request_path) {
        Ok(path) => path,
        Err(error) if error.starts_with("resource.") => {
            return build_text_response(StatusCode::BAD_REQUEST, &error)
        }
        Err(error) => return build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    if !asset_path.exists() || !asset_path.is_file() {
        return build_text_response(StatusCode::NOT_FOUND, "resource.asset_missing");
    }
    match fs::read(&asset_path) {
        Ok(bytes) => build_binary_response(StatusCode::OK, mime_type_for_path(&asset_path), bytes),
        Err(error) => build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

pub fn handle_local_resource_request(
    state: &AppState,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    let path = request.uri().path();
    if path.starts_with(WORKSPACE_FILE_ROUTE_PREFIX) {
        return serve_workspace_file(state, path);
    }
    if !path.starts_with(DRAWIO_ROUTE_PREFIX) {
        return build_text_response(StatusCode::NOT_FOUND, "resource.not_found");
    }

    let relative_path = match normalize_relative_asset_path(path) {
        Ok(path) => path,
        Err(error) => return build_text_response(StatusCode::BAD_REQUEST, &error),
    };
    let root = match ensure_drawio_serving_dir(state) {
        Ok(dir) => dir,
        Err(error) => return build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
    };
    let asset_path = root.join(&relative_path);
    if !asset_path.exists() || !asset_path.is_file() {
        return build_text_response(StatusCode::NOT_FOUND, "resource.asset_missing");
    }

    match fs::read(&asset_path) {
        Ok(bytes) => build_binary_response(StatusCode::OK, mime_type_for_path(&asset_path), bytes),
        Err(error) => build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

#[tauri::command]
pub fn drawio_cache_prepare(
    state: State<'_, AppState>,
    input: DrawioCachePrepareInput,
) -> Result<DrawioCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_drawio_cache(&state, policy)?;

    Ok(DrawioCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
        entry_url: build_drawio_entry_url(),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        build_drawio_entry_url, build_workspace_file_resource_url, normalize_relative_asset_path,
        normalize_workspace_relative_path, LOCAL_RESOURCE_SCHEME,
    };
    use std::path::PathBuf;

    #[test]
    fn drawio_entry_url_uses_custom_local_resource_scheme() {
        let value = build_drawio_entry_url();
        assert!(value.contains(LOCAL_RESOURCE_SCHEME));
        assert!(value.ends_with("/tool/drawio/index.html"));
    }

    #[test]
    fn normalize_relative_asset_path_defaults_to_index() {
        assert_eq!(
            normalize_relative_asset_path("/tool/drawio").unwrap(),
            PathBuf::from("index.html")
        );
    }

    #[test]
    fn normalize_relative_asset_path_rejects_traversal() {
        assert!(normalize_relative_asset_path("/tool/drawio/../secret.txt").is_err());
    }

    #[test]
    fn workspace_file_resource_url_encodes_project_and_relative_path() {
        let value = build_workspace_file_resource_url("project/one", ".latotex/papers/cache file.pdf");
        assert!(value.contains(LOCAL_RESOURCE_SCHEME));
        assert!(value.contains("project%2Fone"));
        assert!(value.contains("cache%20file.pdf"));
    }

    #[test]
    fn normalize_workspace_relative_path_rejects_traversal() {
        assert!(normalize_workspace_relative_path("../secret.pdf").is_err());
    }
}
