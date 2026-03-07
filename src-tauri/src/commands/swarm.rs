#[path = "swarm_pipeline.rs"]
mod swarm_pipeline;
#[path = "swarm_events.rs"]
mod swarm_events;
#[path = "swarm_tool_search.rs"]
mod swarm_tool_search;

use crate::models::{
    Ack, AgentRunAccepted, AgentRunCancelInput, AgentRunRequest, AgentRunStartAccepted,
    CompileRecord, CompileRecordInput, EventBatch, EventQuery,
};
use crate::state::AppState;
use crate::storage;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

const AGENT_RETRY_MAX: u32 = 3;
const AGENT_AUTO_REPAIR_MAX: u32 = 2;

struct ProviderError {
    code: &'static str,
    message: String,
    retryable: bool,
    auto_repairable: bool,
}

impl ProviderError {
    fn render(&self) -> String {
        format!("{}: {}", self.code, self.message)
    }
}

fn parse_provider_json(body: &str, provider: &str) -> Result<serde_json::Value, ProviderError> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(ProviderError {
            code: "provider.empty_body",
            message: format!("{provider} response body is empty"),
            retryable: true,
            auto_repairable: true,
        });
    }
    serde_json::from_str(trimmed).map_err(|error| {
        let error_text = error.to_string();
        let compact_preview = trimmed
            .replace('\n', " ")
            .replace('\r', " ")
            .chars()
            .take(260)
            .collect::<String>();
        let parse_eof = error_text.contains("EOF while parsing")
            || error_text.contains("expected value at line 1 column 1")
            || error_text.contains("expected value at line 1 column 0");
        let html_body = compact_preview.starts_with("<!DOCTYPE")
            || compact_preview.starts_with("<html")
            || compact_preview.starts_with("{\"error\":\"<!DOCTYPE");
        ProviderError {
            code: if parse_eof {
                "provider.parse_eof"
            } else {
                "provider.parse_invalid_json"
            },
            message: format!(
                "{provider} response parse error: {error_text}; body_preview={compact_preview}"
            ),
            retryable: parse_eof,
            auto_repairable: parse_eof || html_body,
        }
    })
}

fn should_retry(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
}

