use crate::models::{CredentialSaveResult, ModelApiKeySaveVerifiedInput};
use crate::secure;
use crate::state::AppState;
use reqwest::blocking::Client;
use std::thread;
use std::time::Duration;
use tauri::State;

fn verify_model_api_key_readback(model_id: &str, expected: &str) -> Result<bool, String> {
    let retry_delays = [0_u64, 120, 240, 380, 560, 820];
    for delay in retry_delays {
        if delay > 0 {
            thread::sleep(Duration::from_millis(delay));
        }
        let current = secure::get_model_api_key(model_id)?.unwrap_or_default();
        if current.trim() == expected {
            return Ok(true);
        }
    }
    Ok(false)
}

#[tauri::command]
pub fn model_api_key_save_verified(
    state: State<'_, AppState>,
    input: ModelApiKeySaveVerifiedInput,
) -> Result<CredentialSaveResult, String> {
    let model_id = input.model_id.trim();
    if model_id.is_empty() {
        return Err("Model id is required".to_string());
    }
    let protocol_id = input.protocol_id.trim();
    let base_url = input.base_url.trim();
    let request_name = input.request_name.trim();
    let api_key = input.api_key.trim().to_string();
    let require_probe = input.require_probe.unwrap_or(true);

    if api_key.is_empty() {
        secure::delete_model_api_key(model_id)?;
        let readback_ok = verify_model_api_key_readback(model_id, "")?;
        if !readback_ok {
            state.log(
                "WARN",
                &format!("model_api_key_save_verified: clear readback mismatch for {model_id}"),
            );
            return Ok(CredentialSaveResult {
                ok: false,
                stage: "readback".to_string(),
                message: "API key clear verification failed".to_string(),
            });
        }
        state.log("INFO", &format!("model_api_key_save_verified: cleared key for {model_id}"));
        return Ok(CredentialSaveResult {
            ok: true,
            stage: "write".to_string(),
            message: "API key cleared".to_string(),
        });
    }

    if protocol_id.is_empty() || base_url.is_empty() || request_name.is_empty() {
        return Err("Protocol id, base URL and request name are required".to_string());
    }

    secure::store_model_api_key(model_id, &api_key)?;
    let readback_ok = verify_model_api_key_readback(model_id, &api_key)?;
    if !readback_ok {
        state.log(
            "WARN",
            &format!("model_api_key_save_verified: readback mismatch for {model_id}"),
        );
        return Ok(CredentialSaveResult {
            ok: false,
            stage: "readback".to_string(),
            message: "API key readback verification failed".to_string(),
        });
    }

    if !require_probe {
        state.log(
            "INFO",
            &format!("model_api_key_save_verified: saved key for {model_id} without probe"),
        );
        return Ok(CredentialSaveResult {
            ok: true,
            stage: "write".to_string(),
            message: "API key saved".to_string(),
        });
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(18))
        .build()
        .map_err(|e| e.to_string())?;
    let probe = super::call_model_generation_test(
        &client,
        protocol_id,
        base_url,
        request_name,
        Some(api_key.as_str()),
    );
    match probe {
        Ok(status) => {
            state.log(
                "INFO",
                &format!(
                    "model_api_key_save_verified: probe success for {model_id}, status={status}"
                ),
            );
            Ok(CredentialSaveResult {
                ok: true,
                stage: "probe".to_string(),
                message: format!("API key saved and probe passed ({status})"),
            })
        }
        Err(error) => {
            state.log(
                "WARN",
                &format!(
                    "model_api_key_save_verified: probe failed for {model_id}, reason={error}"
                ),
            );
            Ok(CredentialSaveResult {
                ok: false,
                stage: "probe".to_string(),
                message: error,
            })
        }
    }
}
