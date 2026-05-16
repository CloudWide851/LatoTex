use crate::commands::swarm::call_provider_with_retry;
use crate::models::{
    Ack, AppSettings, ModelApiKeyGetInput, ModelApiKeySetInput, ModelApiKeyValue,
    ModelDraftTestInput, ModelTestInput, ModelTestResult, ProtocolHealth, ProtocolTestInput,
    SettingsUpdateInput,
};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use reqwest::blocking::Client;
use reqwest::StatusCode;
use std::time::Duration;
use tauri::{async_runtime::spawn_blocking, State};
#[path = "settings_background.rs"]
mod settings_background;
#[path = "settings_diagnostics_bundle.rs"]
mod settings_diagnostics_bundle;
#[path = "settings_fonts.rs"]
mod settings_fonts;
mod settings_keysave;
#[path = "settings_memory.rs"]
mod settings_memory;
#[path = "settings_runtime_logs.rs"]
mod settings_runtime_logs;
pub use settings_background::{
    settings_pick_background_image, settings_read_background_image,
    settings_remove_background_image,
};
pub use settings_diagnostics_bundle::runtime_diagnostics_bundle_export;
pub use settings_fonts::runtime_system_font_probe;
pub use settings_keysave::model_api_key_save_verified;
pub use settings_memory::runtime_memory_snapshot;
pub use settings_runtime_logs::{
    runtime_log_clear_current_session, runtime_log_info, runtime_log_list_sessions,
    runtime_log_read, runtime_log_write,
};
#[tauri::command]
pub async fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.log("INFO", "settings_get");
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || storage::load_settings(&db_path, &runtime_root))
        .await
        .map_err(|e| e.to_string())?
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
    let base_url = input
        .base_url
        .clone()
        .unwrap_or_default()
        .trim()
        .to_string();
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
    let (protocol_id, base_url, request_name, api_key) = storage::resolve_model_test_connection(
        &state.db_path,
        &state.runtime_root,
        &input.model_id,
    )?;
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
    let result =
        call_model_generation_test(&client, protocol_id, base_url, request_name, Some(api_key));
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
                outcome
                    .diagnostic_code
                    .clone()
                    .unwrap_or_else(|| "-".to_string())
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
            outcome
                .diagnostic_code
                .clone()
                .unwrap_or_else(|| "-".to_string())
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
fn probe_anthropic(
    client: &Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
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
fn probe_gemini(
    client: &Client,
    base_url: &str,
    api_key: Option<&str>,
) -> Result<StatusCode, String> {
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
    call_provider_with_retry(None, protocol_id, base_url, &key, model_name, "ping", true)
}
