use super::share_runtime_auth::{verify_body_auth, verify_participant_auth, verify_query_auth};
use super::*;

pub(super) fn verify_sync_query_auth(
    runtime: &ShareRuntime,
    query: &std::collections::HashMap<String, String>,
) -> Result<(), Response<std::io::Cursor<Vec<u8>>>> {
    let sid_ok = query
        .get("sid")
        .map(|value| value == &runtime.session_id)
        .unwrap_or(false);
    if !sid_ok {
        return Err(json_response(
            StatusCode(401),
            json!({ "ok": false, "message": "unauthorized" }),
        ));
    }
    let participant_id = query
        .get("participantId")
        .or_else(|| query.get("participant_id"))
        .map(|value| value.as_str());
    let participant_token = query
        .get("participantToken")
        .or_else(|| query.get("participant_token"))
        .map(|value| value.as_str());
    if verify_participant_auth(runtime, participant_id, participant_token) {
        return Ok(());
    }
    verify_query_auth(runtime, query)
}

pub(super) fn verify_sync_body_auth(
    runtime: &ShareRuntime,
    sid: &str,
    pwd: &str,
    participant_id: Option<&str>,
    participant_token: Option<&str>,
) -> Result<(), Response<std::io::Cursor<Vec<u8>>>> {
    if runtime.session_id != sid {
        return Err(json_response(
            StatusCode(401),
            json!({ "ok": false, "message": "unauthorized" }),
        ));
    }
    if verify_participant_auth(runtime, participant_id, participant_token) {
        return Ok(());
    }
    verify_body_auth(runtime, sid, pwd)
}
