use crate::commands::channels_telegram_secure::secure_token;
use crate::models::{
    Ack, ChannelFailure, ChannelPrefs, TelegramConnectionResult, TelegramPollInput,
    TelegramPollResult, TelegramSendInput, TelegramTestInput, TelegramUpdateItem,
};
use crate::outbound_http::{
    build_async_client, classify_transport_failure, OutboundProxyMode, ProxyResolution,
};
use crate::state::AppState;
use crate::storage;
use reqwest::Client;
use serde_json::{json, Value};
use std::net::IpAddr;
use std::time::Duration;
use tauri::State;

struct TelegramConfig {
    token: String,
    allowed_chat_id: Option<String>,
    api_base_url: String,
    proxy_mode: OutboundProxyMode,
}

const DEFAULT_TELEGRAM_API_BASE_URL: &str = "https://api.telegram.org";

fn normalize_telegram_api_base_url(raw: Option<&str>) -> Result<String, String> {
    let candidate = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TELEGRAM_API_BASE_URL);
    let parsed = reqwest::Url::parse(candidate)
        .map_err(|_| "channels.telegram.base_url_invalid".to_string())?;
    let host = parsed
        .host_str()
        .ok_or_else(|| "channels.telegram.base_url_invalid".to_string())?;
    let loopback_http = parsed.scheme() == "http"
        && (host.eq_ignore_ascii_case("localhost")
            || host
                .parse::<IpAddr>()
                .map(|address| address.is_loopback())
                .unwrap_or(false));
    if !(parsed.scheme() == "https" || loopback_http)
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.query().is_some()
        || parsed.fragment().is_some()
    {
        return Err("channels.telegram.base_url_invalid".to_string());
    }
    Ok(parsed.to_string().trim_end_matches('/').to_string())
}

fn telegram_method_url(base_url: &str, token: &str, method: &str) -> String {
    format!(
        "{}/bot{}/{}",
        base_url.trim_end_matches('/'),
        token.trim(),
        method.trim_start_matches('/')
    )
}

fn telegram_http_status_error(status: reqwest::StatusCode) -> String {
    format!("channels.telegram.http_{}", status.as_u16())
}

fn telegram_proxy_mode(channels: &ChannelPrefs) -> Result<OutboundProxyMode, String> {
    match channels
        .telegram_proxy_mode
        .as_deref()
        .unwrap_or_else(|| {
            if channels.telegram_proxy_enabled == Some(false) {
                "direct"
            } else {
                "system"
            }
        })
        .trim()
        .to_ascii_lowercase()
        .as_str()
    {
        "system" => Ok(OutboundProxyMode::System),
        "direct" => Ok(OutboundProxyMode::Direct),
        "manual" => Ok(OutboundProxyMode::Manual(
            channels
                .telegram_manual_proxy_url
                .as_deref()
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .ok_or_else(|| "network.proxy.manual_invalid".to_string())?
                .to_string(),
        )),
        _ => Err("channels.telegram.proxy_mode_invalid".to_string()),
    }
}

fn telegram_client(
    api_base_url: &str,
    timeout_secs: u64,
    proxy_mode: &OutboundProxyMode,
) -> Result<(Client, ProxyResolution), String> {
    build_async_client(api_base_url, proxy_mode, Duration::from_secs(timeout_secs)).map_err(
        |code| match code.as_str() {
            "network.proxy.manual_invalid" => "channels.telegram.proxy_manual_invalid".to_string(),
            "network.proxy.pac_failed" => "channels.telegram.proxy_pac_failed".to_string(),
            _ => "channels.telegram.transport".to_string(),
        },
    )
}

fn telegram_config_from_channels(
    channels: &ChannelPrefs,
    token: String,
) -> Result<TelegramConfig, String> {
    let proxy_mode = telegram_proxy_mode(channels)?;
    let allowed_chat_id = channels
        .telegram_chat_id
        .as_deref()
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let api_base_url = normalize_telegram_api_base_url(channels.telegram_api_base_url.as_deref())?;
    Ok(TelegramConfig {
        token,
        allowed_chat_id,
        api_base_url,
        proxy_mode,
    })
}

fn resolve_telegram_config(
    state: &AppState,
    require_enabled: bool,
) -> Result<TelegramConfig, String> {
    let settings = storage::load_settings(&state.db_path, &state.runtime_root)?;
    let channels = settings
        .ui_prefs
        .and_then(|prefs| prefs.channels)
        .ok_or_else(|| "channels.telegram.disabled".to_string())?;
    if require_enabled && !channels.telegram_enabled.unwrap_or(false) {
        return Err("channels.telegram.disabled".to_string());
    }
    let token = secure_token(state)?;
    telegram_config_from_channels(&channels, token)
}

fn extract_telegram_error(_payload: &Value, fallback: &str) -> String {
    fallback.to_string()
}