fn classify_http_error(provider: &str, status: StatusCode, body: &str) -> ProviderError {
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

fn extract_text_content(value: &serde_json::Value) -> Option<String> {
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

fn is_reasoning_model(model_name: &str) -> bool {
    let lower = model_name.to_ascii_lowercase();
    lower.contains("think")
        || lower.contains("reason")
        || lower.contains("o1")
        || lower.contains("o3")
        || lower.contains("r1")
        || lower.contains("qwq")
}

fn candidate_endpoints(base_url: &str, suffix: &str) -> Vec<String> {
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

fn candidate_gemini_endpoints(base_url: &str, model_name: &str, api_key: &str) -> Vec<String> {
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

fn extract_openai_responses_content(parsed: &serde_json::Value) -> String {
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

fn call_openai_chat(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": 0.2
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "messages": [{ "role": "user", "content": prompt }],
                "max_completion_tokens": 2200
            }),
        );
    }
    payloads.push(json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": prompt }]
    }));

    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_endpoints(base_url, "chat/completions") {
        for payload in &payloads {
            let response = client
                .post(&endpoint)
                .bearer_auth(api_key)
                .json(payload)
                .send()
                .map_err(|e| ProviderError {
                    code: "provider.transport_error",
                    message: e.to_string(),
                    retryable: e.is_timeout() || e.is_connect(),
                    auto_repairable: false,
                })?;
            let status = response.status();
            let body = response.text().unwrap_or_default();
            if !status.is_success() {
                let error = classify_http_error("OpenAI-compatible/chat", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            let parsed = parse_provider_json(&body, "OpenAI-compatible/chat")?;
            let content = parsed
                .get("choices")
                .and_then(|v| v.get(0))
                .and_then(|v| v.get("message"))
                .and_then(|v| v.get("content"))
                .and_then(extract_text_content)
                .unwrap_or_default();
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from OpenAI-compatible chat endpoint".to_string(),
                retryable: false,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI chat endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

fn call_openai_responses(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "model": model_name,
        "input": prompt,
        "temperature": 0.2,
        "max_output_tokens": 2200
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "input": prompt,
                "reasoning": { "effort": "medium" },
                "max_output_tokens": 2200
            }),
        );
    }
    payloads.push(json!({
        "model": model_name,
        "input": prompt,
        "max_output_tokens": 2200
    }));
    payloads.push(json!({
        "model": model_name,
        "input": prompt
    }));

    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_endpoints(base_url, "responses") {
        for payload in &payloads {
            let response = client
                .post(&endpoint)
                .bearer_auth(api_key)
                .json(payload)
                .send()
                .map_err(|e| ProviderError {
                    code: "provider.transport_error",
                    message: e.to_string(),
                    retryable: e.is_timeout() || e.is_connect(),
                    auto_repairable: false,
                })?;
            let status = response.status();
            let body = response.text().unwrap_or_default();
            if !status.is_success() {
                let error = classify_http_error("OpenAI-compatible/responses", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
            let parsed = parse_provider_json(&body, "OpenAI-compatible/responses")?;
            let content = extract_openai_responses_content(&parsed);
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from OpenAI-compatible responses endpoint".to_string(),
                retryable: false,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI responses endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

fn call_openai_compatible(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut last_error: Option<ProviderError> = None;
    let call_order: [fn(&Client, &str, &str, &str, &str) -> Result<String, ProviderError>; 2] =
        if reasoning {
            [call_openai_responses, call_openai_chat]
        } else {
            [call_openai_chat, call_openai_responses]
        };

    for call in call_order {
        match call(client, base_url, api_key, model_name, prompt) {
            Ok(value) => return Ok(value),
            Err(error) => {
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
        }
    }

    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI-compatible mode succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

fn call_anthropic(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "model": model_name,
        "max_tokens": 2048,
        "messages": [{ "role": "user", "content": prompt }]
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "max_tokens": 2048,
                "thinking": { "type": "enabled", "budget_tokens": 1024 },
                "messages": [{ "role": "user", "content": prompt }]
            }),
        );
    }

    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_endpoints(base_url, "messages") {
        for payload in &payloads {
            let response = client
                .post(&endpoint)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(payload)
                .send()
                .map_err(|e| ProviderError {
                    code: "provider.transport_error",
                    message: e.to_string(),
                    retryable: e.is_timeout() || e.is_connect(),
                    auto_repairable: false,
                })?;

            let status = response.status();
            let body = response.text().unwrap_or_default();
            if !status.is_success() {
                let error = classify_http_error("Anthropic", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            let parsed = parse_provider_json(&body, "Anthropic")?;
            let content = parsed
                .get("content")
                .and_then(extract_text_content)
                .unwrap_or_default();
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from Anthropic endpoint".to_string(),
                retryable: false,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible Anthropic endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

fn call_gemini(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048
        }
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": prompt }]
                }],
                "generationConfig": {
                    "maxOutputTokens": 2048
                }
            }),
        );
    }
    payloads.push(json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }]
    }));

    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_gemini_endpoints(base_url, model_name, api_key) {
        for payload in &payloads {
            let response = client
                .post(&endpoint)
                .json(payload)
                .send()
                .map_err(|e| ProviderError {
                    code: "provider.transport_error",
                    message: e.to_string(),
                    retryable: e.is_timeout() || e.is_connect(),
                    auto_repairable: false,
                })?;

            let status = response.status();
            let body = response.text().unwrap_or_default();
            if !status.is_success() {
                let error = classify_http_error("Gemini", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            let parsed = parse_provider_json(&body, "Gemini")?;
            let content = parsed
                .get("candidates")
                .and_then(|v| v.get(0))
                .and_then(|v| v.get("content"))
                .and_then(|v| v.get("parts"))
                .and_then(extract_text_content)
                .unwrap_or_default();
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from Gemini endpoint".to_string(),
                retryable: false,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible Gemini endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

fn cache_key(protocol_id: &str, base_url: &str, model_name: &str, prompt: &str) -> String {
    let mut hasher = DefaultHasher::new();
    protocol_id.hash(&mut hasher);
    base_url.hash(&mut hasher);
    model_name.hash(&mut hasher);
    prompt.hash(&mut hasher);
    format!("agent:{}:{:x}", protocol_id, hasher.finish())
}

pub(crate) fn call_provider_with_retry(
    db_path: Option<&Path>,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
    bypass_cache: bool,
) -> Result<String, String> {
    let key = cache_key(protocol_id, base_url, model_name, prompt);
    if !bypass_cache {
        if let Some(path) = db_path {
            if let Ok(Some(cached)) = storage::load_agent_cache(path, &key) {
                return Ok(cached);
            }
        }
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_error = String::new();
    let mut auto_repair_attempts = 0_u32;
    for attempt in 0..=AGENT_RETRY_MAX {
        let result = match protocol_id {
            "anthropic" => call_anthropic(&client, base_url, api_key, model_name, prompt),
            "gemini" => call_gemini(&client, base_url, api_key, model_name, prompt),
            _ => call_openai_compatible(&client, base_url, api_key, model_name, prompt),
        };

        match result {
            Ok(text) => {
                if !bypass_cache {
                    if let Some(path) = db_path {
                        let _ = storage::store_agent_cache(
                            path,
                            &key,
                            protocol_id,
                            model_name,
                            &text,
                            180,
                        );
                    }
                }
                return Ok(text);
            }
            Err(error) => {
                last_error = error.render();
                if error.auto_repairable && auto_repair_attempts < AGENT_AUTO_REPAIR_MAX {
                    auto_repair_attempts = auto_repair_attempts.saturating_add(1);
                    let delay_ms = 200_u64.saturating_mul(2_u64.pow(auto_repair_attempts));
                    thread::sleep(Duration::from_millis(delay_ms.min(1_600)));
                    continue;
                }
                if !error.retryable || attempt >= AGENT_RETRY_MAX {
                    break;
                }
                let delay_ms = 800_u64.saturating_mul(2_u64.pow(attempt));
                thread::sleep(Duration::from_millis(delay_ms.min(8_000)));
            }
        }
    }
    Err(last_error)
}

#[tauri::command]
pub fn latex_compile_record(
    state: State<'_, AppState>,
    input: CompileRecordInput,
) -> Result<CompileRecord, String> {
    state.log(
        "INFO",
        &format!(
            "latex_compile_record: project={}, file={}, status={}",
            input.project_id, input.main_file, input.status
        ),
    );
    storage::record_compile(&state.db_path, input)
}

#[tauri::command]
pub fn agent_run(
    state: State<'_, AppState>,
    input: AgentRunRequest,
) -> Result<AgentRunAccepted, String> {
    const WAIT_TIMEOUT: Duration = Duration::from_secs(260);
    const WAIT_INTERVAL: Duration = Duration::from_millis(240);

    state.log(
        "INFO",
        &format!(
            "agent_run(sync-through-start): role={}, project={}",
            input.role, input.project_id
        ),
    );
    let accepted = swarm_pipeline::agent_run_start(&state, input)?;
    let run_id = accepted.run_id.clone();
    let started_at = Instant::now();
    let mut cursor: i64 = 0;
    let mut fallback_output = String::new();

    loop {
        if started_at.elapsed() > WAIT_TIMEOUT {
            return Err("agent.run.timeout".to_string());
        }
        let batch = storage::events_since(
            &state.db_path,
            EventQuery {
                cursor: Some(cursor),
                limit: Some(240),
                run_id: Some(run_id.clone()),
                wait_ms: None,
            },
        )?;
        cursor = batch.next_cursor;

        for event in batch.events {
            let payload = event.payload;
            match event.kind.as_str() {
                "responses.output_text.delta" => {
                    if let Some(chunk) = payload.get("content").and_then(|value| value.as_str()) {
                        fallback_output.push_str(chunk);
                    }
                }
                "agent.run.completed" => {
                    let output = payload
                        .get("output")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                        .unwrap_or(fallback_output);
                    return Ok(AgentRunAccepted {
                        run_id,
                        status: "completed".to_string(),
                        output,
                    });
                }
                "agent.run.cancelled" => return Err("agent.run.cancelled".to_string()),
                "agent.run.failed" => {
                    let message = payload
                        .get("content")
                        .and_then(|value| value.as_str())
                        .filter(|value| !value.trim().is_empty())
                        .map(|value| value.to_string())
                        .or_else(|| {
                            payload
                                .get("message")
                                .and_then(|value| value.as_str())
                                .map(|value| value.to_string())
                        })
                        .unwrap_or_else(|| "agent.run.failed".to_string());
                    return Err(message);
                }
                _ => {}
            }
        }

        thread::sleep(WAIT_INTERVAL);
    }
}

#[tauri::command]
pub fn agent_run_start(
    state: State<'_, AppState>,
    input: AgentRunRequest,
) -> Result<AgentRunStartAccepted, String> {
    swarm_pipeline::agent_run_start(&state, input)
}

#[tauri::command]
pub fn agent_run_cancel(
    state: State<'_, AppState>,
    input: AgentRunCancelInput,
) -> Result<Ack, String> {
    let flags = state
        .agent_cancel_flags
        .lock()
        .map_err(|_| "failed to lock agent cancel flags".to_string())?;
    let flag = flags
        .get(&input.run_id)
        .ok_or_else(|| "agent run not found".to_string())?;
    flag.store(true, Ordering::Relaxed);
    state.log("INFO", &format!("agent_run_cancel requested: {}", input.run_id));
    Ok(Ack {
        ok: true,
        message: "cancelling".to_string(),
    })
}

#[tauri::command]
pub fn events_subscribe(state: State<'_, AppState>, query: EventQuery) -> Result<EventBatch, String> {
    let wait_ms = query.wait_ms.unwrap_or(0).min(4_000);
    let mut next_query = query;
    next_query.wait_ms = None;

    if wait_ms == 0 {
        return storage::events_since(&state.db_path, next_query);
    }

    let started = Instant::now();
    let wait_deadline = Duration::from_millis(wait_ms);
    loop {
        let batch = storage::events_since(&state.db_path, next_query.clone())?;
        if !batch.events.is_empty() || started.elapsed() >= wait_deadline {
            return Ok(batch);
        }
        thread::sleep(Duration::from_millis(120));
    }
}
