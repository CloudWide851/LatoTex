use crate::storage;
use reqwest::blocking::Client;
use std::collections::hash_map::DefaultHasher;
use std::hash::{Hash, Hasher};
use std::path::Path;
use std::thread;
use std::time::Duration;

#[path = "swarm_provider_anthropic.rs"]
mod swarm_provider_anthropic;
#[path = "swarm_provider_core.rs"]
mod swarm_provider_core;
#[path = "swarm_provider_gemini.rs"]
mod swarm_provider_gemini;
#[path = "swarm_provider_openai.rs"]
mod swarm_provider_openai;
#[path = "swarm_provider_parse.rs"]
mod swarm_provider_parse;
#[path = "swarm_provider_streaming.rs"]
mod swarm_provider_streaming;

use swarm_provider_anthropic::{call_anthropic, call_anthropic_streaming};
use swarm_provider_core::{consumer_error, StreamAttempt};
use swarm_provider_gemini::call_gemini;
use swarm_provider_openai::{call_openai_compatible, call_openai_compatible_streaming};

const AGENT_RETRY_MAX: u32 = 1;
const AGENT_AUTO_REPAIR_MAX: u32 = 3;
fn cache_key(protocol_id: &str, base_url: &str, model_name: &str, prompt: &str) -> String {
    let mut hasher = DefaultHasher::new();
    protocol_id.hash(&mut hasher);
    base_url.hash(&mut hasher);
    model_name.hash(&mut hasher);
    prompt.hash(&mut hasher);
    format!("agent:{}:{:x}", protocol_id, hasher.finish())
}
pub(crate) fn call_provider_with_retry(
    db_path: Option<&Path>,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
    bypass_cache: bool,
) -> Result<String, String> {
    let key = cache_key(protocol_id, base_url, model_name, prompt);
    if !bypass_cache {
        if let Some(path) = db_path {
            if let Ok(Some(cached)) = storage::load_agent_cache(path, &key) {
                return Ok(cached);
            }
        }
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(35))
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_error = String::new();
    let mut auto_repair_attempts = 0_u32;
    for attempt in 0..=AGENT_RETRY_MAX {
        let result = match protocol_id {
            "anthropic" => call_anthropic(&client, base_url, api_key, model_name, prompt),
            "gemini" => call_gemini(&client, base_url, api_key, model_name, prompt),
            _ => call_openai_compatible(&client, base_url, api_key, model_name, prompt),
        };
        match result {
            Ok(text) => {
                if !bypass_cache {
                    if let Some(path) = db_path {
                        let _ = storage::store_agent_cache(
                            path,
                            &key,
                            protocol_id,
                            model_name,
                            &text,
                            180,
                        );
                    }
                }
                return Ok(text);
            }
            Err(error) => {
                last_error = error.render();
                if error.auto_repairable && auto_repair_attempts < AGENT_AUTO_REPAIR_MAX {
                    auto_repair_attempts = auto_repair_attempts.saturating_add(1);
                    let delay_ms = 200_u64.saturating_mul(2_u64.pow(auto_repair_attempts));
                    thread::sleep(Duration::from_millis(delay_ms.min(1_600)));
                    continue;
                }
                if attempt >= AGENT_RETRY_MAX || !error.retryable {
                    break;
                }
                let delay_ms = if error.retryable {
                    800_u64.saturating_mul(2_u64.pow(attempt))
                } else {
                    450_u64.saturating_mul(2_u64.pow(attempt.min(2)))
                };
                thread::sleep(Duration::from_millis(delay_ms.min(8_000)));
            }
        }
    }
    Err(last_error)
}

pub(crate) fn call_provider_with_retry_streaming<F>(
    db_path: Option<&Path>,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    prompt: &str,
    bypass_cache: bool,
    mut on_delta: F,
) -> Result<String, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let key = cache_key(protocol_id, base_url, model_name, prompt);
    if !bypass_cache {
        if let Some(path) = db_path {
            if let Ok(Some(cached)) = storage::load_agent_cache(path, &key) {
                if !cached.is_empty() {
                    on_delta(&cached)?;
                }
                return Ok(cached);
            }
        }
    }
    let client = Client::builder()
        .connect_timeout(Duration::from_secs(8))
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let mut last_error = String::new();
    let mut auto_repair_attempts = 0_u32;
    for attempt in 0..=AGENT_RETRY_MAX {
        let result = match protocol_id {
            "anthropic" => call_anthropic_streaming(
                &client,
                base_url,
                api_key,
                model_name,
                prompt,
                &mut on_delta,
            ),
            "gemini" => match call_gemini(&client, base_url, api_key, model_name, prompt) {
                Ok(text) => {
                    if !text.is_empty() {
                        if let Err(error) = on_delta(&text) {
                            return Err(consumer_error(error).render());
                        }
                    }
                    Ok(StreamAttempt { text })
                }
                Err(error) => Err(error),
            },
            _ => call_openai_compatible_streaming(
                &client,
                base_url,
                api_key,
                model_name,
                prompt,
                &mut on_delta,
            ),
        };
        match result {
            Ok(attempt_result) => {
                if !bypass_cache {
                    if let Some(path) = db_path {
                        let _ = storage::store_agent_cache(
                            path,
                            &key,
                            protocol_id,
                            model_name,
                            &attempt_result.text,
                            180,
                        );
                    }
                }
                return Ok(attempt_result.text);
            }
            Err(error) => {
                last_error = error.render();
                if error.auto_repairable && auto_repair_attempts < AGENT_AUTO_REPAIR_MAX {
                    auto_repair_attempts = auto_repair_attempts.saturating_add(1);
                    let delay_ms = 200_u64.saturating_mul(2_u64.pow(auto_repair_attempts));
                    thread::sleep(Duration::from_millis(delay_ms.min(1_600)));
                    continue;
                }
                if attempt >= AGENT_RETRY_MAX || !error.retryable {
                    break;
                }
                let delay_ms = 800_u64.saturating_mul(2_u64.pow(attempt));
                thread::sleep(Duration::from_millis(delay_ms.min(8_000)));
            }
        }
    }
    Err(last_error)
}
