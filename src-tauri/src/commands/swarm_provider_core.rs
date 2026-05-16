use super::swarm_provider_parse::{
    compact_body_preview, parse_line_delimited_json, parse_sse_json_body,
};
use reqwest::StatusCode;

pub(super) struct ProviderError {
    pub(super) code: &'static str,
    pub(super) message: String,
    pub(super) retryable: bool,
    pub(super) auto_repairable: bool,
}
impl ProviderError {
    pub(super) fn render(&self) -> String {
        format!("{}: {}", self.code, self.message)
    }
}

pub(super) struct StreamAttempt {
    pub(super) text: String,
}
pub(super) fn parse_provider_json(
    body: &str,
    provider: &str,
) -> Result<serde_json::Value, ProviderError> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(ProviderError {
            code: "provider.empty_body",
            message: format!("{provider} response body is empty"),
            retryable: true,
            auto_repairable: true,
        });
    }
    if let Some(parsed) = parse_sse_json_body(trimmed) {
        return Ok(parsed);
    }
    match serde_json::from_str(trimmed) {
        Ok(parsed) => Ok(parsed),
        Err(error) => {
            if let Some(parsed) = parse_line_delimited_json(trimmed) {
                return Ok(parsed);
            }
            let error_text = error.to_string();
            let compact_preview = compact_body_preview(trimmed);
            let parse_eof = error_text.contains("EOF while parsing")
                || error_text.contains("expected value at line 1 column 1")
                || error_text.contains("expected value at line 1 column 0");
            let html_body = compact_preview.starts_with("<!DOCTYPE")
                || compact_preview.starts_with("<html")
                || compact_preview.starts_with("{\"error\":\"<!DOCTYPE");
            let sse_body = trimmed.starts_with("data:") || trimmed.contains("\ndata:");
            let line_delimited = trimmed.lines().count() > 1;
            Err(ProviderError {
                code: if parse_eof {
                    "provider.parse_eof"
                } else {
                    "provider.parse_invalid_json"
                },
                message: format!(
                    "{provider} response parse error: {error_text}; body_preview={compact_preview}"
                ),
                retryable: parse_eof || html_body || sse_body || line_delimited,
                auto_repairable: parse_eof || html_body || sse_body || line_delimited,
            })
        }
    }
}
pub(super) fn should_retry(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}
pub(super) fn classify_http_error(provider: &str, status: StatusCode, body: &str) -> ProviderError {
    let normalized = body.to_ascii_lowercase();
    let unsupported_param = normalized.contains("unsupported")
        || normalized.contains("unknown parameter")
        || normalized.contains("additional property")
        || normalized.contains("not allowed");
    let endpoint_mismatch = status == StatusCode::NOT_FOUND
        || status == StatusCode::METHOD_NOT_ALLOWED
        || normalized.contains("not found")
        || normalized.contains("no route")
        || normalized.contains("unknown url");
    let code = if status == StatusCode::UNAUTHORIZED || status == StatusCode::FORBIDDEN {
        "provider.auth_failed"
    } else if status == StatusCode::TOO_MANY_REQUESTS {
        "provider.rate_limited"
    } else if endpoint_mismatch {
        "provider.endpoint_mismatch"
    } else if unsupported_param {
        "provider.unsupported_param"
    } else if status.is_server_error() {
        "provider.server_error"
    } else {
        "provider.http_error"
    };
    ProviderError {
        code,
        message: format!("{provider} request failed: {status} {body}"),
        retryable: should_retry(status),
        auto_repairable: endpoint_mismatch || unsupported_param,
    }
}
pub(super) fn extract_text_content(value: &serde_json::Value) -> Option<String> {
    if let Some(text) = value.as_str() {
        return Some(text.to_string());
    }
    if let Some(items) = value.as_array() {
        let mut merged = String::new();
        for item in items {
            if let Some(text) = item.get("text").and_then(|v| v.as_str()) {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(text);
            } else if let Some(text) = item.as_str() {
                if !merged.is_empty() {
                    merged.push('\n');
                }
                merged.push_str(text);
            }
        }
        if !merged.trim().is_empty() {
            return Some(merged);
        }
    }
    None
}
pub(super) fn is_reasoning_model(model_name: &str) -> bool {
    let lower = model_name.to_ascii_lowercase();
    lower.contains("think")
        || lower.contains("reason")
        || lower.contains("o1")
        || lower.contains("o3")
        || lower.contains("r1")
        || lower.contains("qwq")
}
pub(super) fn candidate_endpoints(base_url: &str, suffix: &str) -> Vec<String> {
    let normalized = base_url.trim_end_matches('/');
    let suffix = suffix.trim_start_matches('/');
    let mut out = Vec::new();
    out.push(format!("{normalized}/{suffix}"));
    if normalized.ends_with("/v1") {
        let without_v1 = normalized.trim_end_matches("/v1").trim_end_matches('/');
        if !without_v1.is_empty() {
            out.push(format!("{without_v1}/v1/{suffix}"));
        }
    } else {
        out.push(format!("{normalized}/v1/{suffix}"));
    }
    out.dedup();
    out
}
pub(super) fn candidate_gemini_endpoints(
    base_url: &str,
    model_name: &str,
    api_key: &str,
) -> Vec<String> {
    let normalized = base_url.trim_end_matches('/');
    let mut out = Vec::new();
    out.push(format!(
        "{normalized}/v1beta/models/{model_name}:generateContent?key={api_key}"
    ));
    if normalized.ends_with("/v1beta") {
        out.push(format!(
            "{normalized}/models/{model_name}:generateContent?key={api_key}"
        ));
    }
    out.dedup();
    out
}
pub(super) fn extract_openai_responses_content(parsed: &serde_json::Value) -> String {
    if let Some(text) = parsed.get("output_text").and_then(|value| value.as_str()) {
        return text.to_string();
    }
    if let Some(output) = parsed.get("output").and_then(|value| value.as_array()) {
        let mut merged = String::new();
        for item in output {
            if let Some(content) = item.get("content").and_then(|value| value.as_array()) {
                for block in content {
                    let text = block
                        .get("text")
                        .and_then(|value| value.as_str())
                        .or_else(|| block.get("output_text").and_then(|value| value.as_str()));
                    if let Some(value) = text {
                        if !merged.is_empty() {
                            merged.push('\n');
                        }
                        merged.push_str(value);
                    }
                }
            }
        }
        return merged;
    }
    String::new()
}
pub(super) fn transport_error(error: reqwest::Error) -> ProviderError {
    ProviderError {
        code: "provider.transport_error",
        message: error.to_string(),
        retryable: error.is_timeout() || error.is_connect(),
        auto_repairable: true,
    }
}

pub(super) fn consumer_error(message: String) -> ProviderError {
    ProviderError {
        code: "provider.stream_consumer_failed",
        message,
        retryable: false,
        auto_repairable: false,
    }
}

pub(super) fn stream_empty_output(provider: &str) -> ProviderError {
    ProviderError {
        code: "provider.empty_output",
        message: format!("Empty streamed response from {provider}"),
        retryable: true,
        auto_repairable: true,
    }
}
