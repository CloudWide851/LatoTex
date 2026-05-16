use super::swarm_provider_core::*;
use super::swarm_provider_streaming::{stream_openai_chat, stream_openai_responses};
use reqwest::blocking::Client;
use serde_json::json;

fn call_openai_chat(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": 0.2
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "messages": [{ "role": "user", "content": prompt }],
                "max_completion_tokens": 2200
            }),
        );
    }
    payloads.push(json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": prompt }]
    }));
    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_endpoints(base_url, "chat/completions") {
        for payload in &payloads {
            let response = match client
                .post(&endpoint)
                .bearer_auth(api_key)
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
                let error = classify_http_error("OpenAI-compatible/chat", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
            let parsed = match parse_provider_json(&body, "OpenAI-compatible/chat") {
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
                .get("choices")
                .and_then(|v| v.get(0))
                .and_then(|v| v.get("message"))
                .and_then(|v| v.get("content"))
                .and_then(extract_text_content)
                .unwrap_or_default();
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from OpenAI-compatible chat endpoint".to_string(),
                retryable: true,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI chat endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}
fn call_openai_responses(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "model": model_name,
        "input": prompt,
        "temperature": 0.2,
        "max_output_tokens": 2200
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "input": prompt,
                "reasoning": { "effort": "medium" },
                "max_output_tokens": 2200
            }),
        );
    }
    payloads.push(json!({
        "model": model_name,
        "input": prompt,
        "max_output_tokens": 2200
    }));
    payloads.push(json!({
        "model": model_name,
        "input": prompt
    }));
    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_endpoints(base_url, "responses") {
        for payload in &payloads {
            let response = match client
                .post(&endpoint)
                .bearer_auth(api_key)
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
                let error = classify_http_error("OpenAI-compatible/responses", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
            let parsed = match parse_provider_json(&body, "OpenAI-compatible/responses") {
                Ok(value) => value,
                Err(error) => {
                    if error.auto_repairable {
                        last_error = Some(error);
                        continue;
                    }
                    return Err(error);
                }
            };
            let content = extract_openai_responses_content(&parsed);
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from OpenAI-compatible responses endpoint".to_string(),
                retryable: true,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI responses endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}
pub(super) fn call_openai_compatible(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut last_error: Option<ProviderError> = None;
    let call_order: [fn(&Client, &str, &str, &str, &str) -> Result<String, ProviderError>; 2] =
        if reasoning {
            [call_openai_responses, call_openai_chat]
        } else {
            [call_openai_chat, call_openai_responses]
        };
    for call in call_order {
        match call(client, base_url, api_key, model_name, prompt) {
            Ok(value) => return Ok(value),
            Err(error) => {
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI-compatible mode succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

pub(super) fn call_openai_compatible_streaming<F>(
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
    let reasoning = is_reasoning_model(model_name);
    if reasoning {
        match stream_openai_responses(client, base_url, api_key, model_name, prompt, &mut on_delta)
        {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !error.auto_repairable {
                    return Err(error);
                }
            }
        }
        match stream_openai_chat(client, base_url, api_key, model_name, prompt, &mut on_delta) {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !error.auto_repairable {
                    return Err(error);
                }
            }
        }
    } else {
        match stream_openai_chat(client, base_url, api_key, model_name, prompt, &mut on_delta) {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !error.auto_repairable {
                    return Err(error);
                }
            }
        }
        match stream_openai_responses(client, base_url, api_key, model_name, prompt, &mut on_delta)
        {
            Ok(value) => return Ok(value),
            Err(error) => {
                if !error.auto_repairable {
                    return Err(error);
                }
            }
        }
    }
    let fallback = call_openai_compatible(client, base_url, api_key, model_name, prompt)?;
    if !fallback.is_empty() {
        on_delta(&fallback).map_err(consumer_error)?;
    }
    if !fallback.trim().is_empty() {
        return Ok(StreamAttempt { text: fallback });
    }
    Err(stream_empty_output("OpenAI-compatible"))
}
