use super::*;
use std::cell::RefCell;
use tiny_http::{Request, Response};

thread_local! {
    static REQUEST_ORIGIN: RefCell<Option<String>> = const { RefCell::new(None) };
}

const SHARE_CORS_HEADERS: [(&str, &str); 5] = [
    ("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS"),
    (
        "Access-Control-Allow-Headers",
        "Authorization, Content-Type, Range",
    ),
    (
        "Access-Control-Expose-Headers",
        "Accept-Ranges, Content-Length, Content-Range, Content-Type, Cache-Control, ETag",
    ),
    ("Access-Control-Max-Age", "600"),
    ("Vary", "Origin"),
];

const SHARE_SECURITY_HEADERS: [(&str, &str); 4] = [
    ("X-Content-Type-Options", "nosniff"),
    ("Referrer-Policy", "no-referrer"),
    ("X-Frame-Options", "DENY"),
    (
        "Content-Security-Policy",
        "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; connect-src 'self'; font-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'",
    ),
];

fn share_header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value)
        .unwrap_or_else(|_| Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap())
}

fn normalize_origin(value: &str) -> String {
    value.trim().trim_end_matches('/').to_ascii_lowercase()
}

pub(super) fn allowed_share_origin(
    origin: Option<&str>,
    local_url: &str,
    tunnel_url: Option<&str>,
) -> Option<String> {
    let requested = origin
        .map(normalize_origin)
        .filter(|value| !value.is_empty())?;
    let mut allowed = vec![
        "http://tauri.localhost".to_string(),
        "http://latotex-resource.localhost".to_string(),
        normalize_origin(local_url),
    ];
    #[cfg(debug_assertions)]
    allowed.extend([
        "http://localhost:1420".to_string(),
        "http://127.0.0.1:1420".to_string(),
    ]);
    if let Some(tunnel) = tunnel_url {
        allowed.push(normalize_origin(tunnel));
    }
    allowed
        .iter()
        .any(|candidate| candidate == &requested)
        .then_some(requested)
}

pub(super) fn request_origin(request: &Request) -> Option<String> {
    request
        .headers()
        .iter()
        .find(|header| header.field.equiv("Origin"))
        .map(|header| header.value.as_str().trim().to_string())
        .filter(|value| !value.is_empty())
}

pub(super) fn set_request_origin(origin: Option<String>) {
    REQUEST_ORIGIN.with(|slot| {
        *slot.borrow_mut() = origin;
    });
}

fn current_request_origin() -> Option<String> {
    REQUEST_ORIGIN.with(|slot| slot.borrow().clone())
}

pub(super) fn with_share_cors_for_origin<T: std::io::Read + Send + 'static>(
    response: Response<T>,
    origin: Option<&str>,
) -> Response<T> {
    let response = SHARE_CORS_HEADERS
        .iter()
        .fold(response, |acc, (name, value)| {
            acc.with_header(share_header(name, value))
        });
    match origin.map(str::trim).filter(|value| !value.is_empty()) {
        Some(allowed_origin) => {
            response.with_header(share_header("Access-Control-Allow-Origin", allowed_origin))
        }
        None => response,
    }
}

pub(super) fn with_share_cors<T: std::io::Read + Send + 'static>(
    response: Response<T>,
) -> Response<T> {
    let origin = current_request_origin();
    with_share_cors_for_origin(response, origin.as_deref())
}

pub(super) fn with_share_security_headers<T: std::io::Read + Send + 'static>(
    response: Response<T>,
) -> Response<T> {
    SHARE_SECURITY_HEADERS
        .iter()
        .fold(response, |acc, (name, value)| {
            acc.with_header(share_header(name, value))
        })
}

pub(super) fn with_share_headers<T: std::io::Read + Send + 'static>(
    response: Response<T>,
) -> Response<T> {
    with_share_security_headers(with_share_cors(response))
}

