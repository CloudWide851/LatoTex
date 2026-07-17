use super::share_runtime_auth::verify_bearer_auth;
use super::*;

pub(super) fn verify_request_query_auth(
    runtime: &ShareRuntime,
    request: &Request,
    query: &std::collections::HashMap<String, String>,
) -> Result<String, Response<std::io::Cursor<Vec<u8>>>> {
    let sid = query.get("sid").map(String::as_str).unwrap_or_default();
    let participant_id = query
        .get("participantId")
        .or_else(|| query.get("participant_id"))
        .map(String::as_str);
    verify_bearer_auth(runtime, request, sid, participant_id)
}

pub(super) fn verify_request_body_auth(
    runtime: &ShareRuntime,
    request: &Request,
    sid: &str,
    participant_id: Option<&str>,
) -> Result<String, Response<std::io::Cursor<Vec<u8>>>> {
    verify_bearer_auth(runtime, request, sid, participant_id)
}
