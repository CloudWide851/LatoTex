use super::runtime_assets::find_runtime_asset_entry;
use crate::state::AppState;
use crate::storage;
use std::cell::RefCell;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri::http::{
    header::{CACHE_CONTROL, CONTENT_TYPE},
    Method, Request, Response, StatusCode,
};
use urlencoding::decode;

pub const LOCAL_RESOURCE_SCHEME: &str = "latotex-resource";
const DRAWIO_ROUTE_PREFIX: &str = "/tool/drawio";
const WORKSPACE_FILE_ROUTE_PREFIX: &str = "/workspace-file";
const REQUIRED_DRAWIO_ASSETS: [&str; 19] = [
    "index.html",
    "drawio-version.json",
    "vendor/index.html",
    "vendor/js/app.min.js",
    "vendor/js/bootstrap.js",
    "vendor/js/extensions.min.js",
    "vendor/js/main.js",
    "vendor/js/PostConfig.js",
    "vendor/js/PreConfig.js",
    "vendor/js/shapes-14-6-5.min.js",
    "vendor/js/stencils.min.js",
    "vendor/math4/es5/startup.js",
    "vendor/mxgraph/css/common.css",
    "vendor/mxgraph/images/maximize.gif",
    "vendor/resources/dia.txt",
    "vendor/styles/high-contrast.css",
    "vendor/styles/grapheditor.css",
    "vendor/images/spin.gif",
    "vendor/images/github-logo.svg",
];

