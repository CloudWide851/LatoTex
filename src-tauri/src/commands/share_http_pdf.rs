use super::share_pdf::{persist_uploaded_pdf, share_pdf_ready};
use super::*;
use base64::engine::general_purpose::STANDARD as BASE64_STANDARD;
use base64::Engine;
use std::fs::File;

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
        share_http_response::with_share_cors(
            Response::from_file(file)
                .with_status_code(StatusCode(200))
                .with_header(pdf_header())
                .with_header(no_cache_header())
        ),
    );
}
