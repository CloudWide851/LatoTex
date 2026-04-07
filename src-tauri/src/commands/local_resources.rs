use crate::state::AppState;
use crate::storage;
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use tauri::http::{
    header::{CACHE_CONTROL, CONTENT_TYPE},
    Method, Request, Response, StatusCode,
};
use urlencoding::decode;

pub const LOCAL_RESOURCE_SCHEME: &str = "latotex-resource";
const WORKSPACE_FILE_ROUTE_PREFIX: &str = "/workspace-file";

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
    for (name, value) in local_resource_header_values() {
        builder = builder.header(name, value);
    }
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
