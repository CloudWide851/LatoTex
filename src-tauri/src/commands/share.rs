use crate::models::{
    Ack, ShareOwnerAuth, ShareOwnerAuthInput, ShareParticipantInfo, ShareSessionCreateInput,
    ShareSessionCreateResult, ShareSessionInfo, ShareSessionPasswordResult,
    ShareSessionSecretInput,
};
use crate::state::AppState;
use crate::storage;
use chrono::{Duration as ChronoDuration, Utc};
use serde::de::DeserializeOwned;
use serde::Serialize;
use serde_json::json;
use share_comments_store::{ShareCommentRecord, ShareCommentsStore};
use std::collections::HashMap;
use std::fs;
use std::io::Read;
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
#[path = "share_comments_store.rs"]
mod share_comments_store;
#[path = "share_http_auth.rs"]
mod share_http_auth;
#[path = "share_http_join.rs"]
mod share_http_join;
#[path = "share_http_pdf.rs"]
mod share_http_pdf;
#[path = "share_http_response.rs"]
mod share_http_response;
#[path = "share_http_server.rs"]
mod share_http_server;
#[path = "share_http_static.rs"]
mod share_http_static;
#[path = "share_limits.rs"]
mod share_limits;
#[path = "share_participants.rs"]
mod share_participants;
#[path = "share_payloads.rs"]
mod share_payloads;
#[path = "share_pdf.rs"]
mod share_pdf;
#[path = "share_runtime_auth.rs"]
mod share_runtime_auth;
#[path = "share_security.rs"]
mod share_security;
#[cfg(test)]
#[path = "share_tests.rs"]
mod share_tests;
#[path = "share_tunnel.rs"]
mod share_tunnel;
use share_http_response::with_share_headers;
use share_limits::*;
use share_participants::{
    participant_public_list, prune_participants, rotate_owner_auth, upsert_participant,
};
use share_payloads::*;
use share_pdf::share_pdf_ready;
use share_security::{new_share_password, resolve_share_target_path, JoinAttemptLimiter};
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
    participant_id: String,
    username: String,
    action: Option<String>,
    created_at: String,
}
struct ShareRuntime {
    session_id: String,
    session_name: Option<String>,
    session_created_at: String,
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
    owner_participant_id: String,
    participants: HashMap<String, ShareParticipantState>,
    join_attempt_limiter: JoinAttemptLimiter,
    compile_requested: bool,
    pdf_cache_path: Option<PathBuf>,
    pdf_size_bytes: u64,
    pdf_updated_at: Option<String>,
    last_sync_at: Option<String>,
    comments_store: ShareCommentsStore,
    comments: Vec<ShareCommentRecord>,
    stop_flag: Arc<AtomicBool>,
    cloudflared_child: Option<Child>,
}
fn share_runtime_slot() -> &'static Mutex<Option<Arc<Mutex<ShareRuntime>>>> {
    static SLOT: OnceLock<Mutex<Option<Arc<Mutex<ShareRuntime>>>>> = OnceLock::new();
    SLOT.get_or_init(|| Mutex::new(None))
}
fn json_header() -> Header {
    Header::from_bytes("Content-Type", "application/json; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/json").unwrap())
}
fn pdf_header() -> Header {
    Header::from_bytes("Content-Type", "application/pdf")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/octet-stream").unwrap())
}
fn no_cache_header() -> Header {
    Header::from_bytes("Cache-Control", "no-store")
        .unwrap_or_else(|_| Header::from_bytes("Pragma", "no-cache").unwrap())
}
fn json_response(
    status: StatusCode,
    payload: serde_json::Value,
) -> Response<std::io::Cursor<Vec<u8>>> {
    with_share_headers(
        Response::from_string(payload.to_string())
            .with_status_code(status)
            .with_header(json_header())
            .with_header(no_cache_header()),
    )
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
    if request.body_length().unwrap_or(0) as u64 > MAX_SHARE_JSON_BODY_BYTES {
        return Err("request body too large".to_string());
    }
    let mut raw = String::new();
    let mut reader = request.as_reader().take(MAX_SHARE_JSON_BODY_BYTES + 1);
    reader.read_to_string(&mut raw).map_err(|e| e.to_string())?;
    if raw.len() as u64 > MAX_SHARE_JSON_BODY_BYTES {
        return Err("request body too large".to_string());
    }
    if raw.trim().is_empty() {
        return Err("empty request body".to_string());
    }
    serde_json::from_str::<T>(&raw).map_err(|e| e.to_string())
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
fn normalize_session_name(value: Option<&str>) -> Option<String> {
    value
        .map(str::trim)
        .filter(|item| !item.is_empty())
        .map(|item| item.chars().take(120).collect())
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
fn build_public_join_url(base_url: &str, session_id: &str) -> String {
    format!("{}/?sid={}", base_url.trim_end_matches('/'), session_id)
}
fn build_local_join_url(runtime: &ShareRuntime) -> String {
    build_public_join_url(&runtime.local_url, &runtime.session_id)
}
fn build_remote_join_url(runtime: &ShareRuntime) -> Option<String> {
    let tunnel = runtime.tunnel_url.as_ref()?;
    Some(build_public_join_url(tunnel, &runtime.session_id))
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
        session_name: runtime.session_name.clone(),
        session_created_at: Some(runtime.session_created_at.clone()),
        project_id: Some(runtime.project_id.clone()),
        target_path: Some(runtime.target_path.clone()),
        mode: Some(runtime.mode.clone()),
        local_url: Some(runtime.local_url.clone()),
        tunnel_url: runtime.tunnel_url.clone(),
        local_join_url: Some(local_join_url),
        remote_join_url,
        active_join_url,
        password_required: Some(true),
        expires_at: Some(runtime.expires_at.clone()),
        status: Some(runtime.status.clone()),
        pdf_state: Some(if share_pdf_ready(runtime) {
            "ready".to_string()
        } else {
            "empty".to_string()
        }),
        pdf_updated_at: runtime.pdf_updated_at.clone(),
        sync_seq: Some(runtime.next_seq.saturating_sub(1)),
        sync_event_count: Some(runtime.sync_events.len() as u32),
        last_sync_at: runtime.last_sync_at.clone(),
        tunnel_state: Some(runtime.tunnel_state.clone()),
        tunnel_error: runtime.tunnel_error.clone(),
        participants: participant_public_list(runtime),
    }
}
fn inactive_share_session_info() -> ShareSessionInfo {
    ShareSessionInfo {
        active: false,
        session_id: None,
        session_name: None,
        session_created_at: None,
        project_id: None,
        target_path: None,
        mode: None,
        local_url: None,
        tunnel_url: None,
        local_join_url: None,
        remote_join_url: None,
        active_join_url: None,
        password_required: None,
        expires_at: None,
        status: None,
        pdf_state: None,
        pdf_updated_at: None,
        sync_seq: None,
        sync_event_count: None,
        last_sync_at: None,
        tunnel_state: None,
        tunnel_error: None,
        participants: Vec::new(),
    }
}
fn to_comment_json(
    body: &CommentPostBody,
    fallback_username: &str,
    session_name: Option<&str>,
    session_created_at: &str,
) -> serde_json::Value {
    json!({
        "id": body.id.as_deref().unwrap_or_default(),
        "username": normalize_share_username(body.username.as_deref().unwrap_or(fallback_username)),
        "text": normalize_share_comment_text(body.text.as_deref().unwrap_or_default()),
        "quote": normalize_share_comment_quote(body.quote.as_deref().unwrap_or_default()),
        "source": body.source.as_deref().unwrap_or("tex"),
        "sessionName": session_name.unwrap_or(""),
        "sessionCreatedAt": session_created_at,
        "page": body.page,
        "start": body.start,
        "end": body.end,
        "createdAt": body.created_at.as_deref().unwrap_or_default(),
    })
}
fn append_share_comment(
    runtime: &mut ShareRuntime,
    body: &CommentPostBody,
) -> Result<ShareCommentRecord, String> {
    let participant_name = body
        .participant_id
        .as_deref()
        .and_then(|pid| runtime.participants.get(pid))
        .map(|item| item.username.clone())
        .unwrap_or_else(|| "Guest".to_string());
    let comment_value = to_comment_json(
        body,
        &participant_name,
        runtime.session_name.as_deref(),
        &runtime.session_created_at,
    );
    let Some(comment) =
        share_comments_store::normalize_comment_value(&comment_value, &participant_name)
    else {
        return Err("comment text or quote required".to_string());
    };
    runtime.comments.push(comment.clone());
    runtime
        .comments
        .sort_by(|a, b| a.created_at.cmp(&b.created_at));
    if runtime.comments.len() > 1_200 {
        let trim = runtime.comments.len().saturating_sub(1_000);
        runtime.comments.drain(0..trim);
    }
    runtime
        .comments_store
        .persist_comments(&runtime.comments)
        .map_err(|error| format!("persist comments failed: {error}"))?;
    Ok(comment)
}
fn stop_runtime(runtime: &Arc<Mutex<ShareRuntime>>) {
    if let Ok(mut guard) = runtime.lock() {
        guard.stop_flag.store(true, Ordering::Relaxed);
        if let Some(child) = guard.cloudflared_child.as_mut() {
            let _ = child.kill();
        }
        if let Some(path) = guard.pdf_cache_path.take() {
            if matches!(storage::workspace_path_is_link_or_reparse(&path), Ok(false)) {
                let _ = fs::remove_file(path);
            }
        }
        guard.password.clear();
        guard.participants.clear();
        guard.join_attempt_limiter = JoinAttemptLimiter::new();
        guard.pdf_size_bytes = 0;
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
) -> Result<ShareSessionCreateResult, String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let (target_path, _) = resolve_share_target_path(&project_root, &input.target_path)?;
    let local_port = find_free_port()?;
    let session_id = Uuid::new_v4().simple().to_string();
    let password = new_share_password();
    let session_name = normalize_session_name(input.session_name.as_deref());
    let session_created_at = now_iso();
    let expires_at = (Utc::now() + ChronoDuration::hours(SHARE_TTL_HOURS)).to_rfc3339();
    let expires_unix = (Utc::now() + ChronoDuration::hours(SHARE_TTL_HOURS)).timestamp();
    let mode = normalize_share_mode(input.mode.clone());
    let local_url = format!("http://127.0.0.1:{local_port}");
    let is_local_mode = mode == "local";
    let owner_participant_id = format!("owner-{session_id}");
    let owner_token = new_participant_token();
    let owner_seen_at = now_iso();
    let mut participants = HashMap::new();
    participants.insert(
        owner_participant_id.clone(),
        ShareParticipantState {
            participant_id: owner_participant_id.clone(),
            username: "Desktop".to_string(),
            auth_token: owner_token.clone(),
            last_seen_at: owner_seen_at,
            last_seen_unix: Utc::now().timestamp(),
            last_action: Some("editing".to_string()),
        },
    );
    let comments_store = ShareCommentsStore::new(&project_root, &session_id)?;
    let comments = comments_store.load_comments();
    let runtime = Arc::new(Mutex::new(ShareRuntime {
        session_id: session_id.clone(),
        session_name,
        session_created_at,
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
        owner_participant_id: owner_participant_id.clone(),
        participants,
        join_attempt_limiter: JoinAttemptLimiter::new(),
        compile_requested: false,
        pdf_cache_path: None,
        pdf_size_bytes: 0,
        pdf_updated_at: None,
        last_sync_at: None,
        comments_store,
        comments,
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
    let session = runtime
        .lock()
        .map(|guard| build_session_info(&guard))
        .map_err(|_| "failed to lock share runtime".to_string())?;
    Ok(ShareSessionCreateResult {
        session,
        owner_auth: ShareOwnerAuth {
            participant_id: owner_participant_id,
            participant_token: owner_token,
        },
        password,
    })
}
#[tauri::command]
pub fn share_session_status(_state: State<'_, AppState>) -> Result<ShareSessionInfo, String> {
    let runtime = share_runtime_slot()
        .lock()
        .map_err(|_| "failed to lock share slot".to_string())?
        .clone();
    let Some(runtime) = runtime else {
        return Ok(inactive_share_session_info());
    };
    let mut guard = runtime
        .lock()
        .map_err(|_| "failed to lock share runtime".to_string())?;
    if is_session_expired(&guard) {
        drop(guard);
        clear_runtime();
        return Ok(inactive_share_session_info());
    }
    prune_participants(&mut guard);
    // Tunnel lifecycle is managed by the watchdog in `share_tunnel`.
    // Avoid aggressively marking the session as failed here to prevent
    // transient status polling races from tearing down an otherwise recoverable session.
    Ok(build_session_info(&guard))
}

#[tauri::command]
pub fn share_session_owner_auth(
    state: State<'_, AppState>,
    input: ShareOwnerAuthInput,
) -> Result<ShareOwnerAuth, String> {
    let runtime = share_runtime_slot()
        .lock()
        .map_err(|_| "share.runtime.lock_failed".to_string())?
        .clone()
        .ok_or_else(|| "share.session.inactive".to_string())?;
    let mut guard = runtime
        .lock()
        .map_err(|_| "share.runtime.lock_failed".to_string())?;
    if is_session_expired(&guard) {
        drop(guard);
        clear_runtime();
        return Err("share.session.expired".to_string());
    }
    if guard.session_id != input.session_id.trim() {
        return Err("share.session.mismatch".to_string());
    }
    let username = normalize_share_username(input.username.as_deref().unwrap_or("Desktop"));
    let owner_auth = rotate_owner_auth(&mut guard, &username);
    state.log("INFO", "share_session_owner_auth: owner token rotated");
    Ok(owner_auth)
}

#[tauri::command]
pub fn share_session_password_reveal(
    state: State<'_, AppState>,
    input: ShareSessionSecretInput,
) -> Result<ShareSessionPasswordResult, String> {
    let runtime = share_runtime_slot()
        .lock()
        .map_err(|_| "share.runtime.lock_failed".to_string())?
        .clone()
        .ok_or_else(|| "share.session.inactive".to_string())?;
    let guard = runtime
        .lock()
        .map_err(|_| "share.runtime.lock_failed".to_string())?;
    if is_session_expired(&guard) {
        drop(guard);
        clear_runtime();
        return Err("share.session.expired".to_string());
    }
    if guard.session_id != input.session_id.trim() {
        return Err("share.session.mismatch".to_string());
    }
    state.log("INFO", "share_session_password_reveal: explicit reveal");
    Ok(ShareSessionPasswordResult {
        password: guard.password.clone(),
    })
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
