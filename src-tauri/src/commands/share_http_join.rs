use super::share_runtime_auth::{rate_limited_response, unauthorized_response};
use super::share_security::JoinAuthDecision;
use super::*;

pub(super) fn handle_join(mut request: Request, runtime: &Arc<Mutex<ShareRuntime>>) {
    let client_key = request
        .remote_addr()
        .map(|address| address.ip().to_string())
        .unwrap_or_else(|| "unknown".to_string());
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
    let expected_sid = guard.session_id.clone();
    let expected_password = guard.password.clone();
    match guard.join_attempt_limiter.verify(
        &client_key,
        Utc::now().timestamp(),
        &expected_sid,
        &expected_password,
        &body.sid,
        &body.pwd,
    ) {
        JoinAuthDecision::Authorized => {}
        JoinAuthDecision::Unauthorized => {
            let _ = request.respond(unauthorized_response());
            return;
        }
        JoinAuthDecision::RateLimited { retry_after_secs } => {
            let _ = request.respond(rate_limited_response(retry_after_secs));
            return;
        }
    }
    let username = normalize_share_username(&body.username);
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
            .filter(|character| character.is_ascii_alphanumeric())
            .take(16)
            .collect::<String>()
    );
    let participant_token = new_participant_token();
    upsert_participant(
        &mut guard,
        &participant_id,
        &username,
        Some("joined collaboration"),
    );
    if let Some(participant) = guard.participants.get_mut(&participant_id) {
        participant.auth_token = participant_token.clone();
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
}