pub(super) fn with_share_headers_for_origin<T: std::io::Read + Send + 'static>(
    response: Response<T>,
    origin: Option<&str>,
) -> Response<T> {
    with_share_security_headers(with_share_cors_for_origin(response, origin))
}

pub(super) fn share_options_response(origin: Option<&str>) -> Response<std::io::Cursor<Vec<u8>>> {
    with_share_headers_for_origin(
        Response::from_string("")
            .with_status_code(StatusCode(204))
            .with_header(no_cache_header()),
        origin,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_header<'a>(
        response: &'a Response<std::io::Cursor<Vec<u8>>>,
        name: &'static str,
    ) -> Option<&'a str> {
        response
            .headers()
            .iter()
            .find(|header| header.field.equiv(name))
            .map(|header| header.value.as_str())
    }

    #[test]
    fn options_response_includes_share_cors_headers_for_allowed_origin() {
        let allowed = allowed_share_origin(
            Some("http://127.0.0.1:43123"),
            "http://127.0.0.1:43123",
            None,
        );
        let response = share_options_response(allowed.as_deref());

        assert_eq!(response.status_code().0, 204);
        assert_eq!(
            find_header(&response, "Access-Control-Allow-Origin"),
            Some("http://127.0.0.1:43123")
        );
        assert_eq!(
            find_header(&response, "Access-Control-Allow-Methods"),
            Some("GET, HEAD, POST, OPTIONS")
        );
        assert_eq!(
            find_header(&response, "Access-Control-Allow-Headers"),
            Some("Authorization, Content-Type, Range")
        );
    }

    #[test]
    fn share_cors_wrapper_preserves_response_headers_without_wildcard_origin() {
        let allowed =
            allowed_share_origin(Some("https://evil.example"), "http://127.0.0.1:43123", None);
        let response = with_share_headers_for_origin(
            Response::from_string("ok")
                .with_status_code(StatusCode(200))
                .with_header(json_header())
                .with_header(no_cache_header()),
            allowed.as_deref(),
        );

        assert_eq!(
            find_header(&response, "Content-Type"),
            Some("application/json; charset=utf-8")
        );
        assert_eq!(find_header(&response, "Access-Control-Allow-Origin"), None);
        assert_eq!(
            find_header(&response, "X-Content-Type-Options"),
            Some("nosniff")
        );
    }

    #[test]
    fn share_cors_accepts_only_the_exact_active_tunnel_origin() {
        let tunnel = "https://exact-share.trycloudflare.com";
        let allowed = allowed_share_origin(Some(tunnel), "http://127.0.0.1:43123", Some(tunnel));
        let response = with_share_headers_for_origin(
            Response::from_string("ok").with_status_code(StatusCode(200)),
            allowed.as_deref(),
        );

        assert_eq!(
            find_header(&response, "Access-Control-Allow-Origin"),
            Some(tunnel)
        );
        assert_ne!(
            find_header(&response, "Access-Control-Allow-Origin"),
            Some("*")
        );
        assert_eq!(find_header(&response, "Vary"), Some("Origin"));

        assert_eq!(
            allowed_share_origin(
                Some("https://forged.trycloudflare.com"),
                "http://127.0.0.1:43123",
                Some(tunnel),
            ),
            None
        );
        assert_eq!(
            allowed_share_origin(
                Some("http://127.0.0.1:43124"),
                "http://127.0.0.1:43123",
                Some(tunnel),
            ),
            None
        );
    }

    #[test]
    fn share_headers_include_page_security_policy() {
        let response = with_share_headers(
            Response::from_string("<html></html>").with_status_code(StatusCode(200)),
        );

        assert_eq!(
            find_header(&response, "Referrer-Policy"),
            Some("no-referrer")
        );
        assert_eq!(find_header(&response, "X-Frame-Options"), Some("DENY"));
        assert!(find_header(&response, "Content-Security-Policy")
            .unwrap_or_default()
            .contains("frame-ancestors 'none'"));
    }
}
