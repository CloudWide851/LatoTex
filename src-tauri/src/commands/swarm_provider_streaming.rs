use super::swarm_provider_core::*;
use super::swarm_provider_parse::compact_body_preview;
use reqwest::blocking::{Client, Response};
use serde_json::json;
use std::io::{BufRead, BufReader};

fn handle_sse_stream<F>(
    response: Response,
    provider: &str,
    mut on_event: F,
) -> Result<(), ProviderError>
where
    F: FnMut(serde_json::Value) -> Result<(), ProviderError>,
{
    let reader = BufReader::new(response);
    let mut data_lines = Vec::<String>::new();
    for line in reader.lines() {
        let line = line.map_err(|error| ProviderError {
            code: "provider.stream_read_failed",
            message: format!("{provider} stream read failed: {error}"),
            retryable: true,
            auto_repairable: true,
        })?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            if data_lines.is_empty() {
                continue;
            }
            let payload = data_lines.join("\n");
            data_lines.clear();
            if payload.trim() == "[DONE]" {
                return Ok(());
            }
            let parsed = serde_json::from_str::<serde_json::Value>(&payload).map_err(|error| {
                ProviderError {
                    code: "provider.parse_invalid_json",
                    message: format!(
                        "{provider} streamed event parse error: {error}; body_preview={}",
                        compact_body_preview(&payload)
                    ),
                    retryable: true,
                    auto_repairable: true,
                }
            })?;
            on_event(parsed)?;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("data:") {
            data_lines.push(rest.trim().to_string());
        }
    }
    if !data_lines.is_empty() {
        let payload = data_lines.join("\n");
        if payload.trim() != "[DONE]" {
            let parsed = serde_json::from_str::<serde_json::Value>(&payload).map_err(|error| {
                ProviderError {
                    code: "provider.parse_invalid_json",
                    message: format!(
                        "{provider} streamed event parse error: {error}; body_preview={}",
                        compact_body_preview(&payload)
                    ),
                    retryable: true,
                    auto_repairable: true,
                }
            })?;
            on_event(parsed)?;
        }
    }
    Ok(())
}