fn transport_error(error: &reqwest::Error, proxy_source: &str) -> String {
    let failure = classify_transport_failure(error, proxy_source);
    match failure.code.as_str() {
        "network.timeout" => "channels.telegram.timeout",
        "network.tls" => "channels.telegram.tls",
        "network.dns" => "channels.telegram.dns",
        "network.proxy_connect" => "channels.telegram.proxy_connect",
        _ => "channels.telegram.transport",
    }
    .to_string()
}

fn channel_failure(
    code: impl Into<String>,
    stage: impl Into<String>,
    retryable: bool,
    proxy_source: impl Into<String>,
) -> ChannelFailure {
    ChannelFailure {
        code: code.into(),
        stage: stage.into(),
        retryable,
        proxy_source: proxy_source.into(),
    }
}

fn connection_result(result: Result<String, ChannelFailure>) -> TelegramConnectionResult {
    match result {
        Ok(proxy_source) => TelegramConnectionResult {
            ok: true,
            code: "ok".to_string(),
            stage: "complete".to_string(),
            retryable: false,
            proxy_source,
        },
        Err(failure) => TelegramConnectionResult {
            ok: false,
            code: failure.code,
            stage: failure.stage,
            retryable: failure.retryable,
            proxy_source: failure.proxy_source,
        },
    }
}

fn parse_chat_id(value: &Value) -> Option<String> {
    if let Some(id) = value.as_i64() {
        return Some(id.to_string());
    }
    value.as_str().map(|item| item.to_string())
}

async fn send_telegram_message(
    api_base_url: &str,
    token: &str,
    chat_id: &str,
    text: &str,
    reply_to_message_id: Option<i64>,
    proxy_mode: &OutboundProxyMode,
) -> Result<Ack, String> {
    let token = token.trim();
    let chat_id = chat_id.trim();
    let text = text.trim();
    if token.is_empty() {
        return Err("channels.telegram.token_missing".to_string());
    }
    if chat_id.is_empty() {
        return Err("channels.telegram.chat_id_missing".to_string());
    }
    if text.is_empty() {
        return Err("channels.telegram.empty_text".to_string());
    }
    let (client, resolution) = telegram_client(api_base_url, 15, proxy_mode)?;
    let mut body = json!({
        "chat_id": chat_id,
        "text": text,
    });
    if let Some(reply_to_message_id) = reply_to_message_id {
        body["reply_to_message_id"] = json!(reply_to_message_id);
    }
    let response = client
        .post(telegram_method_url(api_base_url, token, "sendMessage"))
        .json(&body)
        .send()
        .await
        .map_err(|error| transport_error(&error, &resolution.source))?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(telegram_http_status_error(status));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "channels.telegram.parse".to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(extract_telegram_error(
            &payload,
            "channels.telegram.send_failed",
        ));
    }
    Ok(Ack {
        ok: true,
        message: "sent".to_string(),
    })
}

async fn test_telegram_connection(
    config: &TelegramConfig,
    text: &str,
) -> Result<String, ChannelFailure> {
    let proxy_source = match telegram_client(&config.api_base_url, 15, &config.proxy_mode) {
        Ok((client, resolution)) => {
            let method = if config.allowed_chat_id.is_some() {
                "sendMessage"
            } else {
                "getMe"
            };
            let mut request = if let Some(chat_id) = config.allowed_chat_id.as_deref() {
                client
                    .post(telegram_method_url(
                        &config.api_base_url,
                        &config.token,
                        method,
                    ))
                    .json(&json!({
                        "chat_id": chat_id,
                        "text": text.trim(),
                    }))
            } else {
                client.get(telegram_method_url(
                    &config.api_base_url,
                    &config.token,
                    method,
                ))
            };
            request = request.header("Accept", "application/json");
            let response = request.send().await.map_err(|error| {
                let failure = classify_transport_failure(&error, &resolution.source);
                channel_failure(
                    match failure.code.as_str() {
                        "network.timeout" => "channels.telegram.timeout",
                        "network.tls" => "channels.telegram.tls",
                        "network.dns" => "channels.telegram.dns",
                        "network.proxy_connect" => "channels.telegram.proxy_connect",
                        _ => "channels.telegram.transport",
                    },
                    failure.stage,
                    failure.retryable,
                    failure.proxy_source,
                )
            })?;
            let status = response.status();
            if !status.is_success() {
                return Err(channel_failure(
                    telegram_http_status_error(status),
                    if matches!(status.as_u16(), 401 | 403) {
                        "auth"
                    } else {
                        "http"
                    },
                    status.as_u16() == 429 || status.is_server_error(),
                    resolution.source,
                ));
            }
            let payload: Value = response.json().await.map_err(|_| {
                channel_failure(
                    "channels.telegram.parse",
                    "responseParse",
                    false,
                    resolution.source.clone(),
                )
            })?;
            if payload.get("ok").and_then(Value::as_bool) != Some(true) {
                return Err(channel_failure(
                    "channels.telegram.verify_failed",
                    "auth",
                    false,
                    resolution.source,
                ));
            }
            return Ok(resolution.source);
        }
        Err(code) => code,
    };
    Err(channel_failure(
        proxy_source,
        "proxyResolve",
        true,
        "unresolved",
    ))
}

