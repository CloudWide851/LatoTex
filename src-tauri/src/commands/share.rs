use crate::models::{Ack, ShareSessionCreateInput, ShareSessionInfo};
use crate::state::AppState;
use crate::storage;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use chrono::{Duration as ChronoDuration, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::net::TcpListener;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::State;
use tiny_http::{Header, Method, Request, Response, Server, StatusCode};
use uuid::Uuid;

const SHARE_TTL_HOURS: i64 = 24;
const MAX_SYNC_EVENTS_PER_PULL: usize = 400;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct ShareSyncEvent {
    seq: u64,
    from: String,
    update: String,
    created_at: String,
}

struct ShareRuntime {
    session_id: String,
    project_id: String,
    target_path: String,
    project_root: PathBuf,
    password: String,
    local_port: u16,
    local_url: String,
    tunnel_url: Option<String>,
    expires_at: String,
    expires_unix: i64,
    next_seq: u64,
    sync_events: Vec<ShareSyncEvent>,
    compile_requested: bool,
    pdf_bytes: Vec<u8>,
    stop_flag: Arc<AtomicBool>,
    cloudflared_child: Option<Child>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PushSyncBody {
    sid: String,
    pwd: String,
    client_id: String,
    update: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SessionBody {
    sid: String,
    pwd: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct UploadPdfBody {
    sid: String,
    pwd: String,
    pdf_base64: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct PullSyncResponse {
    next_cursor: u64,
    events: Vec<ShareSyncEvent>,
}

fn share_runtime_slot() -> &'static Mutex<Option<Arc<Mutex<ShareRuntime>>>> {
    static SLOT: OnceLock<Mutex<Option<Arc<Mutex<ShareRuntime>>>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}

fn json_header() -> Header {
    Header::from_bytes("Content-Type", "application/json; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/json").unwrap())
}

fn html_header() -> Header {
    Header::from_bytes("Content-Type", "text/html; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "text/html").unwrap())
}

fn pdf_header() -> Header {
    Header::from_bytes("Content-Type", "application/pdf")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/octet-stream").unwrap())
}

fn no_cache_header() -> Header {
    Header::from_bytes("Cache-Control", "no-store")
        .unwrap_or_else(|_| Header::from_bytes("Pragma", "no-cache").unwrap())
}

fn json_response(status: StatusCode, payload: serde_json::Value) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(payload.to_string())
        .with_status_code(status)
        .with_header(json_header())
        .with_header(no_cache_header())
}

fn html_response(content: &'static str) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(content)
        .with_status_code(StatusCode(200))
        .with_header(html_header())
        .with_header(no_cache_header())
}

fn split_url_path_query(url: &str) -> (String, HashMap<String, String>) {
    let mut query = HashMap::<String, String>::new();
    let mut parts = url.splitn(2, '?');
    let path = parts.next().unwrap_or("/").to_string();
    if let Some(raw_query) = parts.next() {
        for pair in raw_query.split('&') {
            let mut kv = pair.splitn(2, '=');
            let key = kv.next().unwrap_or("").trim();
            if key.is_empty() {
                continue;
            }
            let value = kv.next().unwrap_or("").trim();
            let decoded = urlencoding::decode(value)
                .map(|item| item.to_string())
                .unwrap_or_else(|_| value.to_string());
            query.insert(key.to_string(), decoded);
        }
    }
    (path, query)
}

fn parse_json_body<T: DeserializeOwned>(request: &mut Request) -> Result<T, String> {
    let mut raw = String::new();
    request
        .as_reader()
        .read_to_string(&mut raw)
        .map_err(|e| e.to_string())?;
    if raw.trim().is_empty() {
        return Err("empty request body".to_string());
    }
    serde_json::from_str::<T>(&raw).map_err(|e| e.to_string())
}

fn normalize_target_path(path: &str) -> String {
    path.replace('\\', "/").trim().to_string()
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn find_free_port() -> Result<u16, String> {
    let listener = TcpListener::bind("127.0.0.1:0").map_err(|e| e.to_string())?;
    let port = listener.local_addr().map_err(|e| e.to_string())?.port();
    drop(listener);
    Ok(port)
}

fn is_session_expired(runtime: &ShareRuntime) -> bool {
    Utc::now().timestamp() > runtime.expires_unix
}

fn build_session_info(runtime: &ShareRuntime) -> ShareSessionInfo {
    ShareSessionInfo {
        active: true,
        session_id: Some(runtime.session_id.clone()),
        project_id: Some(runtime.project_id.clone()),
        target_path: Some(runtime.target_path.clone()),
        local_url: Some(runtime.local_url.clone()),
        tunnel_url: runtime.tunnel_url.clone(),
        password: Some(runtime.password.clone()),
        expires_at: Some(runtime.expires_at.clone()),
    }
}

fn verify_query_auth(
    runtime: &ShareRuntime,
    query: &HashMap<String, String>,
) -> Result<(), Response<std::io::Cursor<Vec<u8>>>> {
    let sid_ok = query.get("sid").map(|value| value == &runtime.session_id).unwrap_or(false);
    let pwd_ok = query.get("pwd").map(|value| value == &runtime.password).unwrap_or(false);
    if sid_ok && pwd_ok {
        return Ok(());
    }
    Err(json_response(
        StatusCode(401),
        json!({ "ok": false, "message": "unauthorized" }),
    ))
}

fn verify_body_auth(
    runtime: &ShareRuntime,
    sid: &str,
    pwd: &str,
) -> Result<(), Response<std::io::Cursor<Vec<u8>>>> {
    if runtime.session_id == sid && runtime.password == pwd {
        return Ok(());
    }
    Err(json_response(
        StatusCode(401),
        json!({ "ok": false, "message": "unauthorized" }),
    ))
}

fn stop_runtime(runtime: &Arc<Mutex<ShareRuntime>>) {
    if let Ok(mut guard) = runtime.lock() {
        guard.stop_flag.store(true, Ordering::Relaxed);
        if let Some(child) = guard.cloudflared_child.as_mut() {
            let _ = child.kill();
        }
    }
}

fn swap_in_runtime(next: Arc<Mutex<ShareRuntime>>) {
    if let Ok(mut slot) = share_runtime_slot().lock() {
        if let Some(previous) = slot.take() {
            stop_runtime(&previous);
        }
        *slot = Some(next);
    }
}

fn clear_runtime() {
    if let Ok(mut slot) = share_runtime_slot().lock() {
        if let Some(previous) = slot.take() {
            stop_runtime(&previous);
        }
    }
}

fn serve_share_request(mut request: Request, runtime: &Arc<Mutex<ShareRuntime>>) {
    let method = request.method().clone();
    let (path, query) = split_url_path_query(request.url());

    let runtime_snapshot = if let Ok(guard) = runtime.lock() {
        guard
    } else {
        let _ = request.respond(json_response(
            StatusCode(500),
            json!({ "ok": false, "message": "runtime lock failed" }),
        ));
        return;
    };
    if is_session_expired(&runtime_snapshot) {
        let _ = request.respond(json_response(
            StatusCode(410),
            json!({ "ok": false, "message": "session expired" }),
        ));
        return;
    }
    drop(runtime_snapshot);

    if method == Method::Get && path == "/" {
        let _ = request.respond(html_response(include_str!("share_page.html")));
        return;
    }

    if method == Method::Get && path == "/api/health" {
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({ "ok": true, "now": now_iso() }),
        ));
        return;
    }

    if method == Method::Get && path == "/api/bootstrap" {
        let guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "sessionId": guard.session_id,
                "targetPath": guard.target_path,
                "expiresAt": guard.expires_at,
                "hasPdf": !guard.pdf_bytes.is_empty(),
            }),
        ));
        return;
    }

    if method == Method::Get && path == "/api/snapshot" {
        let guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_query_auth(&guard, &query) {
            let _ = request.respond(response);
            return;
        }
        let path = guard.project_root.join(&guard.target_path);
        let content = fs::read_to_string(path).unwrap_or_default();
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({ "ok": true, "content": content }),
        ));
        return;
    }

    if method == Method::Get && path == "/api/sync/pull" {
        let guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_query_auth(&guard, &query) {
            let _ = request.respond(response);
            return;
        }
        let cursor = query
            .get("cursor")
            .and_then(|value| value.parse::<u64>().ok())
            .unwrap_or(0);
        let selected: Vec<ShareSyncEvent> = guard
            .sync_events
            .iter()
            .filter(|event| event.seq > cursor)
            .take(MAX_SYNC_EVENTS_PER_PULL)
            .cloned()
            .collect();
        let next_cursor = selected
            .last()
            .map(|event| event.seq)
            .unwrap_or(cursor)
            .max(guard.next_seq.saturating_sub(1));
        let payload = PullSyncResponse {
            next_cursor,
            events: selected,
        };
        let _ = request.respond(json_response(
            StatusCode(200),
            serde_json::to_value(payload).unwrap_or_else(|_| json!({ "nextCursor": cursor, "events": [] })),
        ));
        return;
    }

    if method == Method::Post && path == "/api/sync/push" {
        let body = match parse_json_body::<PushSyncBody>(&mut request) {
            Ok(value) => value,
            Err(error) => {
                let _ = request.respond(json_response(
                    StatusCode(400),
                    json!({ "ok": false, "message": error }),
                ));
                return;
            }
        };
        let mut guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_body_auth(&guard, &body.sid, &body.pwd) {
            let _ = request.respond(response);
            return;
        }
        let seq = guard.next_seq;
        guard.next_seq = guard.next_seq.saturating_add(1);
        guard.sync_events.push(ShareSyncEvent {
            seq,
            from: body.client_id,
            update: body.update,
            created_at: now_iso(),
        });
        if guard.sync_events.len() > 4_000 {
            let drop_count = guard.sync_events.len().saturating_sub(3_200);
            guard.sync_events.drain(0..drop_count);
        }
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({ "ok": true, "seq": seq }),
        ));
        return;
    }

    if method == Method::Post && path == "/api/compile/request" {
        let body = match parse_json_body::<SessionBody>(&mut request) {
            Ok(value) => value,
            Err(error) => {
                let _ = request.respond(json_response(
                    StatusCode(400),
                    json!({ "ok": false, "message": error }),
                ));
                return;
            }
        };
        let mut guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_body_auth(&guard, &body.sid, &body.pwd) {
            let _ = request.respond(response);
            return;
        }
        guard.compile_requested = true;
        let _ = request.respond(json_response(StatusCode(200), json!({ "ok": true })));
        return;
    }

    if method == Method::Post && path == "/api/compile/take" {
        let body = match parse_json_body::<SessionBody>(&mut request) {
            Ok(value) => value,
            Err(error) => {
                let _ = request.respond(json_response(
                    StatusCode(400),
                    json!({ "ok": false, "message": error }),
                ));
                return;
            }
        };
        let mut guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_body_auth(&guard, &body.sid, &body.pwd) {
            let _ = request.respond(response);
            return;
        }
        let requested = guard.compile_requested;
        guard.compile_requested = false;
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({ "ok": true, "requested": requested }),
        ));
        return;
    }

    if method == Method::Post && path == "/api/pdf/upload" {
        let body = match parse_json_body::<UploadPdfBody>(&mut request) {
            Ok(value) => value,
            Err(error) => {
                let _ = request.respond(json_response(
                    StatusCode(400),
                    json!({ "ok": false, "message": error }),
                ));
                return;
            }
        };
        let mut guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_body_auth(&guard, &body.sid, &body.pwd) {
            let _ = request.respond(response);
            return;
        }
        let decoded = match BASE64_STANDARD.decode(body.pdf_base64.as_bytes()) {
            Ok(bytes) => bytes,
            Err(error) => {
                let _ = request.respond(json_response(
                    StatusCode(400),
                    json!({ "ok": false, "message": error.to_string() }),
                ));
                return;
            }
        };
        guard.pdf_bytes = decoded;
        let _ = request.respond(json_response(StatusCode(200), json!({ "ok": true })));
        return;
    }

    if method == Method::Get && path == "/api/pdf" {
        let guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_query_auth(&guard, &query) {
            let _ = request.respond(response);
            return;
        }
        if guard.pdf_bytes.is_empty() {
            let _ = request.respond(json_response(
                StatusCode(404),
                json!({ "ok": false, "message": "pdf not ready" }),
            ));
            return;
        }
        let _ = request.respond(
            Response::from_data(guard.pdf_bytes.clone())
                .with_status_code(StatusCode(200))
                .with_header(pdf_header())
                .with_header(no_cache_header()),
        );
        return;
    }

    let _ = request.respond(json_response(
        StatusCode(404),
        json!({ "ok": false, "message": "not found" }),
    ));
}

