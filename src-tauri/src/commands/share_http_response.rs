use super::*;
use tiny_http::Response;

const SHARE_CORS_HEADERS: [(&str, &str); 5] = [
    ("Access-Control-Allow-Origin", "*"),
    ("Access-Control-Allow-Methods", "GET, HEAD, POST, OPTIONS"),
    ("Access-Control-Allow-Headers", "Content-Type, Range"),
    (
        "Access-Control-Expose-Headers",
        "Accept-Ranges, Content-Length, Content-Range, Content-Type, Cache-Control",
    ),
    ("Access-Control-Max-Age", "600"),
];

fn share_header(name: &str, value: &str) -> Header {
    Header::from_bytes(name, value).unwrap_or_else(|_| Header::from_bytes(name.as_bytes(), value.as_bytes()).unwrap())
}

pub(super) fn with_share_cors<T: std::io::Read + Send + 'static>(response: Response<T>) -> Response<T> {
    SHARE_CORS_HEADERS
        .iter()
        .fold(response, |acc, (name, value)| acc.with_header(share_header(name, value)))
}

pub(super) fn share_options_response() -> Response<std::io::Cursor<Vec<u8>>> {
    with_share_cors(
        Response::from_string("")
            .with_status_code(StatusCode(204))
            .with_header(no_cache_header()),
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn find_header<'a>(response: &'a Response<std::io::Cursor<Vec<u8>>>, name: &'static str) -> Option<&'a str> {
        response
            .headers()
            .iter()
            .find(|header| header.field.equiv(name))
            .map(|header| header.value.as_str())
    }

    #[test]
    fn options_response_includes_share_cors_headers() {
        let response = share_options_response();

        assert_eq!(response.status_code().0, 204);
        assert_eq!(find_header(&response, "Access-Control-Allow-Origin"), Some("*"));
        assert_eq!(
            find_header(&response, "Access-Control-Allow-Methods"),
            Some("GET, HEAD, POST, OPTIONS")
        );
        assert_eq!(
            find_header(&response, "Access-Control-Allow-Headers"),
            Some("Content-Type, Range")
        );
    }

    #[test]
    fn share_cors_wrapper_preserves_response_headers() {
        let response = with_share_cors(
            Response::from_string("ok")
                .with_status_code(StatusCode(200))
                .with_header(json_header())
                .with_header(no_cache_header()),
        );

        assert_eq!(find_header(&response, "Content-Type"), Some("application/json; charset=utf-8"));
        assert_eq!(find_header(&response, "Access-Control-Allow-Origin"), Some("*"));
    }
}
