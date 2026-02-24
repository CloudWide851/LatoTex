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

    if api_key.is_empty() {
        if let Err(error) = secure::delete_model_api_key(model_id) {
            state.log(
                "ERROR",
                &format!("model_api_key_save_verified: clear failed for {model_id}, reason={error}"),
            );
            return Ok(CredentialSaveResult {
                ok: false,
                stage: "write".to_string(),
                message: error,
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
        });
    }

    if let Err(error) = secure::store_model_api_key(model_id, &api_key) {
        state.log(
            "ERROR",
            &format!("model_api_key_save_verified: save failed for {model_id}, reason={error}"),
        );
        return Ok(CredentialSaveResult {
            ok: false,
            stage: "write".to_string(),
            message: error,
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
    })
}
