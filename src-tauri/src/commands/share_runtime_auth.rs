use super::share_security::secrets_equal;
use super::*;

pub(super) fn unauthorized_response() -> Response<std::io::Cursor<Vec<u8>>> {
    json_response(
        StatusCode(401),
        json!({
            "ok": false,
            "code": "share.auth_failed",
            "message": "unauthorized",
        }),
    )
}

pub(super) fn rate_limited_response(retry_after_secs: u64) -> Response<std::io::Cursor<Vec<u8>>> {
    let retry_after = Header::from_bytes("Retry-After", retry_after_secs.to_string())
        .unwrap_or_else(|_| Header::from_bytes("Retry-After", "60").unwrap());
    json_response(
        StatusCode(429),
        json!({
            "ok": false,
            "code": "share.rate_limited",
            "message": "too many attempts",
        }),
    )
    .with_header(retry_after)
}

fn parse_bearer_value(raw: &str) -> Option<&str> {
    let raw = raw.trim();
    let (scheme, token) = raw.split_once(' ')?;
    if !scheme.eq_ignore_ascii_case("Bearer") || token.trim().is_empty() {
        return None;
    }
    Some(token.trim())
}

fn bearer_token(request: &Request) -> Option<&str> {
    let raw = request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Authorization"))?
        .value
        .as_str()
        .trim();
    parse_bearer_value(raw)
}

pub(super) fn verify_bearer_auth(
    runtime: &ShareRuntime,
    request: &Request,
    sid: &str,
    claimed_participant_id: Option<&str>,
) -> Result<String, Response<std::io::Cursor<Vec<u8>>>> {
    if !secrets_equal(&runtime.session_id, sid) {
        return Err(unauthorized_response());
    }
    let Some(token) = bearer_token(request) else {
        return Err(unauthorized_response());
    };
    let participant = runtime.participants.values().find(|participant| {
        secrets_equal(&participant.auth_token, token)
            && claimed_participant_id
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(|claimed| secrets_equal(&participant.participant_id, claimed))
                .unwrap_or(true)
    });
    participant
        .map(|item| item.participant_id.clone())
        .ok_or_else(unauthorized_response)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn bearer_parser_only_accepts_authorization_scheme_values() {
        assert_eq!(parse_bearer_value("Bearer token-1"), Some("token-1"));
        assert_eq!(parse_bearer_value("bearer token-2"), Some("token-2"));
        assert_eq!(parse_bearer_value("participantToken=secret"), None);
        assert_eq!(parse_bearer_value("Basic secret"), None);
    }
}