#[tauri::command]
pub async fn channels_telegram_poll(
    state: State<'_, AppState>,
    input: TelegramPollInput,
) -> Result<TelegramPollResult, String> {
    let config = resolve_telegram_config(&state, true)?;
    let timeout_secs = input.timeout_secs.unwrap_or(2).clamp(1, 25);
    let (client, resolution) =
        telegram_client(&config.api_base_url, timeout_secs + 8, &config.proxy_mode)?;
    let mut query: Vec<(&str, String)> = vec![
        ("timeout", timeout_secs.to_string()),
        ("allowed_updates", "[\"message\"]".to_string()),
    ];
    if let Some(offset) = input.offset {
        query.push(("offset", offset.to_string()));
    }
    if let Some(limit) = input.limit {
        query.push(("limit", limit.clamp(1, 100).to_string()));
    }
    let response = client
        .get(telegram_method_url(
            &config.api_base_url,
            &config.token,
            "getUpdates",
        ))
        .query(&query)
        .send()
        .await
        .map_err(|error| transport_error(&error, &resolution.source))?;
    if !response.status().is_success() {
        let status = response.status();
        return Err(telegram_http_status_error(status));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|_| "channels.telegram.parse".to_string())?;
    if payload.get("ok").and_then(Value::as_bool) != Some(true) {
        return Err(extract_telegram_error(
            &payload,
            "channels.telegram.get_updates_failed",
        ));
    }
    let mut updates = Vec::new();
    let mut next_offset = input.offset.unwrap_or(0);
    if let Some(items) = payload.get("result").and_then(Value::as_array) {
        for item in items {
            let update_id = item.get("update_id").and_then(Value::as_i64).unwrap_or(0);
            next_offset = next_offset.max(update_id + 1);
            let Some(message) = item.get("message").and_then(Value::as_object) else {
                continue;
            };
            let chat_id = message
                .get("chat")
                .and_then(|chat| chat.get("id"))
                .and_then(parse_chat_id);
            let Some(chat_id) = chat_id else {
                continue;
            };
            if let Some(allowed_chat_id) = config.allowed_chat_id.as_ref() {
                if allowed_chat_id != &chat_id {
                    continue;
                }
            }
            let text = message
                .get("text")
                .and_then(Value::as_str)
                .or_else(|| message.get("caption").and_then(Value::as_str))
                .map(str::trim)
                .unwrap_or("")
                .to_string();
            if text.is_empty() {
                continue;
            }
            let username = message
                .get("from")
                .and_then(|from| from.get("username").and_then(Value::as_str))
                .or_else(|| {
                    message
                        .get("from")
                        .and_then(|from| from.get("first_name").and_then(Value::as_str))
                })
                .unwrap_or("telegram")
                .trim()
                .to_string();
            let message_id = message
                .get("message_id")
                .and_then(Value::as_i64)
                .unwrap_or(0);
            updates.push(TelegramUpdateItem {
                update_id,
                message_id,
                chat_id,
                username,
                text,
            });
        }
    }
    Ok(TelegramPollResult {
        next_offset,
        updates,
    })
}

#[tauri::command]
pub async fn channels_telegram_send(
    state: State<'_, AppState>,
    input: TelegramSendInput,
) -> Result<Ack, String> {
    let config = resolve_telegram_config(&state, true)?;
    let text = input.text.trim();
    if text.is_empty() {
        return Err("channels.telegram.empty_text".to_string());
    }
    let chat_id = input
        .chat_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_string)
        .or(config.allowed_chat_id)
        .ok_or_else(|| "channels.telegram.chat_id_missing".to_string())?;
    send_telegram_message(
        &config.api_base_url,
        &config.token,
        &chat_id,
        text,
        input.reply_to_message_id,
        &config.proxy_mode,
    )
    .await
}

#[tauri::command]
pub async fn channels_telegram_test(
    state: State<'_, AppState>,
    input: TelegramTestInput,
) -> Result<TelegramConnectionResult, String> {
    let config = match resolve_telegram_config(&state, false) {
        Ok(config) => config,
        Err(code) => {
            return Ok(connection_result(Err(channel_failure(
                code,
                "configuration",
                false,
                "unresolved",
            ))))
        }
    };
    Ok(connection_result(
        test_telegram_connection(&config, &input.text).await,
    ))
}

#[cfg(test)]
#[path = "channels_telegram_tests.rs"]
mod tests;