fn start_http_server(runtime: Arc<Mutex<ShareRuntime>>) -> Result<(), String> {
    let port = runtime
        .lock()
        .map_err(|_| "failed to lock share runtime".to_string())?
        .local_port;
    let server = Server::http(("127.0.0.1", port)).map_err(|e| e.to_string())?;
    thread::spawn(move || loop {
        let should_stop = runtime
            .lock()
            .map(|guard| guard.stop_flag.load(Ordering::Relaxed))
            .unwrap_or(true);
        if should_stop {
            break;
        }
        match server.recv_timeout(Duration::from_millis(260)) {
            Ok(Some(request)) => serve_share_request(request, &runtime),
            Ok(None) => continue,
            Err(_) => break,
        }
    });
    Ok(())
}

#[cfg(target_os = "windows")]
fn ensure_cloudflared_binary(runtime_root: &Path) -> Result<PathBuf, String> {
    let tool_dir = runtime_root.join("tools");
    fs::create_dir_all(&tool_dir).map_err(|e| e.to_string())?;
    let binary = tool_dir.join("cloudflared.exe");
    if binary.exists() {
        return Ok(binary);
    }
    let download_url =
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    let response = reqwest::blocking::get(download_url).map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "cloudflared download failed: {}",
            response.status()
        ));
    }
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    fs::write(&binary, &bytes).map_err(|e| e.to_string())?;
    Ok(binary)
}

