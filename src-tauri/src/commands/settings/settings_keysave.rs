use crate::models::{CredentialSaveResult, ModelApiKeySaveVerifiedInput};
use crate::secure;
use crate::state::AppState;
use tauri::State;

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
            });
            }
        };
        let cleared = secure::get_model_api_key(&secure_context, model_id)
            .map(|value| value.api_key.unwrap_or_default())
            .unwrap_or_default();
        if !cleared.is_empty() {
            state.log(
                "ERROR",
                &format!("model_api_key_save_verified: clear readback mismatch for {model_id}"),
            );
            return Ok(CredentialSaveResult {
                ok: false,
                stage: "write".to_string(),
                message: "key clear readback mismatch".to_string(),
                storage_backend: clear_outcome.backend,
                diagnostic_code: Some("KEY_CLEAR_READBACK_MISMATCH".to_string()),
            });
        }
        state.log(
            "INFO",
            &format!("model_api_key_save_verified: cleared key for {model_id}, key_len=0"),
        );
        return Ok(CredentialSaveResult {
            ok: true,
            stage: "write".to_string(),
            message: "API key cleared".to_string(),
            storage_backend: clear_outcome.backend,
            diagnostic_code: clear_outcome.diagnostic_code,
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
            });
        }
    };

    let read_back = match secure::get_model_api_key(&secure_context, model_id) {
        Ok(value) => value.api_key.unwrap_or_default(),
        Err(error) => {
            state.log(
                "ERROR",
                &format!("model_api_key_save_verified: readback failed for {model_id}, reason={error}"),
            );
            return Ok(CredentialSaveResult {
                ok: false,
                stage: "write".to_string(),
                message: error,
                storage_backend: write_outcome.backend,
                diagnostic_code: Some("SECURE_STORE_READ_FAILED".to_string()),
            });
        }
    };

    if read_back.trim().is_empty() {
        state.log(
            "ERROR",
            &format!(
                "model_api_key_save_verified: readback empty for {model_id}, key_len={}",
                api_key.len()
            ),
        );
        return Ok(CredentialSaveResult {
            ok: false,
            stage: "write".to_string(),
            message: "key readback empty after save".to_string(),
            storage_backend: write_outcome.backend,
            diagnostic_code: Some("KEY_READ_EMPTY_AFTER_WRITE".to_string()),
        });
    }

    state.log(
        "INFO",
        &format!(
            "model_api_key_save_verified: saved key for {model_id}, key_len={}",
            api_key.len()
        ),
    );
    Ok(CredentialSaveResult {
        ok: true,
        stage: "write".to_string(),
        message: "API key saved".to_string(),
        storage_backend: write_outcome.backend,
        diagnostic_code: write_outcome.diagnostic_code,
    })
}
