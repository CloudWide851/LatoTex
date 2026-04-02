use crate::state::AppState;
use crate::storage;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tauri::http::{
    header::{CACHE_CONTROL, CONTENT_TYPE},
    Method, Request, Response, StatusCode,
};
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
    actual_dir: String,
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

fn resolve_drawio_marker_dir(dir: &Path) -> Option<PathBuf> {
    let marker_path = dir.join(".cache-info.json");
    let marker_raw = fs::read_to_string(marker_path).ok()?;
    let marker_value: serde_json::Value = serde_json::from_str(&marker_raw).ok()?;
    let actual_dir = marker_value.get("actualDir")?.as_str()?.trim();
    if actual_dir.is_empty() {
        return None;
    }
    let actual_path = PathBuf::from(actual_dir);
    if has_required_assets(&actual_path, &REQUIRED_DRAWIO_ASSETS) {
        Some(actual_path)
    } else {
        None
    }
}

fn push_unique_dir(target: &mut Vec<PathBuf>, candidate: PathBuf) {
    if target.iter().any(|item| item == &candidate) {
        return;
    }
    target.push(candidate);
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
    let mut using_fallback = false;

    let ensure_result = ensure_cache_dir(&requested_dir, &source_dir, &REQUIRED_DRAWIO_ASSETS);
    if let Err(error) = ensure_result {
        if requested_dir == dirs.install_dir && is_permission_denied(&error) {
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
        actual_dir: actual_dir.to_string_lossy().to_string(),
    })
}

fn resolve_existing_drawio_dir(state: &AppState) -> Option<PathBuf> {
    let dirs = drawio_cache_dirs(state);
    let mut candidates = Vec::<PathBuf>::new();
    for dir in [&dirs.install_dir, &dirs.appdata_dir] {
        if let Some(actual_dir) = resolve_drawio_marker_dir(dir) {
            push_unique_dir(&mut candidates, actual_dir);
        }
    }
    if has_required_assets(&dirs.appdata_dir, &REQUIRED_DRAWIO_ASSETS) {
        push_unique_dir(&mut candidates, dirs.appdata_dir.clone());
    }
    if has_required_assets(&dirs.install_dir, &REQUIRED_DRAWIO_ASSETS) {
        push_unique_dir(&mut candidates, dirs.install_dir.clone());
    }
    candidates.into_iter().next()
}

fn ensure_drawio_serving_dir(state: &AppState) -> Result<PathBuf, String> {
    if let Some(dir) = resolve_existing_drawio_dir(state) {
        return Ok(dir);
    }
    let prepared = prepare_drawio_cache(state, "appdata-only")?;
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

fn local_resource_header_values() -> [(&'static str, &'static str); 4] {
    [
        ("Access-Control-Allow-Origin", "*"),
        ("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS"),
        ("Access-Control-Allow-Headers", "Range, Content-Type"),
        (
            "Access-Control-Expose-Headers",
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, Cache-Control",
        ),
    ]
}

fn build_text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let body = message.as_bytes().to_vec();
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .header("Content-Length", body.len().to_string());
    for (name, value) in local_resource_header_values() {
        builder = builder.header(name, value);
    }
    builder
        .body(body.clone())
        .unwrap_or_else(|_| Response::new(body))
}

fn build_binary_response(status: StatusCode, mime: &str, bytes: Vec<u8>) -> Response<Vec<u8>> {
    build_binary_response_with_headers(status, mime, bytes, &[])
}

fn build_binary_response_with_headers(
    status: StatusCode,
    mime: &str,
    bytes: Vec<u8>,
    extra_headers: &[(&str, String)],
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime)
        .header(CACHE_CONTROL, "no-store")
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", bytes.len().to_string());
    for (name, value) in local_resource_header_values() {
        builder = builder.header(name, value);
    }
    for (name, value) in extra_headers {
        builder = builder.header(*name, value);
    }
    builder
        .body(bytes.clone())
        .unwrap_or_else(|_| Response::new(bytes))
}

fn build_options_response() -> Response<Vec<u8>> {
    build_binary_response_with_headers(StatusCode::NO_CONTENT, "application/octet-stream", Vec::new(), &[])
}

fn parse_byte_range(range_header: &str, total_len: usize) -> Result<Option<(usize, usize)>, String> {
    if total_len == 0 {
        return Ok(None);
    }
    let trimmed = range_header.trim();
    let Some(value) = trimmed.strip_prefix("bytes=") else {
        return Err("resource.range.invalid".to_string());
    };
    let Some((start_raw, end_raw)) = value.split_once('-') else {
        return Err("resource.range.invalid".to_string());
    };
    if start_raw.trim().is_empty() {
        let suffix_len = end_raw
            .trim()
            .parse::<usize>()
            .map_err(|_| "resource.range.invalid".to_string())?;
        if suffix_len == 0 {
            return Ok(None);
        }
        let actual_len = suffix_len.min(total_len);
        return Ok(Some((total_len - actual_len, total_len - 1)));
    }

    let start = start_raw
        .trim()
        .parse::<usize>()
        .map_err(|_| "resource.range.invalid".to_string())?;
    if start >= total_len {
        return Err("resource.range.unsatisfiable".to_string());
    }
    let end = if end_raw.trim().is_empty() {
        total_len - 1
    } else {
        end_raw
            .trim()
            .parse::<usize>()
            .map_err(|_| "resource.range.invalid".to_string())?
    };
    if end < start {
        return Err("resource.range.invalid".to_string());
    }
    Ok(Some((start, end.min(total_len - 1))))
}

fn workspace_file_response_bytes(
    method: &Method,
    bytes: Vec<u8>,
    mime: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    if *method == Method::HEAD {
        return build_binary_response(StatusCode::OK, mime, Vec::new());
    }

    let total_len = bytes.len();
    let Some(range_value) = range_header.map(str::trim).filter(|value| !value.is_empty()) else {
        return build_binary_response(StatusCode::OK, mime, bytes);
    };

    match parse_byte_range(range_value, total_len) {
        Ok(Some((start, end))) => {
            let content_range = format!("bytes {start}-{end}/{total_len}");
            let partial = bytes[start..=end].to_vec();
            build_binary_response_with_headers(
                StatusCode::PARTIAL_CONTENT,
                mime,
                partial,
                &[("Content-Range", content_range)],
            )
        }
        Ok(None) => build_binary_response(StatusCode::OK, mime, bytes),
        Err(error) if error == "resource.range.unsatisfiable" => build_binary_response_with_headers(
            StatusCode::RANGE_NOT_SATISFIABLE,
            mime,
            Vec::new(),
            &[("Content-Range", format!("bytes */{total_len}"))],
        ),
        Err(error) => build_text_response(StatusCode::BAD_REQUEST, &error),
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

fn serve_workspace_file(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let request_path = request.uri().path();
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
        Ok(bytes) => workspace_file_response_bytes(
            request.method(),
            bytes,
            mime_type_for_path(&asset_path),
            request
                .headers()
                .get("range")
                .and_then(|value| value.to_str().ok()),
        ),
        Err(error) => build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string()),
    }
}

pub fn handle_local_resource_request(
    state: &AppState,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    if request.method() == Method::OPTIONS {
        return build_options_response();
    }
    let path = request.uri().path();
    if path.starts_with(WORKSPACE_FILE_ROUTE_PREFIX) {
        return serve_workspace_file(state, request);
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

#[cfg(test)]
#[path = "local_resources_tests.rs"]
mod tests;

