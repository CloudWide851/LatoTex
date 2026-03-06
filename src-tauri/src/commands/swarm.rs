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
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;

const AGENT_RETRY_MAX: u32 = 3;

struct ProviderError {
    message: String,
    retryable: bool,
}

fn parse_provider_json(body: &str, provider: &str) -> Result<serde_json::Value, ProviderError> {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return Err(ProviderError {
            message: format!("{provider} response body is empty"),
            retryable: true,
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
        let retryable = error_text.contains("EOF while parsing")
            || error_text.contains("expected value at line 1 column 1")
            || error_text.contains("expected value at line 1 column 0");
        ProviderError {
            message: format!(
                "{provider} response parse error: {error_text}; body_preview={compact_preview}"
            ),
            retryable,
        }
    })
}

fn should_retry(status: StatusCode) -> bool {
    status == StatusCode::TOO_MANY_REQUESTS || status.is_server_error()
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

fn call_openai_compatible(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(api_key)
        .json(&json!({
            "model": model_name,
            "messages": [{ "role": "user", "content": prompt }],
            "temperature": 0.2
        }))
        .send()
        .map_err(|e| ProviderError {
            message: e.to_string(),
            retryable: e.is_timeout() || e.is_connect(),
        })?;

    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(ProviderError {
            message: format!("OpenAI-compatible request failed: {status} {body}"),
            retryable: should_retry(status),
        });
    }

    let parsed = parse_provider_json(&body, "OpenAI-compatible")?;
    let content = parsed
        .get("choices")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("message"))
        .and_then(|v| v.get("content"))
        .and_then(extract_text_content)
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err(ProviderError {
            message: "Empty response from OpenAI-compatible endpoint".to_string(),
            retryable: false,
        });
    }
    Ok(content)
}

fn call_anthropic(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let endpoint = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .header("x-api-key", api_key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model_name,
            "max_tokens": 2048,
            "messages": [{ "role": "user", "content": prompt }]
        }))
        .send()
        .map_err(|e| ProviderError {
            message: e.to_string(),
            retryable: e.is_timeout() || e.is_connect(),
        })?;

    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(ProviderError {
            message: format!("Anthropic request failed: {status} {body}"),
            retryable: should_retry(status),
        });
    }

    let parsed = parse_provider_json(&body, "Anthropic")?;
    let content = parsed
        .get("content")
        .and_then(extract_text_content)
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err(ProviderError {
            message: "Empty response from Anthropic endpoint".to_string(),
            retryable: false,
        });
    }
    Ok(content)
}

fn call_gemini(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let endpoint = format!(
        "{}/v1beta/models/{}:generateContent?key={}",
        base_url.trim_end_matches('/'),
        model_name,
        api_key
    );
    let response = client
        .post(endpoint)
        .json(&json!({
            "contents": [{
                "role": "user",
                "parts": [{ "text": prompt }]
            }]
        }))
        .send()
        .map_err(|e| ProviderError {
            message: e.to_string(),
            retryable: e.is_timeout() || e.is_connect(),
        })?;

    let status = response.status();
    let body = response.text().unwrap_or_default();
    if !status.is_success() {
        return Err(ProviderError {
            message: format!("Gemini request failed: {status} {body}"),
            retryable: should_retry(status),
        });
    }

    let parsed = parse_provider_json(&body, "Gemini")?;
    let content = parsed
        .get("candidates")
        .and_then(|v| v.get(0))
        .and_then(|v| v.get("content"))
        .and_then(|v| v.get("parts"))
        .and_then(extract_text_content)
        .unwrap_or_default();
    if content.trim().is_empty() {
        return Err(ProviderError {
            message: "Empty response from Gemini endpoint".to_string(),
            retryable: false,
        });
    }
    Ok(content)
}

pub(crate) fn call_provider_with_retry(
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|e| e.to_string())?;

    let mut last_error = String::new();
    for attempt in 0..=AGENT_RETRY_MAX {
        let result = match protocol_id {
            "anthropic" => call_anthropic(&client, base_url, api_key, model_name, prompt),
            "gemini" => call_gemini(&client, base_url, api_key, model_name, prompt),
            _ => call_openai_compatible(&client, base_url, api_key, model_name, prompt),
        };

        match result {
            Ok(text) => return Ok(text),
            Err(error) => {
                last_error = error.message.clone();
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
    state.log(
        "DEBUG",
        &format!(
            "events_subscribe: cursor={:?}, limit={:?}, run_id={:?}",
            query.cursor, query.limit, query.run_id
        ),
    );
    storage::events_since(&state.db_path, query)
}
