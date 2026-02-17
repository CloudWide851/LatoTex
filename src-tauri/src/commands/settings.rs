use crate::models::{
    Ack, AppSettings, ModelApiKeySetInput, ModelTestInput, ModelTestResult, ProtocolHealth,
    ProtocolTestInput, RuntimeLogEntry, RuntimeLogInfo, RuntimeLogReadInput, RuntimeLogReadResponse,
    RuntimeLogWriteInput, SettingsUpdateInput,
};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use serde_json::json;
use std::fs;
use std::time::Duration;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.log("INFO", "settings_get");
    storage::load_settings(&state.db_path)
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    input: SettingsUpdateInput,
) -> Result<AppSettings, String> {
    state.log("INFO", "settings_update");
    storage::update_settings(&state.db_path, input)
}

#[tauri::command]
pub fn protocol_test(
    _state: State<'_, AppState>,
    input: ProtocolTestInput,
) -> Result<ProtocolHealth, String> {
    _state.log(
        "INFO",
        &format!(
            "protocol_test: protocol={}, baseUrl={}",
            input.protocol_id,
            input.base_url.as_deref().unwrap_or("-")
        ),
    );
    let base_url = input.base_url.clone().unwrap_or_default().trim().to_string();
    if base_url.is_empty() {
        return Ok(ProtocolHealth {
            protocol_id: input.protocol_id,
            ok: false,
            message: "Base URL is required".to_string(),
        });
    }

    let api_key = match input.api_key.as_deref().map(str::trim) {
        Some(value) if !value.is_empty() => Some(value.to_string()),
        _ => secure::get_api_key(&input.protocol_id)?,
    };

    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;

    let result = match input.protocol_id.as_str() {
        "anthropic" => probe_anthropic(&client, &base_url, api_key.as_deref()),
        "gemini" => probe_gemini(&client, &base_url, api_key.as_deref()),
        _ => probe_openai_compatible(&client, &base_url, api_key.as_deref()),
    };

    let (ok, message) = match result {
        Ok(status) => (true, format!("Link test passed ({status})")),
        Err(error) => (false, error),
    };

    Ok(ProtocolHealth {
        protocol_id: input.protocol_id,
        ok,
        message,
    })
}

#[tauri::command]
pub fn model_test(
    state: State<'_, AppState>,
    input: ModelTestInput,
) -> Result<ModelTestResult, String> {
    state.log("INFO", &format!("model_test: {}", input.model_id));
    let (protocol_id, base_url, request_name, api_key) =
        storage::resolve_model_test_connection(&state.db_path, &input.model_id)?;

    let client = Client::builder()
        .timeout(Duration::from_secs(18))
        .build()
        .map_err(|e| e.to_string())?;

    let result = call_model_generation_test(
        &client,
        &protocol_id,
        &base_url,
        &request_name,
        api_key.as_deref(),
    );

    let (ok, message) = match result {
        Ok(status) => (true, format!("Model test passed ({status})")),
        Err(error) => (false, error),
    };

    Ok(ModelTestResult {
        model_id: input.model_id,
        ok,
        message,
    })
}

#[tauri::command]
pub fn model_api_key_set(
    state: State<'_, AppState>,
    input: ModelApiKeySetInput,
) -> Result<Ack, String> {
    let model_id = input.model_id.trim();
    if model_id.is_empty() {
        return Err("Model id is required".to_string());
    }
    let api_key = input.api_key.trim();
    if api_key.is_empty() {
        secure::delete_model_api_key(model_id)?;
        state.log("INFO", &format!("model_api_key_set: cleared key for {model_id}"));
        return Ok(Ack {
            ok: true,
            message: "cleared".to_string(),
        });
    }

    secure::store_model_api_key(model_id, api_key)?;
    state.log("INFO", &format!("model_api_key_set: updated key for {model_id}"));
    Ok(Ack {
        ok: true,
        message: "stored".to_string(),
    })
}

fn is_success_status(status: StatusCode) -> bool {
    status.is_success()
}

fn probe_openai_compatible(
    client: &Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?;
    let normalized = base_url.trim_end_matches('/');
    let mut endpoints = vec![format!("{normalized}/models")];
    if !normalized.ends_with("/v1") {
        endpoints.push(format!("{normalized}/v1/models"));
    }

    let mut last_error = "No response".to_string();
    for endpoint in endpoints {
        match client.get(endpoint).bearer_auth(key).send() {
            Ok(response) => {
                let status = response.status();
                if is_success_status(status) {
                    return Ok(status);
                }
                last_error = format!("HTTP {status}");
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }
    }
    Err(last_error)
}

fn probe_anthropic(client: &Client, base_url: &str, api_key: Option<&str>) -> Result<StatusCode, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?;
    let normalized = base_url.trim_end_matches('/');
    let mut endpoints = vec![format!("{normalized}/v1/models")];
    if normalized.ends_with("/v1") {
        endpoints.push(format!("{normalized}/models"));
    }

    let mut last_error = "No response".to_string();
    for endpoint in endpoints {
        match client
            .get(endpoint)
            .header("x-api-key", key)
            .header("anthropic-version", "2023-06-01")
            .send()
        {
            Ok(response) => {
                let status = response.status();
                if is_success_status(status) {
                    return Ok(status);
                }
                last_error = format!("HTTP {status}");
            }
            Err(error) => {
                last_error = error.to_string();
            }
        }
    }
    Err(last_error)
}

