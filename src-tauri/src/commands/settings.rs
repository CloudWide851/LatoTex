use crate::models::{
    Ack, AppSettings, ModelApiKeyGetInput, ModelApiKeySetInput, ModelApiKeyValue,
    ModelDraftTestInput, ModelTestInput, ModelTestResult, ProtocolHealth, ProtocolTestInput,
    RuntimeLogClearInput, RuntimeLogEntry, RuntimeLogInfo, RuntimeLogReadInput,
    RuntimeLogReadResponse, RuntimeLogWriteInput, SettingsUpdateInput,
};
use crate::commands::swarm::call_provider_with_retry;
use crate::secure;
use crate::state::AppState;
use crate::storage;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::time::Duration;
use tauri::State;
mod settings_keysave;
#[path = "settings_background.rs"]
mod settings_background;
#[path = "settings_memory.rs"]
mod settings_memory;
pub use settings_keysave::model_api_key_save_verified;
pub use settings_background::{
    settings_pick_background_image,
    settings_read_background_image,
    settings_remove_background_image,
};
pub use settings_memory::runtime_memory_snapshot;
#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.log("INFO", "settings_get");
    storage::load_settings(&state.db_path, &state.runtime_root)
}
#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    input: SettingsUpdateInput,
) -> Result<AppSettings, String> {
    state.log("INFO", "settings_update");
    storage::update_settings(&state.db_path, &state.runtime_root, input)
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
    let api_key = input
        .api_key
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| value.to_string());
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
        storage::resolve_model_test_connection(&state.db_path, &state.runtime_root, &input.model_id)?;
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
        Ok(output) => (
            true,
            format!(
                "Model test passed (received {} chars)",
                output.trim().chars().count()
            ),
        ),
        Err(error) => (false, error),
    };
    Ok(ModelTestResult {
        model_id: input.model_id,
        ok,
        message,
    })
}
#[tauri::command]
pub fn model_test_draft(
    state: State<'_, AppState>,
    input: ModelDraftTestInput,
) -> Result<ModelTestResult, String> {
    let protocol_id = input.protocol_id.trim();
    let base_url = input.base_url.trim();
    let request_name = input.request_name.trim();
    let api_key = input.api_key.trim();
    if protocol_id.is_empty() {
        return Err("Protocol id is required".to_string());
    }
    if base_url.is_empty() {
        return Err("Base URL is required".to_string());
    }
    if request_name.is_empty() {
        return Err("Model request name is required".to_string());
    }
    if api_key.is_empty() {
        return Err("API key is required".to_string());
    }
    state.log(
        "INFO",
        &format!("model_test_draft: protocol={protocol_id}, model={request_name}"),
    );
    let client = Client::builder()
        .timeout(Duration::from_secs(18))
        .build()
        .map_err(|e| e.to_string())?;
    let result = call_model_generation_test(
        &client,
        protocol_id,
        base_url,
        request_name,
        Some(api_key),
    );
    let (ok, message) = match result {
        Ok(output) => (
            true,
            format!(
                "Model test passed (received {} chars)",
                output.trim().chars().count()
            ),
        ),
        Err(error) => (false, error),
    };
    Ok(ModelTestResult {
        model_id: request_name.to_string(),
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
    let secure_context = secure::SecureStorageContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
    };
    if api_key.is_empty() {
        let outcome = secure::delete_model_api_key(&secure_context, model_id)?;
        state.log(
            "INFO",
            &format!(
                "model_api_key_set: cleared key for {model_id}, backend={}, diagnostic={}",
                outcome.backend,
                outcome.diagnostic_code.clone().unwrap_or_else(|| "-".to_string())
            ),
        );
        return Ok(Ack {
            ok: true,
            message: "cleared".to_string(),
        });
    }
    let outcome = secure::store_model_api_key(&secure_context, model_id, api_key)?;
    state.log(
        "INFO",
        &format!(
            "model_api_key_set: updated key for {model_id}, backend={}, diagnostic={}",
            outcome.backend,
            outcome.diagnostic_code.clone().unwrap_or_else(|| "-".to_string())
        ),
    );
    Ok(Ack {
        ok: true,
        message: "stored".to_string(),
    })
}
#[tauri::command]
pub fn model_api_key_get(
    state: State<'_, AppState>,
    input: ModelApiKeyGetInput,
) -> Result<ModelApiKeyValue, String> {
    let model_id = input.model_id.trim();
    if model_id.is_empty() {
        return Err("Model id is required".to_string());
    }
    let secure_context = secure::SecureStorageContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
    };
    let resolved = secure::get_model_api_key(&secure_context, model_id)?;
    let api_key = resolved.api_key.unwrap_or_default();
    let key_len = api_key.len();
    let has_key = key_len > 0;
    state.log(
        "INFO",
        &format!(
            "model_api_key_get: loaded key for {model_id}, has_key={has_key}, key_len={key_len}, source={}, diagnostic={}",
            resolved.source,
            resolved.diagnostic_code.clone().unwrap_or_else(|| "-".to_string())
        ),
    );
    Ok(ModelApiKeyValue {
        model_id: model_id.to_string(),
        api_key,
        source: resolved.source,
        diagnostic_code: resolved.diagnostic_code,
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
fn resolve_api_key(api_key: Option<&str>) -> Result<String, String> {
    let key = api_key
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "API key is required".to_string())?
        .to_string();
    Ok(key)
}
fn call_model_generation_test(
    _client: &Client,
    protocol_id: &str,
    base_url: &str,
    model_name: &str,
    api_key: Option<&str>,
) -> Result<String, String> {
    let key = resolve_api_key(api_key)?;
    call_provider_with_retry(
        None,
        protocol_id,
        base_url,
        &key,
        model_name,
        "ping",
        true,
    )
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
fn runtime_log_entry_matches(entry: &RuntimeLogEntry, input: &RuntimeLogReadInput) -> bool {
    if let Some(level) = input.level.as_deref() {
        let level = level.trim().to_uppercase();
        if !level.is_empty() && entry.level.to_uppercase() != level {
            return false;
        }
    }
    if let Some(keyword) = input.keyword.as_deref() {
        let keyword = keyword.trim().to_lowercase();
        if !keyword.is_empty() {
            let haystack = format!("{} {}", entry.message, entry.raw).to_lowercase();
            if !haystack.contains(&keyword) {
                return false;
            }
        }
    }
    if let Some(from_time) = input.from_time.as_deref() {
        let from_time = from_time.trim();
        if !from_time.is_empty() && !entry.timestamp.is_empty() && entry.timestamp.as_str() < from_time {
            return false;
        }
    }
    if let Some(to_time) = input.to_time.as_deref() {
        let to_time = to_time.trim();
        if !to_time.is_empty() && !entry.timestamp.is_empty() && entry.timestamp.as_str() > to_time {
            return false;
        }
    }
    true
}
fn input_has_runtime_log_filters(input: &RuntimeLogReadInput) -> bool {
    let has_non_empty = |value: &Option<String>| value.as_deref().map(str::trim).filter(|item| !item.is_empty()).is_some();
    has_non_empty(&input.level)
        || has_non_empty(&input.keyword)
        || has_non_empty(&input.from_time)
        || has_non_empty(&input.to_time)
}
fn read_last_log_lines(path: &std::path::Path, limit: usize) -> Result<Vec<String>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = match File::open(path) {
        Ok(handle) => handle,
        Err(_) => return Ok(Vec::new()),
    };
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();
    if file_len == 0 {
        return Ok(Vec::new());
    }
    let mut position = file_len;
    let mut newline_count = 0_usize;
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    const CHUNK_SIZE: u64 = 8192;
    while position > 0 && newline_count <= limit {
        let read_len = CHUNK_SIZE.min(position) as usize;
        position -= read_len as u64;
        file.seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let mut buffer = vec![0_u8; read_len];
        file.read_exact(&mut buffer).map_err(|e| e.to_string())?;
        newline_count += buffer.iter().filter(|byte| **byte == b'\n').count();
        chunks.push(buffer);
    }
    chunks.reverse();
    let mut bytes = Vec::new();
    for chunk in chunks {
        bytes.extend_from_slice(&chunk);
    }
    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<&str> = text.lines().collect();
    if position > 0 && !lines.is_empty() {
        lines.remove(0);
    }
    let mut collected = lines
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect::<Vec<_>>();
    if collected.len() > limit {
        let start = collected.len() - limit;
        collected = collected.split_off(start);
    }
    Ok(collected)
}
#[tauri::command]
pub fn runtime_log_read(
    state: State<'_, AppState>,
    input: RuntimeLogReadInput,
) -> Result<RuntimeLogReadResponse, String> {
    let max_limit = 5000_u32;
    let limit = input.limit.unwrap_or(500).clamp(1, max_limit) as usize;
    let has_filters = input_has_runtime_log_filters(&input);
    let mut entries: Vec<RuntimeLogEntry> = if !has_filters {
        read_last_log_lines(&state.session_log_path, limit)?
            .iter()
            .map(|line| parse_runtime_log_line(line))
            .collect()
    } else {
        let content = fs::read_to_string(&state.session_log_path).unwrap_or_default();
        content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(parse_runtime_log_line)
            .filter(|entry| runtime_log_entry_matches(entry, &input))
            .collect()
    };
    if entries.len() > limit {
        let start = entries.len() - limit;
        entries = entries.split_off(start);
    }
    Ok(RuntimeLogReadResponse { entries })
}
#[tauri::command]
pub fn runtime_log_clear_current_session(
    state: State<'_, AppState>,
    input: RuntimeLogClearInput,
) -> Result<Ack, String> {
    let token = input.confirm_token.unwrap_or_default();
    if token.trim() != "CLEAR_CURRENT_SESSION" {
        return Err("Invalid confirm token".to_string());
    }
    fs::write(&state.session_log_path, "").map_err(|e| e.to_string())?;
    state.log("WARN", "runtime_log_clear_current_session");
    Ok(Ack {
        ok: true,
        message: "cleared".to_string(),
    })
}






