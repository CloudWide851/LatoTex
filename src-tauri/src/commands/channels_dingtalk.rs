use crate::models::{
    Ack, DingTalkPollInput, DingTalkPollResult, DingTalkSendInput, DingTalkTestInput,
    DingTalkUpdateItem,
};
use crate::state::AppState;
use crate::storage;
use reqwest::Client;
use serde_json::{json, Value};
use std::time::Duration;
use tauri::State;

struct DingTalkConfig {
    client_id: String,
    client_secret: String,
}

fn resolve_dingtalk_config(state: &AppState) -> Result<DingTalkConfig, String> {
    let settings = storage::load_settings(&state.db_path, &state.runtime_root)?;
    let channels = settings
        .ui_prefs
        .and_then(|prefs| prefs.channels)
        .ok_or_else(|| "channels.dingtalk.disabled".to_string())?;
    if !channels.dingtalk_enabled.unwrap_or(false) {
        return Err("channels.dingtalk.disabled".to_string());
    }
    let client_id = channels
        .dingtalk_client_id
        .unwrap_or_default()
        .trim()
        .to_string();
    let client_secret = channels
        .dingtalk_client_secret
        .unwrap_or_default()
        .trim()
        .to_string();
    if client_id.is_empty() {
        return Err("channels.dingtalk.client_id_missing".to_string());
    }
    if client_secret.is_empty() {
        return Err("channels.dingtalk.client_secret_missing".to_string());
    }
    Ok(DingTalkConfig {
        client_id,
        client_secret,
    })
}

fn dingtalk_open_connection_body(client_id: &str, client_secret: &str) -> Value {
    json!({
        "clientId": client_id,
        "clientSecret": client_secret,
        "subscriptions": [
            {
                "type": "CALLBACK",
                "topic": "/v1.0/im/bot/messages/get"
            }
        ],
        "ua": "LatoTex/0.1.0"
    })
}

fn parse_open_connection(payload: &Value) -> Result<(String, String), String> {
    let endpoint = payload
        .get("endpoint")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    let ticket = payload
        .get("ticket")
        .and_then(Value::as_str)
        .unwrap_or_default()
        .trim();
    if endpoint.is_empty() || ticket.is_empty() {
        return Err("channels.dingtalk.open_invalid".to_string());
    }
    Ok((endpoint.to_string(), ticket.to_string()))
}

async fn open_dingtalk_stream_connection(
    client_id: &str,
    client_secret: &str,
) -> Result<(String, String), String> {
    let client_id = client_id.trim();
    let client_secret = client_secret.trim();
    if client_id.is_empty() {
        return Err("channels.dingtalk.client_id_missing".to_string());
    }
    if client_secret.is_empty() {
        return Err("channels.dingtalk.client_secret_missing".to_string());
    }
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post("https://api.dingtalk.com/v1.0/gateway/connections/open")
        .json(&dingtalk_open_connection_body(client_id, client_secret))
        .send()
        .await
        .map_err(|e| format!("channels.dingtalk.transport: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("channels.dingtalk.http_{status}: {body}"));
    }
    let payload: Value = response
        .json()
        .await
        .map_err(|e| format!("channels.dingtalk.parse: {e}"))?;
    parse_open_connection(&payload)
}

#[tauri::command]
pub async fn channels_dingtalk_poll(
    state: State<'_, AppState>,
    input: DingTalkPollInput,
) -> Result<DingTalkPollResult, String> {
    let config = resolve_dingtalk_config(&state)?;
    let _limit = input.limit.unwrap_or(20).clamp(1, 100);
    let (_endpoint, _ticket) =
        open_dingtalk_stream_connection(&config.client_id, &config.client_secret).await?;
    Ok(DingTalkPollResult {
        updates: Vec::<DingTalkUpdateItem>::new(),
        status: "channels.dingtalk.stream_ready".to_string(),
    })
}

#[tauri::command]
pub async fn channels_dingtalk_send(input: DingTalkSendInput) -> Result<Ack, String> {
    let text = input.text.trim();
    if text.is_empty() {
        return Err("channels.dingtalk.empty_text".to_string());
    }
    let webhook = input
        .webhook
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "channels.dingtalk.reply_target_missing".to_string())?;
    let client = Client::builder()
        .timeout(Duration::from_secs(15))
        .build()
        .map_err(|e| e.to_string())?;
    let response = client
        .post(webhook)
        .json(&json!({
            "msgtype": "text",
            "text": { "content": text },
            "replyToken": input.reply_token.unwrap_or_default(),
        }))
        .send()
        .await
        .map_err(|e| format!("channels.dingtalk.transport: {e}"))?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().await.unwrap_or_default();
        return Err(format!("channels.dingtalk.http_{status}: {body}"));
    }
    Ok(Ack {
        ok: true,
        message: "sent".to_string(),
    })
}

#[tauri::command]
pub async fn channels_dingtalk_test(input: DingTalkTestInput) -> Result<Ack, String> {
    let _ = open_dingtalk_stream_connection(&input.client_id, &input.client_secret).await?;
    Ok(Ack {
        ok: true,
        message: "verified".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_stream_connection_ticket() {
        let payload = json!({
            "endpoint": "wss://example.dingtalk.com/connect",
            "ticket": "ticket-1"
        });
        let parsed = parse_open_connection(&payload).expect("valid connection");
        assert_eq!(parsed.0, "wss://example.dingtalk.com/connect");
        assert_eq!(parsed.1, "ticket-1");
    }

    #[test]
    fn rejects_missing_stream_connection_fields() {
        let payload = json!({ "endpoint": "" });
        assert_eq!(
            parse_open_connection(&payload).unwrap_err(),
            "channels.dingtalk.open_invalid"
        );
    }
}