fn probe_gemini(client: &Client, base_url: &str, api_key: Option<&str>) -> Result<StatusCode, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?;
    let normalized = base_url.trim_end_matches('/');
    let endpoint = format!("{normalized}/v1beta/models?key={key}");
    let response = client.get(endpoint).send().map_err(|e| e.to_string())?;
    let status = response.status();
    if is_success_status(status) {
        Ok(status)
    } else {
        Err(format!("HTTP {status}"))
    }
}

fn call_model_generation_test(
    client: &Client,
    protocol_id: &str,
    base_url: &str,
    model_name: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
    match protocol_id {
        "anthropic" => test_anthropic_model(client, base_url, model_name, api_key),
        "gemini" => test_gemini_model(client, base_url, model_name, api_key),
        _ => test_openai_model(client, base_url, model_name, api_key),
    }
}

fn test_openai_model(
    client: &Client,
    base_url: &str,
    model_name: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?;
    let endpoint = format!("{}/chat/completions", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .bearer_auth(key)
        .json(&json!({
            "model": model_name,
            "messages": [{ "role": "user", "content": "ping" }],
            "max_tokens": 8
        }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if is_success_status(status) {
        Ok(status)
    } else {
        let body = response.text().unwrap_or_default();
        Err(format!("HTTP {status}: {body}"))
    }
}

fn test_anthropic_model(
    client: &Client,
    base_url: &str,
    model_name: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?;
    let endpoint = format!("{}/v1/messages", base_url.trim_end_matches('/'));
    let response = client
        .post(endpoint)
        .header("x-api-key", key)
        .header("anthropic-version", "2023-06-01")
        .json(&json!({
            "model": model_name,
            "max_tokens": 8,
            "messages": [{ "role": "user", "content": "ping" }]
        }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if is_success_status(status) {
        Ok(status)
    } else {
        let body = response.text().unwrap_or_default();
        Err(format!("HTTP {status}: {body}"))
    }
}

fn test_gemini_model(
    client: &Client,
    base_url: &str,
    model_name: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?;
    let endpoint = format!(
        "{}/v1beta/models/{}:generateContent?key={}",
        base_url.trim_end_matches('/'),
        model_name,
        key,
    );
    let response = client
        .post(endpoint)
        .json(&json!({
            "contents": [{ "role": "user", "parts": [{ "text": "ping" }] }]
        }))
        .send()
        .map_err(|e| e.to_string())?;
    let status = response.status();
    if is_success_status(status) {
        Ok(status)
    } else {
        let body = response.text().unwrap_or_default();
        Err(format!("HTTP {status}: {body}"))
    }
}

#[tauri::command]
pub fn runtime_log_write(
    state: State<'_, AppState>,
    input: RuntimeLogWriteInput,
) -> Result<Ack, String> {
    let level = if input.level.trim().is_empty() {
        "INFO"
    } else {
        input.level.trim()
    };
    state.log(level, &input.message);
    Ok(Ack {
        ok: true,
        message: "logged".to_string(),
    })
}

#[tauri::command]
pub fn runtime_log_info(state: State<'_, AppState>) -> Result<RuntimeLogInfo, String> {
    Ok(RuntimeLogInfo {
        session_log_file: state.session_log_path.to_string_lossy().to_string(),
        logs_dir: state.logs_dir.to_string_lossy().to_string(),
        runtime_root: state.runtime_root.to_string_lossy().to_string(),
        install_mode: state.install_mode.clone(),
        version: state.app_version.clone(),
    })
}

fn parse_runtime_log_line(raw_line: &str) -> RuntimeLogEntry {
    let raw = raw_line.to_string();
    let mut timestamp = String::new();
    let mut level = "INFO".to_string();
    let mut message = raw_line.to_string();

    if raw_line.starts_with('[') {
        if let Some(ts_end) = raw_line.find(']') {
            timestamp = raw_line[1..ts_end].trim().to_string();
            let rest = raw_line[ts_end + 1..].trim_start();
            if rest.starts_with('[') {
                if let Some(level_end) = rest.find(']') {
                    let parsed_level = rest[1..level_end].trim();
                    if !parsed_level.is_empty() {
                        level = parsed_level.to_uppercase();
                    }
                    message = rest[level_end + 1..].trim_start().to_string();
                } else {
                    message = rest.to_string();
                }
            } else {
                message = rest.to_string();
            }
        }
    }

    RuntimeLogEntry {
        timestamp,
        level,
        message,
        raw,
    }
}

#[tauri::command]
pub fn runtime_log_read(
    state: State<'_, AppState>,
    input: RuntimeLogReadInput,
) -> Result<RuntimeLogReadResponse, String> {
    let max_limit = 5000_u32;
    let limit = input.limit.unwrap_or(500).clamp(1, max_limit) as usize;
    let content = fs::read_to_string(&state.session_log_path).map_err(|e| e.to_string())?;
    let mut entries: Vec<RuntimeLogEntry> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_runtime_log_line)
        .collect();
    if entries.len() > limit {
        let start = entries.len() - limit;
        entries = entries.split_off(start);
    }
    Ok(RuntimeLogReadResponse { entries })
}
