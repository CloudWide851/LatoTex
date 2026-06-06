use crate::models::{
    Ack, TelegramPollInput, TelegramPollResult, TelegramSendInput, TelegramTestInput,
    TelegramUpdateItem,
};
use crate::state::AppState;
use crate::storage;
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

struct TelegramConfig {
    token: String,
    allowed_chat_id: Option<String>,
    api_base_url: String,
}

const DEFAULT_TELEGRAM_API_BASE_URL: &str = "https://api.telegram.org";

fn normalize_telegram_api_base_url(raw: Option<&str>) -> Result<String, String> {
    let candidate = raw
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or(DEFAULT_TELEGRAM_API_BASE_URL);
    let parsed = reqwest::Url::parse(candidate)
        .map_err(|_| "channels.telegram.base_url_invalid".to_string())?;
    if !matches!(parsed.scheme(), "http" | "https")
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

fn resolve_telegram_config(state: &AppState) -> Result<TelegramConfig, String> {
    let settings = storage::load_settings(&state.db_path, &state.runtime_root)?;
    let channels = settings
        .ui_prefs
        .and_then(|prefs| prefs.channels)
        .ok_or_else(|| "channels.telegram.disabled".to_string())?;
    if !channels.telegram_enabled.unwrap_or(false) {
        return Err("channels.telegram.disabled".to_string());
    }
    let token = channels
        .telegram_bot_token
        .unwrap_or_default()
        .trim()
        .to_string();
    if token.is_empty() {
        return Err("channels.telegram.token_missing".to_string());
    }
    let allowed_chat_id = channels
        .telegram_chat_id
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let api_base_url = normalize_telegram_api_base_url(channels.telegram_api_base_url.as_deref())?;
    Ok(TelegramConfig {
        token,
        allowed_chat_id,
        api_base_url,
    })
}

fn extract_telegram_error(_payload: &Value, fallback: &str) -> String {
    fallback.to_string()
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
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
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
        .map_err(|_| "channels.telegram.transport".to_string())?;
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

async fn test_telegram_token_with_base(api_base_url: &str, token: &str) -> Result<Ack, String> {
    let token = token.trim();
    if token.is_empty() {
        return Err("channels.telegram.token_missing".to_string());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .get(telegram_method_url(api_base_url, token, "getMe"))
        .send()
        .await
        .map_err(|_| "channels.telegram.transport".to_string())?;
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
            "channels.telegram.verify_failed",
        ));
    }
    Ok(Ack {
        ok: true,
        message: "verified".to_string(),
    })
}

#[tauri::command]
pub async fn channels_telegram_poll(
    state: State<'_, AppState>,
    input: TelegramPollInput,
) -> Result<TelegramPollResult, String> {
    let config = resolve_telegram_config(&state)?;
    let timeout_secs = input.timeout_secs.unwrap_or(2).clamp(1, 25);
    let client = Client::builder()
        .timeout(Duration::from_secs(timeout_secs + 8))
        .build()
        .map_err(|e| e.to_string())?;
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
        .map_err(|_| "channels.telegram.transport".to_string())?;
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
    let config = resolve_telegram_config(&state)?;
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
    )
    .await
}

#[tauri::command]
pub async fn channels_telegram_test(input: TelegramTestInput) -> Result<Ack, String> {
    let api_base_url = normalize_telegram_api_base_url(input.api_base_url.as_deref())?;
    let chat_id = input.chat_id.unwrap_or_default();
    if chat_id.trim().is_empty() {
        return test_telegram_token_with_base(&api_base_url, &input.token).await;
    }
    send_telegram_message(&api_base_url, &input.token, &chat_id, &input.text, None).await
}

#[cfg(test)]
mod tests {
    use super::{
        normalize_telegram_api_base_url, telegram_http_status_error, telegram_method_url,
        DEFAULT_TELEGRAM_API_BASE_URL,
    };

    #[test]
    fn telegram_base_url_defaults_and_trims_slashes() {
        assert_eq!(
            normalize_telegram_api_base_url(None).unwrap(),
            DEFAULT_TELEGRAM_API_BASE_URL
        );
        assert_eq!(
            normalize_telegram_api_base_url(Some(" https://example.test/proxy/ ")).unwrap(),
            "https://example.test/proxy"
        );
    }

    #[test]
    fn telegram_base_url_rejects_non_http_query_and_fragment() {
        assert_eq!(
            normalize_telegram_api_base_url(Some("file:///tmp/api")).unwrap_err(),
            "channels.telegram.base_url_invalid"
        );
        assert_eq!(
            normalize_telegram_api_base_url(Some("https://example.test/api?token=1")).unwrap_err(),
            "channels.telegram.base_url_invalid"
        );
        assert_eq!(
            normalize_telegram_api_base_url(Some("https://example.test/api#bot")).unwrap_err(),
            "channels.telegram.base_url_invalid"
        );
    }

    #[test]
    fn telegram_method_url_builds_bot_endpoint() {
        assert_eq!(
            telegram_method_url("https://example.test/base/", "123:abc", "/getMe"),
            "https://example.test/base/bot123:abc/getMe"
        );
    }

    #[test]
    fn telegram_http_error_uses_stable_code_without_response_body() {
        assert_eq!(
            telegram_http_status_error(reqwest::StatusCode::UNAUTHORIZED),
            "channels.telegram.http_401"
        );
    }
}
