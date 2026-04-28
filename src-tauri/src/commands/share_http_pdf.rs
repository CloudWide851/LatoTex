use super::share_pdf::{persist_uploaded_pdf, share_pdf_ready};
use super::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::fs::File;

fn share_pdf_version(updated_at: Option<&str>, size_bytes: u64) -> Option<String> {
    if size_bytes == 0 {
        return None;
    }
    let stamp = updated_at
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown");
    Some(format!("{stamp}-{size_bytes}"))
}

fn sanitize_etag_version(version: &str) -> String {
    version
        .chars()
        .filter(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.' | ':'))
        .collect::<String>()
}

fn pdf_cache_header() -> Header {
    Header::from_bytes("Cache-Control", "private, max-age=86400, immutable")
        .unwrap_or_else(|_| Header::from_bytes("Cache-Control", "private").unwrap())
}

fn pdf_etag_header(version: &str) -> Header {
    let value = format!("\"{}\"", sanitize_etag_version(version));
    Header::from_bytes("ETag", value)
        .unwrap_or_else(|_| Header::from_bytes("ETag", "\"share-pdf\"").unwrap())
}

pub(super) fn handle_pdf_upload(mut request: Request, runtime: &Arc<Mutex<ShareRuntime>>) {
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
    if body.pdf_base64.len() > MAX_SHARE_PDF_UPLOAD_BASE64_BYTES {
        let _ = request.respond(json_response(
            StatusCode(413),
            json!({ "ok": false, "message": "pdf upload too large" }),
        ));
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
    if let Err(error) = persist_uploaded_pdf(&mut guard, &decoded) {
        let _ = request.respond(json_response(
            StatusCode(500),
            json!({ "ok": false, "message": error }),
        ));
        return;
    }
    let _ = request.respond(json_response(StatusCode(200), json!({ "ok": true })));
}

pub(super) fn handle_pdf_status(
    request: Request,
    runtime: &Arc<Mutex<ShareRuntime>>,
    query: &std::collections::HashMap<String, String>,
) {
    let guard = if let Ok(runtime_guard) = runtime.lock() {
        runtime_guard
    } else {
        let _ = request.respond(json_response(
            StatusCode(500),
            json!({ "ok": false, "message": "runtime lock failed" }),
        ));
        return;
    };
    if let Err(response) = verify_query_auth(&guard, query) {
        let _ = request.respond(response);
        return;
    }
    let state = if share_pdf_ready(&guard) {
        "ready"
    } else {
        "empty"
    };
    let _ = request.respond(json_response(
        StatusCode(200),
        json!({
            "ok": true,
            "state": state,
            "sizeBytes": guard.pdf_size_bytes,
            "updatedAt": guard.pdf_updated_at.clone(),
            "version": share_pdf_version(guard.pdf_updated_at.as_deref(), guard.pdf_size_bytes),
        }),
    ));
}

pub(super) fn handle_pdf_fetch(
    request: Request,
    runtime: &Arc<Mutex<ShareRuntime>>,
    query: &std::collections::HashMap<String, String>,
) {
    let guard = if let Ok(runtime_guard) = runtime.lock() {
        runtime_guard
    } else {
        let _ = request.respond(json_response(
            StatusCode(500),
            json!({ "ok": false, "message": "runtime lock failed" }),
        ));
        return;
    };
    if let Err(response) = verify_query_auth(&guard, query) {
        let _ = request.respond(response);
        return;
    }
    if !share_pdf_ready(&guard) {
        let _ = request.respond(json_response(
            StatusCode(404),
            json!({ "ok": false, "message": "pdf not ready" }),
        ));
        return;
    }
    let pdf_path = guard.pdf_cache_path.clone();
    let version = share_pdf_version(guard.pdf_updated_at.as_deref(), guard.pdf_size_bytes)
        .unwrap_or_else(|| "unknown".to_string());
    drop(guard);
    let Some(pdf_path) = pdf_path else {
        let _ = request.respond(json_response(
            StatusCode(404),
            json!({ "ok": false, "message": "pdf not ready" }),
        ));
        return;
    };
    let file = match File::open(&pdf_path) {
        Ok(handle) => handle,
        Err(error) => {
            let _ = request.respond(json_response(
                StatusCode(500),
                json!({ "ok": false, "message": format!("pdf open failed: {error}") }),
            ));
            return;
        }
    };
    let _ = request.respond(
        share_http_response::with_share_headers(
            Response::from_file(file)
                .with_status_code(StatusCode(200))
                .with_header(pdf_header())
                .with_header(pdf_cache_header())
                .with_header(pdf_etag_header(&version))
        ),
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pdf_version_combines_timestamp_and_size() {
        assert_eq!(
            share_pdf_version(Some("2026-04-28T10:00:00Z"), 42),
            Some("2026-04-28T10:00:00Z-42".to_string())
        );
        assert_eq!(share_pdf_version(Some("ignored"), 0), None);
    }

    #[test]
    fn pdf_cache_header_allows_versioned_browser_cache() {
        let header = pdf_cache_header();

        assert!(header.field.equiv("Cache-Control"));
        assert_eq!(header.value.as_str(), "private, max-age=86400, immutable");
    }

    #[test]
    fn pdf_etag_sanitizes_header_value() {
        let header = pdf_etag_header("bad\"tag\\value");

        assert!(header.field.equiv("ETag"));
        assert_eq!(header.value.as_str(), "\"badtagvalue\"");
    }
}
