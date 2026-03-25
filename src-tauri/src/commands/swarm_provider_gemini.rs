use super::*;

pub(super) fn call_gemini(
    client: &Client,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
) -> Result<String, ProviderError> {
    let reasoning = is_reasoning_model(model_name);
    let mut payloads = vec![json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }],
        "generationConfig": {
            "temperature": 0.2,
            "maxOutputTokens": 2048
        }
    })];
    if reasoning {
        payloads.insert(
            0,
            json!({
                "contents": [{
                    "role": "user",
                    "parts": [{ "text": prompt }]
                }],
                "generationConfig": {
                    "maxOutputTokens": 2048
                }
            }),
        );
    }
    payloads.push(json!({
        "contents": [{
            "role": "user",
            "parts": [{ "text": prompt }]
        }]
    }));

    let mut last_error: Option<ProviderError> = None;
    for endpoint in candidate_gemini_endpoints(base_url, model_name, api_key) {
        for payload in &payloads {
            let response = match client.post(&endpoint).json(payload).send() {
                Ok(item) => item,
                Err(error) => {
                    last_error = Some(transport_error(error));
                    continue;
                }
            };

            let status = response.status();
            let body = response.text().unwrap_or_default();
            if !status.is_success() {
                let error = classify_http_error("Gemini", status, &body);
                if error.auto_repairable {
                    last_error = Some(error);
                    continue;
                }
                return Err(error);
            }

            let parsed = match parse_provider_json(&body, "Gemini") {
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
                .get("candidates")
                .and_then(|v| v.get(0))
                .and_then(|v| v.get("content"))
                .and_then(|v| v.get("parts"))
                .and_then(extract_text_content)
                .unwrap_or_default();
            if !content.trim().is_empty() {
                return Ok(content);
            }
            last_error = Some(ProviderError {
                code: "provider.empty_output",
                message: "Empty response from Gemini endpoint".to_string(),
                retryable: true,
                auto_repairable: true,
            });
        }
    }
    Err(last_error.unwrap_or(ProviderError {
        code: "provider.endpoint_mismatch",
        message: "No compatible Gemini endpoint/payload variant succeeded".to_string(),
        retryable: false,
        auto_repairable: true,
    }))
}
