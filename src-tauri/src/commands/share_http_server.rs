use super::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use tiny_http::Method;

pub(super) fn serve_share_request(mut request: Request, runtime: &Arc<Mutex<ShareRuntime>>) {
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

    if method == Method::Get && path == "/assets/share_page.js" {
        let js_header = Header::from_bytes("Content-Type", "application/javascript; charset=utf-8")
            .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/javascript").unwrap());
        let _ = request.respond(
            Response::from_string(include_str!("share_page.js"))
                .with_status_code(StatusCode(200))
                .with_header(js_header)
                .with_header(no_cache_header()),
        );
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
                "hasPdf": !guard.pdf_bytes.is_empty(),
                "status": guard.status.clone(),
                "tunnelState": guard.tunnel_state.clone(),
                "tunnelError": guard.tunnel_error.clone(),
                "participants": participant_public_list(&guard),
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
        upsert_participant(
            &mut guard,
            &participant_id,
            username,
            Some("joined collaboration"),
        );
        let _ = request.respond(json_response(
            StatusCode(200),
            json!({
                "ok": true,
                "participantId": participant_id,
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
        if let Err(response) = verify_body_auth(&guard, &body.sid, &body.pwd) {
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
        if let Err(response) = verify_query_auth(&guard, &query) {
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