#[cfg(target_os = "windows")]
fn start_cloud_tunnel(runtime_root: &Path, runtime: Arc<Mutex<ShareRuntime>>) {
    let binary = match ensure_cloudflared_binary(runtime_root) {
        Ok(path) => path,
        Err(_) => return,
    };
    let local_port = match runtime.lock() {
        Ok(guard) => guard.local_port,
        Err(_) => return,
    };
    let mut child = match Command::new(binary)
        .args([
            "tunnel",
            "--url",
            &format!("http://127.0.0.1:{local_port}"),
            "--no-autoupdate",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
    {
        Ok(process) => process,
        Err(_) => return,
    };
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Ok(mut guard) = runtime.lock() {
        guard.cloudflared_child = Some(child);
    }

    let apply_url = move |line: &str, runtime: &Arc<Mutex<ShareRuntime>>| {
        for token in line.split_whitespace() {
            if token.starts_with("https://") && token.contains("trycloudflare.com") {
                if let Ok(mut guard) = runtime.lock() {
                    if guard.tunnel_url.is_none() {
                        guard.tunnel_url = Some(token.trim().to_string());
                    }
                }
                break;
            }
        }
    };

    if let Some(stream) = stdout {
        let runtime_clone = runtime.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().flatten() {
                apply_url(&line, &runtime_clone);
            }
        });
    }
    if let Some(stream) = stderr {
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().flatten() {
                apply_url(&line, &runtime);
            }
        });
    }
}

