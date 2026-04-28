use super::*;
use std::fs;
use std::path::{Component, Path, PathBuf};
use tiny_http::Method;

fn javascript_header() -> Header {
    Header::from_bytes("Content-Type", "application/javascript; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/javascript").unwrap())
}

fn css_header() -> Header {
    Header::from_bytes("Content-Type", "text/css; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "text/css").unwrap())
}

fn svg_header() -> Header {
    Header::from_bytes("Content-Type", "image/svg+xml; charset=utf-8")
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "image/svg+xml").unwrap())
}

fn content_type_header(value: &str) -> Header {
    Header::from_bytes("Content-Type", value)
        .unwrap_or_else(|_| Header::from_bytes("Content-Type", "application/octet-stream").unwrap())
}

fn static_text_response(
    content: &'static str,
    header: Header,
) -> Response<std::io::Cursor<Vec<u8>>> {
    share_http_response::with_share_headers(
        Response::from_string(content)
            .with_status_code(StatusCode(200))
            .with_header(header)
            .with_header(no_cache_header()),
    )
}

fn static_bytes_response(
    content: Vec<u8>,
    header: Header,
) -> Response<std::io::Cursor<Vec<u8>>> {
    share_http_response::with_share_headers(
        Response::from_data(content)
            .with_status_code(StatusCode(200))
            .with_header(header)
            .with_header(no_cache_header()),
    )
}

fn static_asset_bytes_response(
    content: &'static [u8],
    header: Header,
) -> Response<std::io::Cursor<Vec<u8>>> {
    static_bytes_response(content.to_vec(), header)
}

fn resolve_share_vendor_root() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/core/share-vendor")];
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources/core/share-vendor"));
            candidates.push(exe_dir.join("core/share-vendor"));
            candidates.push(exe_dir.join("../resources/core/share-vendor"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.exists())
}

fn resolve_share_page_root() -> Option<PathBuf> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/core/share-page")];
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources/core/share-page"));
            candidates.push(exe_dir.join("core/share-page"));
            candidates.push(exe_dir.join("../resources/core/share-page"));
        }
    }
    candidates.into_iter().find(|candidate| candidate.exists())
}

fn normalize_vendor_relative_path(request_path: &str) -> Result<PathBuf, String> {
    let relative = request_path
        .trim()
        .strip_prefix("/assets/vendor/")
        .ok_or_else(|| "share.vendor.invalid_path".to_string())?;
    if relative.is_empty() {
        return Err("share.vendor.invalid_path".to_string());
    }

    let mut output = PathBuf::new();
    for component in Path::new(relative).components() {
        match component {
            Component::Normal(value) => output.push(value),
            Component::CurDir => {}
            _ => return Err("share.vendor.invalid_path".to_string()),
        }
    }

    if output.as_os_str().is_empty() {
        return Err("share.vendor.invalid_path".to_string());
    }
    Ok(output)
}

fn vendor_header_for_path(path: &Path) -> Header {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default() {
        "js" | "mjs" => javascript_header(),
        "css" => css_header(),
        "json" => content_type_header("application/json; charset=utf-8"),
        "wasm" => content_type_header("application/wasm"),
        "map" => content_type_header("application/json; charset=utf-8"),
        _ => content_type_header("application/octet-stream"),
    }
}

fn share_page_header_for_path(path: &Path) -> Header {
    match path.extension().and_then(|value| value.to_str()).unwrap_or_default() {
        "html" => content_type_header("text/html; charset=utf-8"),
        "js" | "mjs" => javascript_header(),
        "css" => css_header(),
        _ => content_type_header("application/octet-stream"),
    }
}

fn try_vendor_response(path: &str) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
    let root = resolve_share_vendor_root()?;
    let relative = normalize_vendor_relative_path(path).ok()?;
    let absolute = root.join(relative);
    let bytes = fs::read(&absolute).ok()?;
    Some(static_bytes_response(bytes, vendor_header_for_path(&absolute)))
}

fn try_share_page_asset_response(path: &str) -> Option<Response<std::io::Cursor<Vec<u8>>>> {
    let root = resolve_share_page_root()?;
    let absolute = match path {
        "/" => root.join("index.html"),
        "/assets/share_page.js" => root.join("share_page.js"),
        "/assets/share_page.css" => root.join("share_page.css"),
        _ => return None,
    };
    let bytes = fs::read(&absolute).ok()?;
    Some(static_bytes_response(bytes, share_page_header_for_path(&absolute)))
}

pub(super) fn try_serve_static_route(
    method: &Method,
    path: &str,
    request: Request,
) -> Option<Request> {
    if *method == Method::Get && (path == "/favicon.ico" || path == "/assets/logo-icon-rounded.svg") {
        let _ = request.respond(static_asset_bytes_response(
            include_bytes!("../../../src/assets/branding/logo-icon-rounded.svg"),
            svg_header(),
        ));
        return None;
    }
    if *method != Method::Get {
        return Some(request);
    }
    if let Some(response) = try_share_page_asset_response(path) {
        let _ = request.respond(response);
        return None;
    }
    if path == "/" {
        let _ = request.respond(html_response(include_str!("share_page.html")));
        return None;
    }
    if let Some(response) = try_vendor_response(path) {
        let _ = request.respond(response);
        return None;
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
        "/assets/share_page_desktop.js" => Some(static_text_response(
            include_str!("share_page_desktop.js"),
            javascript_header(),
        )),
        "/assets/share_page_mobile.js" => Some(static_text_response(
            include_str!("share_page_mobile.js"),
            javascript_header(),
        )),
        "/assets/share_page_pdf.js" => Some(static_text_response(
            include_str!("share_page_pdf.js"),
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
        "/assets/share_page_editor.js" => Some(static_text_response(
            include_str!("share_page_editor.js"),
            javascript_header(),
        )),
        "/assets/share_page_utils.js" => Some(static_text_response(
            include_str!("share_page_utils.js"),
            javascript_header(),
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn share_page_header_supports_svg_assets() {
        let header = svg_header();

        assert!(header.field.equiv("Content-Type"));
        assert_eq!(header.value.as_str(), "image/svg+xml; charset=utf-8");
    }
}
