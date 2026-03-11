use crate::models::{Ack, ShareParticipantInfo, ShareSessionCreateInput, ShareSessionInfo};
use crate::state::AppState;
use crate::storage;
use chrono::{Duration as ChronoDuration, Utc};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::json;
use std::collections::HashMap;
use std::fs;
use std::net::TcpListener;
use std::path::PathBuf;
use std::process::Child;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, OnceLock};
use std::thread;
use std::time::Duration;
use tauri::State;
use tiny_http::{Header, Request, Response, Server, StatusCode};
use uuid::Uuid;
#[path = "share_http_server.rs"]
mod share_http_server;
#[path = "share_tunnel.rs"]
mod share_tunnel;

const SHARE_TTL_HOURS: i64 = 24;
const MAX_SYNC_EVENTS_PER_PULL: usize = 400;
const SHARE_PARTICIPANT_IDLE_SECS: i64 = 120;

#[derive(Debug, Clone)]
struct ShareParticipantState {
    participant_id: String,
    username: String,
    auth_token: String,
    last_seen_at: String,
    last_seen_unix: i64,
    last_action: Option<String>,
}

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
    mode: String,
    password: String,
    local_port: u16,
    local_url: String,
    tunnel_url: Option<String>,
    status: String,
    tunnel_state: String,
    tunnel_error: Option<String>,
    expires_at: String,
    expires_unix: i64,
    next_seq: u64,
    sync_events: Vec<ShareSyncEvent>,
    participants: HashMap<String, ShareParticipantState>,
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
    participant_id: Option<String>,
    participant_token: Option<String>,
    username: Option<String>,
    action: Option<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct JoinBody {
    sid: String,
    pwd: String,
    client_id: Option<String>,
    username: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PresencePingBody {
    sid: String,
    pwd: String,
    participant_id: String,
    participant_token: Option<String>,
    action: Option<String>,
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

fn normalize_share_mode(mode: Option<String>) -> String {
    let normalized = mode
        .as_deref()
        .unwrap_or("remote")
        .trim()
        .to_ascii_lowercase();
    if normalized == "local" {
        "local".to_string()
    } else {
        "remote".to_string()
    }
}

fn now_iso() -> String {
    Utc::now().to_rfc3339()
}

fn new_participant_token() -> String {
    Uuid::new_v4().simple().to_string()
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

fn prune_participants(runtime: &mut ShareRuntime) {
    let cutoff = Utc::now().timestamp() - SHARE_PARTICIPANT_IDLE_SECS;
    runtime
        .participants
        .retain(|_, value| value.last_seen_unix >= cutoff);
}

fn upsert_participant(
    runtime: &mut ShareRuntime,
    participant_id: &str,
    username: &str,
    action: Option<&str>,
) {
    if participant_id.trim().is_empty() || username.trim().is_empty() {
        return;
    }
    let now_unix = Utc::now().timestamp();
    let now = now_iso();
    let next_action = action
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    if let Some(existing) = runtime.participants.get_mut(participant_id) {
        if !username.trim().is_empty() {
            existing.username = username.trim().to_string();
        }
        existing.last_seen_unix = now_unix;
        existing.last_seen_at = now;
        if next_action.is_some() {
            existing.last_action = next_action;
        }
    } else {
        runtime.participants.insert(
            participant_id.to_string(),
            ShareParticipantState {
                participant_id: participant_id.to_string(),
                username: username.trim().to_string(),
                auth_token: new_participant_token(),
                last_seen_unix: now_unix,
                last_seen_at: now,
                last_action: next_action,
            },
        );
    }
    prune_participants(runtime);
}

fn participant_public_list(runtime: &ShareRuntime) -> Vec<ShareParticipantInfo> {
    let mut participants: Vec<ShareParticipantInfo> = runtime
        .participants
        .values()
        .map(|item| ShareParticipantInfo {
            participant_id: item.participant_id.clone(),
            username: item.username.clone(),
            last_seen_at: item.last_seen_at.clone(),
            last_action: item.last_action.clone(),
        })
        .collect();
    participants.sort_by(|a, b| b.last_seen_at.cmp(&a.last_seen_at));
    participants
}

fn build_local_join_url(runtime: &ShareRuntime) -> String {
    if runtime.mode == "local" {
        format!(
            "{}/?sid={}&pwd={}",
            runtime.local_url,
            runtime.session_id,
            runtime.password
        )
    } else {
        format!("{}/?sid={}", runtime.local_url, runtime.session_id)
    }
}

fn build_remote_join_url(runtime: &ShareRuntime) -> Option<String> {
    let tunnel = runtime.tunnel_url.as_ref()?;
    Some(format!("{}/?sid={}", tunnel.trim_end_matches('/'), runtime.session_id))
}

fn build_active_join_url(runtime: &ShareRuntime) -> Option<String> {
    if runtime.mode == "local" {
        Some(build_local_join_url(runtime))
    } else {
        build_remote_join_url(runtime)
    }
}

fn build_session_info(runtime: &ShareRuntime) -> ShareSessionInfo {
    let local_join_url = build_local_join_url(runtime);
    let remote_join_url = build_remote_join_url(runtime);
    let active_join_url = build_active_join_url(runtime);
    ShareSessionInfo {
        active: runtime.status == "ready" && active_join_url.is_some(),
        session_id: Some(runtime.session_id.clone()),
        project_id: Some(runtime.project_id.clone()),
        target_path: Some(runtime.target_path.clone()),
        mode: Some(runtime.mode.clone()),
        local_url: Some(runtime.local_url.clone()),
        tunnel_url: runtime.tunnel_url.clone(),
        local_join_url: Some(local_join_url),
        remote_join_url,
        active_join_url,
        password_required: Some(runtime.mode != "local"),
        password: Some(runtime.password.clone()),
        expires_at: Some(runtime.expires_at.clone()),
        status: Some(runtime.status.clone()),
        tunnel_state: Some(runtime.tunnel_state.clone()),
        tunnel_error: runtime.tunnel_error.clone(),
        participants: participant_public_list(runtime),
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

fn verify_participant_auth(
    runtime: &ShareRuntime,
    participant_id: Option<&str>,
    participant_token: Option<&str>,
) -> bool {
    let Some(pid) = participant_id.map(|value| value.trim()).filter(|value| !value.is_empty()) else {
        return false;
    };
    let Some(token) = participant_token.map(|value| value.trim()).filter(|value| !value.is_empty()) else {
        return false;
    };
    runtime
        .participants
        .get(pid)
        .map(|item| item.auth_token == token)
        .unwrap_or(false)
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
            Ok(Some(request)) => share_http_server::serve_share_request(request, &runtime),
            Ok(None) => continue,
            Err(_) => break,
        }
    });
    Ok(())
}

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
    let mode = normalize_share_mode(input.mode.clone());
    let local_url = format!("http://127.0.0.1:{local_port}");
    let is_local_mode = mode == "local";
    let runtime = Arc::new(Mutex::new(ShareRuntime {
        session_id: session_id.clone(),
        project_id: input.project_id.clone(),
        target_path: target_path.clone(),
        project_root,
        mode,
        password: password.clone(),
        local_port,
        local_url,
        tunnel_url: None,
        status: if is_local_mode {
            "ready".to_string()
        } else {
            "starting".to_string()
        },
        tunnel_state: if is_local_mode {
            "ready".to_string()
        } else {
            "pending".to_string()
        },
        tunnel_error: None,
        expires_at: expires_at.clone(),
        expires_unix,
        next_seq: 1,
        sync_events: Vec::new(),
        participants: HashMap::new(),
        compile_requested: false,
        pdf_bytes: Vec::new(),
        stop_flag: Arc::new(AtomicBool::new(false)),
        cloudflared_child: None,
    }));
    start_http_server(runtime.clone())?;
    if !is_local_mode {
        share_tunnel::start_cloud_tunnel(&state.runtime_root, runtime.clone());
    }
    swap_in_runtime(runtime.clone());
    let mode_label = if is_local_mode { "local" } else { "remote" };
    state.log(
        "INFO",
        &format!(
            "share_session_create: project={}, target={}, mode={mode_label}",
            input.project_id, target_path
        ),
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
            mode: None,
            local_url: None,
            tunnel_url: None,
            local_join_url: None,
            remote_join_url: None,
            active_join_url: None,
            password_required: None,
            password: None,
            expires_at: None,
            status: None,
            tunnel_state: None,
            tunnel_error: None,
            participants: Vec::new(),
        });
    };
    let mut guard = runtime
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
            mode: None,
            local_url: None,
            tunnel_url: None,
            local_join_url: None,
            remote_join_url: None,
            active_join_url: None,
            password_required: None,
            password: None,
            expires_at: None,
            status: None,
            tunnel_state: None,
            tunnel_error: None,
            participants: Vec::new(),
        });
    }
    prune_participants(&mut guard);
    // Tunnel lifecycle is managed by the watchdog in `share_tunnel`.
    // Avoid aggressively marking the session as failed here to prevent
    // transient status polling races from tearing down an otherwise recoverable session.
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

