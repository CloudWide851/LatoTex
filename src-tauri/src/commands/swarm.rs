#[path = "swarm_pipeline.rs"]
mod swarm_pipeline;

use crate::models::{
    AgentRunAccepted, AgentRunRequest, AgentRunStartAccepted, CompileRecord, CompileRecordInput, EventBatch, EventQuery,
};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::sync::Arc;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::thread;
use std::time::Duration;
use tauri::State;
use uuid::Uuid;

const AGENT_RETRY_MAX: u32 = 3;
const AGENT_CACHE_TTL_SECONDS: i64 = 30 * 60;
const AGENT_MAX_CONCURRENT: u32 = 4;

struct AgentRunSlotGuard {
    slots: Arc<(std::sync::Mutex<u32>, std::sync::Condvar)>,
}

impl Drop for AgentRunSlotGuard {
    fn drop(&mut self) {
        let (lock, cvar) = &*self.slots;
        if let Ok(mut current) = lock.lock() {
            *current = current.saturating_sub(1);
            cvar.notify_one();
        }
    }
}

fn acquire_agent_slot(state: &AppState) -> Result<AgentRunSlotGuard, String> {
    let slots = state.agent_slots.clone();
    let (lock, cvar) = &*slots;
    let mut current = lock.lock().map_err(|_| "failed to lock agent slots".to_string())?;
    while *current >= AGENT_MAX_CONCURRENT {
        current = cvar
            .wait(current)
            .map_err(|_| "failed to wait for agent slot".to_string())?;
    }
    *current = current.saturating_add(1);
    drop(current);
    Ok(AgentRunSlotGuard { slots })
}

struct ProviderError {
    message: String,
    retryable: bool,
}

fn hash_cache_key(
    role: &str,
    protocol_id: &str,
    model_name: &str,
    prompt: &str,
    context_refs: &[String],
) -> String {
    let mut hasher = DefaultHasher::new();
    role.hash(&mut hasher);
    protocol_id.hash(&mut hasher);
    model_name.hash(&mut hasher);
    prompt.hash(&mut hasher);
    context_refs.hash(&mut hasher);
    format!("{:x}", hasher.finish())
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

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| ProviderError {
        message: e.to_string(),
        retryable: false,
    })?;
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

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| ProviderError {
        message: e.to_string(),
        retryable: false,
    })?;
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

    let parsed: serde_json::Value = serde_json::from_str(&body).map_err(|e| ProviderError {
        message: e.to_string(),
        retryable: false,
    })?;
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
    let _slot_guard = acquire_agent_slot(&state)?;
    state.log(
        "INFO",
        &format!("agent_run: role={}, project={}", input.role, input.project_id),
    );
    let run_id = Uuid::new_v4().to_string();
    storage::append_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &input.role,
        "agent.run.accepted",
        json!({
            "prompt": input.prompt,
            "contextRefs": input.context_refs,
            "modelOverride": input.model_override
        }),
    )?;

    let (protocol_id, base_url, model_name, resolved_model_id) = storage::resolve_agent_model(
        &state.db_path,
        &input.role,
        input.model_override.as_deref(),
    )?;
    let secure_context = secure::SecureStorageContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
    };
    let api_key = secure::get_model_api_key(&secure_context, &resolved_model_id)?
        .api_key
        .ok_or_else(|| format!("API key is missing for model: {resolved_model_id}"))?;
    let full_prompt = if input.context_refs.is_empty() {
        input.prompt.clone()
    } else {
        format!(
            "{}\n\n[Context]\n{}",
            input.prompt,
            input.context_refs.join("\n")
        )
    };
    let cache_key = hash_cache_key(
        &input.role,
        &protocol_id,
        &model_name,
        &full_prompt,
        &input.context_refs,
    );

    if input.bypass_cache {
        storage::append_event(
            &state.db_path,
            &run_id,
            &input.project_id,
            &input.role,
            "agent.cache.bypass",
            json!({ "cacheKey": cache_key, "protocolId": protocol_id, "model": model_name }),
        )?;
    } else {
        if let Some(cached) = storage::load_agent_cache(&state.db_path, &cache_key)? {
            storage::append_event(
                &state.db_path,
                &run_id,
                &input.project_id,
                &input.role,
                "agent.cache.hit",
                json!({ "cacheKey": cache_key, "protocolId": protocol_id, "model": model_name }),
            )?;
            storage::append_event(
                &state.db_path,
                &run_id,
                &input.project_id,
                &input.role,
                "agent.run.completed",
                json!({ "output": cached, "cached": true }),
            )?;
            return Ok(AgentRunAccepted {
                run_id,
                status: "completed".to_string(),
                output: cached,
            });
        }
    }

    storage::append_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &input.role,
        "agent.cache.miss",
        json!({ "cacheKey": cache_key, "protocolId": protocol_id, "model": model_name }),
    )?;

    let output =
        call_provider_with_retry(&protocol_id, &base_url, &api_key, &model_name, &full_prompt)?;
    if !input.bypass_cache {
        storage::store_agent_cache(
            &state.db_path,
            &cache_key,
            &protocol_id,
            &model_name,
            &output,
            AGENT_CACHE_TTL_SECONDS,
        )?;
        storage::append_event(
            &state.db_path,
            &run_id,
            &input.project_id,
            &input.role,
            "agent.cache.store",
            json!({ "cacheKey": cache_key }),
        )?;
    }
    storage::append_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &input.role,
        "agent.run.completed",
        json!({
            "output": output
        }),
    )?;

    Ok(AgentRunAccepted {
        run_id,
        status: "completed".to_string(),
        output,
    })
}

#[tauri::command]
pub fn agent_run_start(
    state: State<'_, AppState>,
    input: AgentRunRequest,
) -> Result<AgentRunStartAccepted, String> {
    swarm_pipeline::agent_run_start(&state, input)
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
