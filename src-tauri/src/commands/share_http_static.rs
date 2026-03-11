use super::*;
use tiny_http::Method;

fn javascript_header() -> Header {
    Header::from_bytes("Content-Type", "application/javascript; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/javascript").unwrap())
}

fn css_header() -> Header {
    Header::from_bytes("Content-Type", "text/css; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "text/css").unwrap())
}

fn static_text_response(content: &'static str, header: Header) -> Response<std::io::Cursor<Vec<u8>>> {
    Response::from_string(content)
        .with_status_code(StatusCode(200))
        .with_header(header)
        .with_header(no_cache_header())
}

pub(super) fn try_serve_static_route(
    method: &Method,
    path: &str,
    request: Request,
) -> Option<Request> {
    if *method == Method::Get && path == "/" {
        let _ = request.respond(html_response(include_str!("share_page.html")));
        return None;
    }
    if *method != Method::Get {
        return Some(request);
    }
    let maybe_content = match path {
        "/assets/share_page.js" => Some(static_text_response(
            include_str!("share_page_entry.js"),
            javascript_header(),
        )),
        "/assets/share_page_app.js" => Some(static_text_response(
            include_str!("share_page_app.js"),
            javascript_header(),
        )),
        "/assets/share_page_i18n.js" => Some(static_text_response(
            include_str!("share_page_i18n.js"),
            javascript_header(),
        )),
        "/assets/share_page_render.js" => Some(static_text_response(
            include_str!("share_page_render.js"),
            javascript_header(),
        )),
        "/assets/share_page_utils.js" => Some(static_text_response(
            include_str!("share_page_utils.js"),
            javascript_header(),
        )),
        "/assets/share_page_theme.css" => Some(static_text_response(
            include_str!("share_page_theme.css"),
            css_header(),
        )),
        "/assets/pico.min.css" => Some(static_text_response(
            include_str!("share_page_pico.min.css"),
            css_header(),
        )),
        _ => None,
    };
    if let Some(response) = maybe_content {
        let _ = request.respond(response);
        return None;
    }
    Some(request)
}
