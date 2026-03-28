use super::share_http_auth::{verify_sync_body_auth, verify_sync_query_auth};
use super::*;
use tiny_http::Method;
pub(super) fn serve_share_request(mut request: Request, runtime: &Arc<Mutex<ShareRuntime>>) {
    let method = request.method().clone();
    let (path, query) = split_url_path_query(request.url());
    if method == Method::Options {
        let _ = request.respond(share_http_response::share_options_response());
        return;
    }
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
    request = match share_http_static::try_serve_static_route(&method, &path, request) {
        Some(pending_request) => pending_request,
        None => return,
    };
    if method == Method::Get && path == "/api/health" {
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({ "ok": true, "now": now_iso() }),
        ));
        return;
    }
    if method == Method::Get && path == "/api/bootstrap" {
        let mut guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        prune_participants(&mut guard);
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "sessionId": guard.session_id,
                "targetPath": guard.target_path,
                "expiresAt": guard.expires_at,
                "hasPdf": share_pdf_ready(&guard),
                "pdfState": if share_pdf_ready(&guard) { "ready" } else { "empty" },
                "pdfUpdatedAt": guard.pdf_updated_at.clone(),
                "status": guard.status.clone(),
                "tunnelState": guard.tunnel_state.clone(),
                "tunnelError": guard.tunnel_error.clone(),
                "sessionName": guard.session_name.clone(),
                "sessionCreatedAt": guard.session_created_at.clone(),
                "participants": participant_public_list(&guard),
                "comments": guard.comments.clone(),
            }),
        ));
        return;
    }
    if method == Method::Post && path == "/api/join" {
        let body = match parse_json_body::<JoinBody>(&mut request) {
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
        let username = body.username.trim();
        if username.is_empty() {
            let _ = request.respond(json_response(
                StatusCode(400),
                json!({ "ok": false, "message": "username required" }),
            ));
            return;
        }
        let participant_id = format!(
            "p-{}",
            body.client_id
                .unwrap_or_else(|| Uuid::new_v4().simple().to_string())
                .chars()
                .filter(|ch| ch.is_ascii_alphanumeric())
                .take(16)
                .collect::<String>()
        );
        let participant_token = new_participant_token();
        upsert_participant(
            &mut guard,
            &participant_id,
            username,
            Some("joined collaboration"),
        );
        if let Some(item) = guard.participants.get_mut(&participant_id) {
            item.auth_token = participant_token.clone();
        }
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "participantId": participant_id,
                "participantToken": participant_token,
                "username": username,
                "participants": participant_public_list(&guard),
            }),
        ));
        return;
    }
    if method == Method::Post && path == "/api/presence/ping" {
        let body = match parse_json_body::<PresencePingBody>(&mut request) {
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
        if let Err(response) = verify_sync_body_auth(
            &guard,
            &body.sid,
            &body.pwd,
            Some(body.participant_id.as_str()),
            body.participant_token.as_deref(),
        ) {
            let _ = request.respond(response);
            return;
        }
        let username = guard
            .participants
            .get(&body.participant_id)
            .map(|item| item.username.clone())
            .unwrap_or_else(|| "Guest".to_string());
        upsert_participant(
            &mut guard,
            &body.participant_id,
            &username,
            body.action.as_deref(),
        );
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "participants": participant_public_list(&guard),
            }),
        ));
        return;
    }
    if method == Method::Get && path == "/api/presence/list" {
        let mut guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_sync_query_auth(&guard, &query) {
            let _ = request.respond(response);
            return;
        }
        prune_participants(&mut guard);
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "participants": participant_public_list(&guard),
            }),
        ));
        return;
    }
    if method == Method::Get && path == "/api/comments/list" {
        let guard = if let Ok(runtime_guard) = runtime.lock() {
            runtime_guard
        } else {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": "runtime lock failed" }),
            ));
            return;
        };
        if let Err(response) = verify_sync_query_auth(&guard, &query) {
            let _ = request.respond(response);
            return;
        }
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "sessionName": guard.session_name.clone(),
                "sessionCreatedAt": guard.session_created_at.clone(),
                "comments": guard.comments.clone(),
            }),
        ));
        return;
    }
    if method == Method::Post && path == "/api/comments/post" {
        let body = match parse_json_body::<CommentPostBody>(&mut request) {
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
        if let Err(response) = verify_sync_body_auth(
            &guard,
            &body.sid,
            &body.pwd,
            body.participant_id.as_deref(),
            body.participant_token.as_deref(),
        ) {
            let _ = request.respond(response);
            return;
        }
        if let Some(pid) = body.participant_id.as_deref() {
            let username = body
                .username
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|value| value.to_string())
                .or_else(|| {
                    guard
                        .participants
                        .get(pid)
                        .map(|item| item.username.clone())
                })
                .unwrap_or_else(|| "Guest".to_string());
            upsert_participant(&mut guard, pid, &username, Some("commenting"));
        }
        let appended = match append_share_comment(&mut guard, &body) {
            Ok(item) => item,
            Err(error) => {
                let _ = request.respond(json_response(
                    StatusCode(400),
                    json!({ "ok": false, "message": error }),
                ));
                return;
            }
        };
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "comment": appended,
                "sessionName": guard.session_name.clone(),
                "sessionCreatedAt": guard.session_created_at.clone(),
                "comments": guard.comments.clone(),
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
        if let Err(response) = verify_sync_query_auth(&guard, &query) {
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
        if let Err(response) = verify_sync_query_auth(&guard, &query) {
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
            serde_json::to_value(payload)
                .unwrap_or_else(|_| json!({ "nextCursor": cursor, "events": [] })),
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
        if let Err(response) = verify_sync_body_auth(
            &guard,
            &body.sid,
            &body.pwd,
            body.participant_id.as_deref(),
            body.participant_token.as_deref(),
        ) {
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
        let participant_id = body
            .participant_id
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("desktop-owner");
        let participant_name = body
            .username
            .as_deref()
            .map(|value| value.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("Desktop");
        upsert_participant(
            &mut guard,
            participant_id,
            participant_name,
            body.action.as_deref().or(Some("editing")),
        );
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
        share_http_pdf::handle_pdf_upload(request, runtime);
        return;
    }
    if method == Method::Get && path == "/api/pdf/status" {
        share_http_pdf::handle_pdf_status(request, runtime, &query);
        return;
    }
    if method == Method::Get && path == "/api/pdf" {
        share_http_pdf::handle_pdf_fetch(request, runtime, &query);
        return;
    }
    let _ = request.respond(json_response(
        StatusCode(404),
        json!({ "ok": false, "message": "not found" }),
    ));
}