thread_local! {
    static LOCAL_RESOURCE_ORIGIN: RefCell<Option<String>> = const { RefCell::new(None) };
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

fn ensure_drawio_serving_dir(state: &AppState) -> Result<PathBuf, String> {
    if let Some(entry) = find_runtime_asset_entry(&state.runtime_root, "drawio") {
        if let Some(parent) = entry.parent() {
            if has_required_assets(parent, &["index.html", "vendor/index.html", "vendor/js/app.min.js"])
                || has_required_assets(parent, &["index.html", "js/app.min.js", "js/bootstrap.js"])
            {
                return Ok(parent.to_path_buf());
            }
        }
    }
    choose_existing_source_dir(&REQUIRED_DRAWIO_ASSETS, "drawio")
        .ok_or_else(|| "draw.runtimeAsset.required".to_string())
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

fn request_origin(request: &Request<Vec<u8>>) -> Option<String> {
    request
        .headers()
        .get("Origin")
        .and_then(|value| value.to_str().ok())
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
}

fn is_allowed_local_resource_origin(origin: &str) -> bool {
    let normalized = origin.trim().to_ascii_lowercase();
    normalized == "http://tauri.localhost"
        || normalized == "http://latotex-resource.localhost"
        || normalized.starts_with("http://localhost:")
        || normalized.starts_with("http://127.0.0.1:")
}

fn set_local_resource_origin(origin: Option<String>) {
    LOCAL_RESOURCE_ORIGIN.with(|slot| {
        *slot.borrow_mut() = origin;
    });
}

fn current_local_resource_origin() -> Option<String> {
    LOCAL_RESOURCE_ORIGIN.with(|slot| slot.borrow().clone())
}

fn apply_local_resource_headers(mut builder: tauri::http::response::Builder) -> tauri::http::response::Builder {
    builder = builder
        .header("Access-Control-Allow-Methods", "GET, HEAD, OPTIONS")
        .header("Access-Control-Allow-Headers", "Range, Content-Type")
        .header(
            "Access-Control-Expose-Headers",
            "Accept-Ranges, Content-Length, Content-Range, Content-Type, Cache-Control",
        )
        .header("Vary", "Origin");
    let origin = current_local_resource_origin();
    if let Some(allowed_origin) = origin
        .as_deref()
        .map(str::trim)
        .filter(|value| is_allowed_local_resource_origin(value))
    {
        builder = builder.header("Access-Control-Allow-Origin", allowed_origin);
    }
    builder
}

fn build_text_response(status: StatusCode, message: &str) -> Response<Vec<u8>> {
    let body = message.as_bytes().to_vec();
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, "text/plain; charset=utf-8")
        .header(CACHE_CONTROL, "no-store")
        .header("Content-Length", body.len().to_string());
    builder = apply_local_resource_headers(builder);
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
    builder = apply_local_resource_headers(builder);
    for (name, value) in extra_headers {
        builder = builder.header(*name, value);
    }
    builder
        .body(bytes.clone())
        .unwrap_or_else(|_| Response::new(bytes))
}

fn log_local_resource(state: &AppState, level: &str, message: &str) {
    state.log(level, &format!("local_resource: {message}"));
}

fn build_head_response(
    status: StatusCode,
    mime: &str,
    content_length: usize,
    extra_headers: &[(&str, String)],
) -> Response<Vec<u8>> {
    let mut builder = Response::builder()
        .status(status)
        .header(CONTENT_TYPE, mime)
        .header(CACHE_CONTROL, "no-store")
        .header("Accept-Ranges", "bytes")
        .header("Content-Length", content_length.to_string());
    builder = apply_local_resource_headers(builder);
    for (name, value) in extra_headers {
        builder = builder.header(*name, value);
    }
    builder
        .body(Vec::new())
        .unwrap_or_else(|_| Response::new(Vec::new()))
}

fn build_options_response() -> Response<Vec<u8>> {
    build_binary_response_with_headers(
        StatusCode::NO_CONTENT,
        "application/octet-stream",
        Vec::new(),
        &[],
    )
}

fn parse_byte_range(
    range_header: &str,
    total_len: usize,
) -> Result<Option<(usize, usize)>, String> {
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

fn read_workspace_file_bytes(path: &Path) -> Result<Vec<u8>, String> {
    fs::read(path).map_err(|e| e.to_string())
}

fn read_workspace_file_segment(path: &Path, start: usize, end: usize) -> Result<Vec<u8>, String> {
    let mut file = fs::File::open(path).map_err(|e| e.to_string())?;
    file.seek(SeekFrom::Start(start as u64))
        .map_err(|e| e.to_string())?;
    let len = end.saturating_sub(start).saturating_add(1);
    let mut buffer = vec![0_u8; len];
    file.read_exact(&mut buffer).map_err(|e| e.to_string())?;
    Ok(buffer)
}

fn workspace_file_response(
    method: &Method,
    asset_path: &Path,
    mime: &str,
    range_header: Option<&str>,
) -> Response<Vec<u8>> {
    let total_len = match fs::metadata(asset_path) {
        Ok(metadata) => metadata.len() as usize,
        Err(error) => {
            return build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    };

    if *method == Method::HEAD {
        return build_head_response(StatusCode::OK, mime, total_len, &[]);
    }

    let Some(range_value) = range_header
        .map(str::trim)
        .filter(|value| !value.is_empty())
    else {
        return match read_workspace_file_bytes(asset_path) {
            Ok(bytes) => build_binary_response(StatusCode::OK, mime, bytes),
            Err(error) => build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
        };
    };

    match parse_byte_range(range_value, total_len) {
        Ok(Some((start, end))) => match read_workspace_file_segment(asset_path, start, end) {
            Ok(partial) => {
                let content_range = format!("bytes {start}-{end}/{total_len}");
                build_binary_response_with_headers(
                    StatusCode::PARTIAL_CONTENT,
                    mime,
                    partial,
                    &[("Content-Range", content_range)],
                )
            }
            Err(error) => build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
        },
        Ok(None) => match read_workspace_file_bytes(asset_path) {
            Ok(bytes) => build_binary_response(StatusCode::OK, mime, bytes),
            Err(error) => build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error),
        },
        Err(error) if error == "resource.range.unsatisfiable" => {
            build_binary_response_with_headers(
                StatusCode::RANGE_NOT_SATISFIABLE,
                mime,
                Vec::new(),
                &[("Content-Range", format!("bytes */{total_len}"))],
            )
        }
        Err(error) => build_text_response(StatusCode::BAD_REQUEST, &error),
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

fn resolve_workspace_file_request(state: &AppState, request_path: &str) -> Result<PathBuf, String> {
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
    let safe_relative_path = normalize_workspace_relative_path(&relative_path)?;
    storage::resolve_project_relative_path(
        &state.db_path,
        &project_id,
        &safe_relative_path.to_string_lossy(),
    )
}

fn serve_workspace_file(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let request_path = request.uri().path();
    let asset_path = match resolve_workspace_file_request(state, request_path) {
        Ok(path) => path,
        Err(error) if error.starts_with("resource.") => {
            log_local_resource(
                state,
                "WARN",
                &format!(
                    "workspace-file request={} method={} rejected={}",
                    request_path,
                    request.method(),
                    error
                ),
            );
            return build_text_response(StatusCode::BAD_REQUEST, &error);
        }
        Err(error) => {
            log_local_resource(
                state,
                "ERROR",
                &format!(
                    "workspace-file request={} method={} resolve_failed={}",
                    request_path,
                    request.method(),
                    error
                ),
            );
            return build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
        }
    };
    if !asset_path.exists() || !asset_path.is_file() {
        log_local_resource(
            state,
            "WARN",
            &format!(
                "workspace-file request={} method={} resolved={} status=404",
                request_path,
                request.method(),
                asset_path.to_string_lossy()
            ),
        );
        return build_text_response(StatusCode::NOT_FOUND, "resource.asset_missing");
    }
    log_local_resource(
        state,
        "INFO",
        &format!(
            "workspace-file request={} method={} resolved={}",
            request_path,
            request.method(),
            asset_path.to_string_lossy()
        ),
    );
    workspace_file_response(
        request.method(),
        &asset_path,
        mime_type_for_path(&asset_path),
        request
            .headers()
            .get("range")
            .and_then(|value| value.to_str().ok()),
    )
}

fn serve_drawio_asset(state: &AppState, request: &Request<Vec<u8>>) -> Response<Vec<u8>> {
    let request_path = request.uri().path();
    let relative_path = match normalize_relative_asset_path(request_path) {
        Ok(path) => path,
        Err(error) => {
            log_local_resource(
                state,
                "WARN",
                &format!(
                    "drawio request={} method={} rejected={}",
                    request_path,
                    request.method(),
                    error
                ),
            );
            return build_text_response(StatusCode::BAD_REQUEST, &error);
        }
    };

    let root = match ensure_drawio_serving_dir(state) {
        Ok(dir) => dir,
        Err(error) => {
            log_local_resource(
                state,
                "ERROR",
                &format!(
                    "drawio request={} method={} resolve_failed={} candidates={}",
                    request_path,
                    request.method(),
                    error,
                    candidate_source_dirs("drawio")
                        .into_iter()
                        .map(|value| value.to_string_lossy().to_string())
                        .collect::<Vec<_>>()
                        .join(" | ")
                ),
            );
            return build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error);
        }
    };

    let asset_path = root.join(&relative_path);
    if !asset_path.exists() || !asset_path.is_file() {
        log_local_resource(
            state,
            "WARN",
            &format!(
                "drawio request={} method={} root={} resolved={} status=404",
                request_path,
                request.method(),
                root.to_string_lossy(),
                asset_path.to_string_lossy()
            ),
        );
        return build_text_response(StatusCode::NOT_FOUND, "resource.asset_missing");
    }

    match fs::read(&asset_path) {
        Ok(bytes) => {
            log_local_resource(
                state,
                "INFO",
                &format!(
                    "drawio request={} method={} root={} resolved={} status=200",
                    request_path,
                    request.method(),
                    root.to_string_lossy(),
                    asset_path.to_string_lossy()
                ),
            );
            build_binary_response(StatusCode::OK, mime_type_for_path(&asset_path), bytes)
        }
        Err(error) => {
            log_local_resource(
                state,
                "ERROR",
                &format!(
                    "drawio request={} method={} root={} resolved={} status=500 reason={}",
                    request_path,
                    request.method(),
                    root.to_string_lossy(),
                    asset_path.to_string_lossy(),
                    error
                ),
            );
            build_text_response(StatusCode::INTERNAL_SERVER_ERROR, &error.to_string())
        }
    }
}

pub fn handle_local_resource_request(
    state: &AppState,
    request: &Request<Vec<u8>>,
) -> Response<Vec<u8>> {
    set_local_resource_origin(request_origin(request));
    if request.method() == Method::OPTIONS {
        return build_options_response();
    }
    let path = request.uri().path();
    if path.starts_with(WORKSPACE_FILE_ROUTE_PREFIX) {
        return serve_workspace_file(state, request);
    }
    if path.starts_with(DRAWIO_ROUTE_PREFIX) {
        return serve_drawio_asset(state, request);
    }
    log_local_resource(
        state,
        "WARN",
        &format!(
            "request={} method={} status=404 reason=unsupported_route",
            path,
            request.method()
        ),
    );
    build_text_response(StatusCode::NOT_FOUND, "resource.not_found")
}

#[cfg(test)]
#[path = "local_resources_tests.rs"]
mod tests;