#[cfg(not(target_os = "windows"))]
fn start_cloud_tunnel(_runtime_root: &Path, _runtime: Arc<Mutex<ShareRuntime>>) {}

#[tauri::command]
pub fn share_session_create(
    state: State<'_, AppState>,
    input: ShareSessionCreateInput,
) -> Result<ShareSessionInfo, String> {
    let target_path = normalize_target_path(&input.target_path);
    if !target_path.to_ascii_lowercase().ends_with(".tex") {
        return Err("share only supports current tex file".to_string());
    }
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let candidate = project_root.join(&target_path);
    if !candidate.exists() {
        return Err(format!("target file not found: {}", target_path));
    }
    let local_port = find_free_port()?;
    let session_id = Uuid::new_v4().simple().to_string();
    let password = Uuid::new_v4()
        .simple()
        .to_string()
        .chars()
        .take(8)
        .collect::<String>();
    let expires_at = (Utc::now() + ChronoDuration::hours(SHARE_TTL_HOURS)).to_rfc3339();
    let expires_unix = (Utc::now() + ChronoDuration::hours(SHARE_TTL_HOURS)).timestamp();
    let runtime = Arc::new(Mutex::new(ShareRuntime {
        session_id: session_id.clone(),
        project_id: input.project_id.clone(),
        target_path: target_path.clone(),
        project_root,
        password: password.clone(),
        local_port,
        local_url: format!("http://127.0.0.1:{local_port}/?sid={session_id}"),
        tunnel_url: None,
        expires_at: expires_at.clone(),
        expires_unix,
        next_seq: 1,
        sync_events: Vec::new(),
        compile_requested: false,
        pdf_bytes: Vec::new(),
        stop_flag: Arc::new(AtomicBool::new(false)),
        cloudflared_child: None,
    }));
    start_http_server(runtime.clone())?;
    start_cloud_tunnel(&state.runtime_root, runtime.clone());
    swap_in_runtime(runtime.clone());
    state.log(
        "INFO",
        &format!("share_session_create: project={}, target={}", input.project_id, target_path),
    );
    let info = runtime
        .lock()
        .map(|guard| build_session_info(&guard))
        .map_err(|_| "failed to lock share runtime".to_string())?;
    Ok(info)
}

#[tauri::command]
pub fn share_session_status(_state: State<'_, AppState>) -> Result<ShareSessionInfo, String> {
    let runtime = share_runtime_slot()
        .lock()
        .map_err(|_| "failed to lock share slot".to_string())?
        .clone();
    let Some(runtime) = runtime else {
        return Ok(ShareSessionInfo {
            active: false,
            session_id: None,
            project_id: None,
            target_path: None,
            local_url: None,
            tunnel_url: None,
            password: None,
            expires_at: None,
        });
    };
    let guard = runtime
        .lock()
        .map_err(|_| "failed to lock share runtime".to_string())?;
    if is_session_expired(&guard) {
        drop(guard);
        clear_runtime();
        return Ok(ShareSessionInfo {
            active: false,
            session_id: None,
            project_id: None,
            target_path: None,
            local_url: None,
            tunnel_url: None,
            password: None,
            expires_at: None,
        });
    }
    Ok(build_session_info(&guard))
}

#[tauri::command]
pub fn share_session_stop(state: State<'_, AppState>) -> Result<Ack, String> {
    clear_runtime();
    state.log("INFO", "share_session_stop");
    Ok(Ack {
        ok: true,
        message: "stopped".to_string(),
    })
}
