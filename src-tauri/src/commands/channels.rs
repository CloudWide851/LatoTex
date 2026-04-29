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
    Ok(TelegramConfig {
        token,
        allowed_chat_id,
    })
}

fn extract_telegram_error(payload: &Value, fallback: &str) -> String {
    if let Some(description) = payload.get("description").and_then(Value::as_str) {
        return format!("channels.telegram.error: {description}");
    }
    fallback.to_string()
}

fn parse_chat_id(value: &Value) -> Option<String> {
    if let Some(id) = value.as_i64() {
        return Some(id.to_string());
    }
    value.as_str().map(|item| item.to_string())
}

async fn send_telegram_message(
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
        .post(format!(
            "https://api.telegram.org/bot{}/sendMessage",
            token
        ))
        .json(&body)
        .send()
        .await
        .map_err(|e| format!("channels.telegram.transport: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let payload = response.text().await.unwrap_or_default();
        return Err(format!("channels.telegram.http_{status}: {payload}"));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("channels.telegram.parse: {e}"))?;
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
        .get(format!(
            "https://api.telegram.org/bot{}/getUpdates",
            config.token
        ))
        .query(&query)
        .send()
        .await
        .map_err(|e| format!("channels.telegram.transport: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("channels.telegram.http_{status}: {body}"));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("channels.telegram.parse: {e}"))?;
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
    send_telegram_message(&config.token, &chat_id, text, input.reply_to_message_id).await
}

#[tauri::command]
pub async fn channels_telegram_test(input: TelegramTestInput) -> Result<Ack, String> {
    send_telegram_message(&input.token, &input.chat_id, &input.text, None).await
}
