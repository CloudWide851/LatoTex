use crate::models::{CredentialSaveResult, ModelApiKeySaveVerifiedInput};
use crate::secure;
use crate::state::AppState;
use std::collections::HashSet;
use std::thread;
use std::time::Duration;
use tauri::State;

const READBACK_RETRY_DELAYS_MS: [u64; 5] = [0, 120, 280, 520, 800];

#[derive(Clone)]
struct ReadbackAttempt {
    attempt: u32,
    key_len: usize,
    source: String,
    diagnostic: Option<String>,
}

#[derive(Clone)]
struct ReadbackResult {
    ok: bool,
    attempts: u32,
    key_len: usize,
    source: String,
    diagnostic: Option<String>,
    source_drift: bool,
    non_empty_mismatch: bool,
    trace: Vec<ReadbackAttempt>,
}

fn format_readback_trace(trace: &[ReadbackAttempt]) -> String {
    trace
        .iter()
        .map(|item| {
            format!(
                "{}:{}:len={}:diag={}",
                item.attempt,
                item.source,
                item.key_len,
                item.diagnostic.clone().unwrap_or_else(|| "-".to_string())
            )
        })
        .collect::<Vec<_>>()
        .join(" | ")
}

fn verify_model_key_readback(
    secure_context: &secure::SecureStorageContext,
    model_id: &str,
    expected_api_key: &str,
) -> Result<ReadbackResult, String> {
    let normalized_expected = expected_api_key.trim();
    let expect_cleared = normalized_expected.is_empty();
    let mut last_key = String::new();
    let mut last_source = "none".to_string();
    let mut last_diagnostic = None::<String>;
    let mut seen_sources = HashSet::<String>::new();
    let mut saw_non_empty_mismatch = false;
    let mut attempts_trace: Vec<ReadbackAttempt> = Vec::new();

    for (index, delay_ms) in READBACK_RETRY_DELAYS_MS.iter().enumerate() {
        if *delay_ms > 0 {
            thread::sleep(Duration::from_millis(*delay_ms));
        }
        let resolved = secure::get_model_api_key(secure_context, model_id)?;
        let read_key = resolved.api_key.unwrap_or_default().trim().to_string();
        last_key = read_key.clone();
        last_source = resolved.source;
        last_diagnostic = resolved.diagnostic_code;
        seen_sources.insert(last_source.clone());
        attempts_trace.push(ReadbackAttempt {
            attempt: (index + 1) as u32,
            key_len: read_key.len(),
            source: last_source.clone(),
            diagnostic: last_diagnostic.clone(),
        });

        if expect_cleared {
            if read_key.is_empty() {
                return Ok(ReadbackResult {
                    ok: true,
                    attempts: (index + 1) as u32,
                    key_len: 0,
                    source: last_source,
                    diagnostic: last_diagnostic,
                    source_drift: seen_sources.len() > 1,
                    non_empty_mismatch: false,
                    trace: attempts_trace,
                });
            }
            continue;
        }
        if !read_key.is_empty() && read_key == normalized_expected {
            return Ok(ReadbackResult {
                ok: true,
                attempts: (index + 1) as u32,
                key_len: read_key.len(),
                source: last_source,
                diagnostic: last_diagnostic,
                source_drift: seen_sources.len() > 1,
                non_empty_mismatch: false,
                trace: attempts_trace,
            });
        }
        if !read_key.is_empty() && read_key != normalized_expected {
            saw_non_empty_mismatch = true;
        }
    }

    Ok(ReadbackResult {
        ok: false,
        attempts: READBACK_RETRY_DELAYS_MS.len() as u32,
        key_len: last_key.len(),
        source: last_source,
        diagnostic: last_diagnostic,
        source_drift: seen_sources.len() > 1,
        non_empty_mismatch: saw_non_empty_mismatch,
        trace: attempts_trace,
    })
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
    let api_key = input.api_key.trim().to_string();
    let secure_context = secure::SecureStorageContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
    };

    if api_key.is_empty() {
        let clear_outcome = match secure::delete_model_api_key(&secure_context, model_id) {
            Ok(value) => value,
            Err(error) => {
                state.log(
                    "ERROR",
                    &format!("model_api_key_save_verified: clear failed for {model_id}, reason={error}"),
                );
                return Ok(CredentialSaveResult {
                    ok: false,
                    stage: "write".to_string(),
                    message: error,
                    storage_backend: "none".to_string(),
                    diagnostic_code: Some("SECURE_STORE_CLEAR_FAILED".to_string()),
                    readback_source: None,
                    readback_attempts: None,
                });
            }
        };

        let readback = verify_model_key_readback(&secure_context, model_id, "")?;
        if !readback.ok {
            state.log(
                "ERROR",
                &format!(
                    "model_api_key_save_verified: clear readback mismatch for {model_id}, attempts={}, key_len={}, source={}, diagnostic={}, trace={}",
                    readback.attempts,
                    readback.key_len,
                    readback.source,
                    readback
                        .diagnostic
                        .clone()
                        .unwrap_or_else(|| "-".to_string()),
                    format_readback_trace(&readback.trace),
                ),
            );
            return Ok(CredentialSaveResult {
                ok: false,
                stage: "write".to_string(),
                message: "key clear readback mismatch".to_string(),
                storage_backend: clear_outcome.backend,
                diagnostic_code: Some("KEY_CLEAR_READBACK_MISMATCH".to_string()),
                readback_source: Some(readback.source),
                readback_attempts: Some(readback.attempts),
            });
        }

        state.log(
            "INFO",
            &format!(
                "model_api_key_save_verified: cleared key for {model_id}, attempts={}, source={}, diagnostic={}, trace={}",
                readback.attempts,
                readback.source,
                readback
                    .diagnostic
                    .clone()
                    .unwrap_or_else(|| "-".to_string()),
                format_readback_trace(&readback.trace),
            ),
        );
        return Ok(CredentialSaveResult {
            ok: true,
            stage: "write".to_string(),
            message: "API key cleared".to_string(),
            storage_backend: clear_outcome.backend,
            diagnostic_code: clear_outcome.diagnostic_code.or(readback.diagnostic),
            readback_source: Some(readback.source),
            readback_attempts: Some(readback.attempts),
        });
    }

    let write_result = secure::store_model_api_key(&secure_context, model_id, &api_key);
    let write_outcome = match write_result {
        Ok(value) => value,
        Err(error) => {
            state.log(
                "ERROR",
                &format!("model_api_key_save_verified: save failed for {model_id}, reason={error}"),
            );
            return Ok(CredentialSaveResult {
                ok: false,
                stage: "write".to_string(),
                message: error,
                storage_backend: "none".to_string(),
                diagnostic_code: Some("SECURE_STORE_WRITE_FAILED".to_string()),
                readback_source: None,
                readback_attempts: None,
            });
        }
    };

    let readback = verify_model_key_readback(&secure_context, model_id, &api_key)?;

    if !readback.ok {
        let final_diagnostic = if readback.key_len == 0 {
            if readback.source_drift {
                "KEY_READ_SOURCE_DRIFT_EMPTY".to_string()
            } else {
                "KEY_READ_EMPTY_AFTER_WRITE".to_string()
            }
        } else if readback.non_empty_mismatch {
            "KEY_READ_NON_EMPTY_MISMATCH_AFTER_WRITE".to_string()
        } else {
            "KEY_READBACK_RETRY_EXHAUSTED".to_string()
        };
        state.log(
            "ERROR",
            &format!(
                "model_api_key_save_verified: readback failed for {model_id}, attempts={}, expected_len={}, actual_len={}, source={}, diagnostic={}, trace={}",
                readback.attempts,
                api_key.len(),
                readback.key_len,
                readback.source,
                readback
                    .diagnostic
                    .clone()
                    .unwrap_or_else(|| "-".to_string()),
                format_readback_trace(&readback.trace),
            ),
        );
        return Ok(CredentialSaveResult {
            ok: false,
            stage: "write".to_string(),
            message: "key readback mismatch after save".to_string(),
            storage_backend: write_outcome.backend,
            diagnostic_code: Some(final_diagnostic),
            readback_source: Some(readback.source),
            readback_attempts: Some(readback.attempts),
        });
    }

    state.log(
        "INFO",
        &format!(
            "model_api_key_save_verified: saved key for {model_id}, key_len={}, attempts={}, source={}, diagnostic={}, trace={}",
            api_key.len(),
            readback.attempts,
            readback.source,
            readback
                .diagnostic
                .clone()
                .unwrap_or_else(|| "-".to_string()),
            format_readback_trace(&readback.trace),
        ),
    );
    Ok(CredentialSaveResult {
        ok: true,
        stage: "write".to_string(),
        message: "API key saved".to_string(),
        storage_backend: write_outcome.backend,
        diagnostic_code: write_outcome.diagnostic_code.or(readback.diagnostic),
        readback_source: Some(readback.source),
        readback_attempts: Some(readback.attempts),
    })
}
