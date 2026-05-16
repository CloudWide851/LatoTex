use super::swarm_provider_core::*;
use super::swarm_provider_streaming::stream_anthropic;
use reqwest::blocking::Client;
use serde_json::json;

pub(super) fn call_anthropic(
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
            let response = match client
                .post(&endpoint)
                .header("x-api-key", api_key)
                .header("anthropic-version", "2023-06-01")
                .json(payload)
                .send()
            {
                Ok(item) => item,
                Err(error) => {
                    last_error = Some(transport_error(error));
                    continue;
                }
            };
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
            let parsed = match parse_provider_json(&body, "Anthropic") {
                Ok(value) => value,
                Err(error) => {
                    if error.auto_repairable {
                        last_error = Some(error);
                        continue;
                    }
                    return Err(error);
                }
            };
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
                retryable: true,
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

pub(super) fn call_anthropic_streaming<F>(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
    mut on_delta: F,
) -> Result<StreamAttempt, ProviderError>
where
    F: FnMut(&str) -> Result<(), String>,
{
    match stream_anthropic(client, base_url, api_key, model_name, prompt, &mut on_delta) {
        Ok(value) => Ok(value),
        Err(error) if error.auto_repairable => {
            let fallback = call_anthropic(client, base_url, api_key, model_name, prompt)?;
            if !fallback.is_empty() {
                on_delta(&fallback).map_err(consumer_error)?;
            }
            Ok(StreamAttempt { text: fallback })
        }
        Err(error) => Err(error),
    }
}