pub(super) fn stream_openai_chat<F>(
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
    let mut payloads = vec![json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": prompt }],
        "temperature": 0.2,
        "stream": true
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "messages": [{ "role": "user", "content": prompt }],
                "max_completion_tokens": 2200,
                "stream": true
            }),
        );
    }
    payloads.push(json!({
        "model": model_name,
        "messages": [{ "role": "user", "content": prompt }],
        "stream": true
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
            if !status.is_success() {
                let body = response.text().unwrap_or_default();
                let error = classify_http_error("OpenAI-compatible/chat(stream)", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
            let mut merged = String::new();
            let stream_result =
                handle_sse_stream(response, "OpenAI-compatible/chat(stream)", |parsed| {
                    if let Some(error_body) = parsed.get("error") {
                        return Err(ProviderError {
                            code: "provider.http_error",
                            message: format!(
                                "OpenAI-compatible/chat(stream) error event: {}",
                                compact_body_preview(&error_body.to_string())
                            ),
                            retryable: false,
                            auto_repairable: false,
                        });
                    }
                    let chunk = parsed
                        .get("choices")
                        .and_then(|value| value.get(0))
                        .and_then(|value| value.get("delta"))
                        .and_then(|value| value.get("content").or(Some(value)))
                        .and_then(extract_text_content)
                        .unwrap_or_default();
                    if chunk.is_empty() {
                        return Ok(());
                    }
                    on_delta(&chunk).map_err(consumer_error)?;
                    merged.push_str(&chunk);
                    Ok(())
                });
            match stream_result {
                Ok(()) if !merged.trim().is_empty() => {
                    return Ok(StreamAttempt { text: merged });
                }
                Ok(()) => {
                    last_error = Some(stream_empty_output("OpenAI-compatible chat stream"));
                }
                Err(mut error) => {
                    if !merged.is_empty() {
                        error.retryable = false;
                        error.auto_repairable = false;
                    }
                    return Err(error);
                }
            }
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI chat streaming endpoint/payload variant succeeded"
            .to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

pub(super) fn stream_openai_responses<F>(
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
    let mut payloads = vec![json!({
        "model": model_name,
        "input": prompt,
        "temperature": 0.2,
        "max_output_tokens": 2200,
        "stream": true
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "input": prompt,
                "reasoning": { "effort": "medium" },
                "max_output_tokens": 2200,
                "stream": true
            }),
        );
    }
    payloads.push(json!({
        "model": model_name,
        "input": prompt,
        "max_output_tokens": 2200,
        "stream": true
    }));
    payloads.push(json!({
        "model": model_name,
        "input": prompt,
        "stream": true
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
            if !status.is_success() {
                let body = response.text().unwrap_or_default();
                let error =
                    classify_http_error("OpenAI-compatible/responses(stream)", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
            let mut merged = String::new();
            let mut completed_output = String::new();
            let stream_result =
                handle_sse_stream(response, "OpenAI-compatible/responses(stream)", |parsed| {
                    let event_type = parsed
                        .get("type")
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if event_type == "error" {
                        return Err(ProviderError {
                            code: "provider.http_error",
                            message: format!(
                                "OpenAI-compatible/responses(stream) error event: {}",
                                compact_body_preview(&parsed.to_string())
                            ),
                            retryable: false,
                            auto_repairable: false,
                        });
                    }
                    if event_type == "response.output_text.delta" {
                        let chunk = parsed
                            .get("delta")
                            .and_then(|value| value.as_str())
                            .unwrap_or("");
                        if !chunk.is_empty() {
                            on_delta(chunk).map_err(consumer_error)?;
                            merged.push_str(chunk);
                        }
                        return Ok(());
                    }
                    if event_type == "response.completed" {
                        if let Some(response_value) = parsed.get("response") {
                            completed_output = extract_openai_responses_content(response_value);
                        } else {
                            completed_output = extract_openai_responses_content(&parsed);
                        }
                    }
                    Ok(())
                });
            match stream_result {
                Ok(()) => {
                    let final_text = if !merged.trim().is_empty() {
                        merged
                    } else {
                        completed_output
                    };
                    if !final_text.trim().is_empty() {
                        return Ok(StreamAttempt { text: final_text });
                    }
                    last_error = Some(stream_empty_output("OpenAI-compatible responses stream"));
                }
                Err(mut error) => {
                    if !merged.is_empty() {
                        error.retryable = false;
                        error.auto_repairable = false;
                    }
                    return Err(error);
                }
            }
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible OpenAI responses streaming endpoint/payload variant succeeded"
            .to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}

pub(super) fn stream_anthropic<F>(
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
    let mut payloads = vec![json!({
        "model": model_name,
        "max_tokens": 2048,
        "messages": [{ "role": "user", "content": prompt }],
        "stream": true
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "model": model_name,
                "max_tokens": 2048,
                "thinking": { "type": "enabled", "budget_tokens": 1024 },
                "messages": [{ "role": "user", "content": prompt }],
                "stream": true
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
            if !status.is_success() {
                let body = response.text().unwrap_or_default();
                let error = classify_http_error("Anthropic(stream)", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }
            let mut merged = String::new();
            let stream_result = handle_sse_stream(response, "Anthropic(stream)", |parsed| {
                let event_type = parsed
                    .get("type")
                    .and_then(|value| value.as_str())
                    .unwrap_or("");
                if event_type == "error" {
                    return Err(ProviderError {
                        code: "provider.http_error",
                        message: format!(
                            "Anthropic(stream) error event: {}",
                            compact_body_preview(&parsed.to_string())
                        ),
                        retryable: false,
                        auto_repairable: false,
                    });
                }
                if event_type == "content_block_delta" {
                    let chunk = parsed
                        .get("delta")
                        .and_then(|value| value.get("text"))
                        .and_then(|value| value.as_str())
                        .unwrap_or("");
                    if !chunk.is_empty() {
                        on_delta(chunk).map_err(consumer_error)?;
                        merged.push_str(chunk);
                    }
                }
                Ok(())
            });
            match stream_result {
                Ok(()) if !merged.trim().is_empty() => {
                    return Ok(StreamAttempt { text: merged });
                }
                Ok(()) => {
                    last_error = Some(stream_empty_output("Anthropic stream"));
                }
                Err(mut error) => {
                    if !merged.is_empty() {
                        error.retryable = false;
                        error.auto_repairable = false;
                    }
                    return Err(error);
                }
            }
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible Anthropic streaming endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}
