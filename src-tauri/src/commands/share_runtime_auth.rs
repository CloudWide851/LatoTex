use super::*;

pub(super) fn verify_query_auth(
    runtime: &ShareRuntime,
    query: &HashMap<String, String>,
) -> Result<(), Response<std::io::Cursor<Vec<u8>>>> {
    let sid_ok = query
        .get("sid")
        .map(|value| value == &runtime.session_id)
        .unwrap_or(false);
    let pwd_ok = query
        .get("pwd")
        .map(|value| value == &runtime.password)
        .unwrap_or(false);
    if sid_ok && pwd_ok {
        return Ok(());
    }
    Err(json_response(
        StatusCode(401),
        json!({ "ok": false, "message": "unauthorized" }),
    ))
}

pub(super) fn verify_body_auth(
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

pub(super) fn verify_participant_auth(
    runtime: &ShareRuntime,
    participant_id: Option<&str>,
    participant_token: Option<&str>,
) -> bool {
    let Some(pid) = participant_id
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    let Some(token) = participant_token
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    else {
        return false;
    };
    runtime
        .participants
        .get(pid)
        .map(|item| item.auth_token == token)
        .unwrap_or(false)
}
