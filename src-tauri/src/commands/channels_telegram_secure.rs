use crate::models::{Ack, AppSettings, TelegramTokenSaveInput, UiPrefs};
use crate::secure::{self, SecureStorageContext};
use crate::state::AppState;
use crate::storage;
use tauri::State;

pub(crate) const TELEGRAM_SECRET_ID: &str = "channel:telegram:bot-token:v1";

fn secure_context(state: &AppState) -> SecureStorageContext {
    SecureStorageContext {
        db_path: state.db_path.clone(),
        runtime_root: state.runtime_root.clone(),
    }
}

pub(crate) fn secure_token(state: &AppState) -> Result<String, String> {
    let result = secure::get_model_api_key(&secure_context(state), TELEGRAM_SECRET_ID)
        .map_err(|_| "channels.telegram.token_missing".to_string())?;
    let token = result.api_key.unwrap_or_default();
    if token.trim().is_empty() {
        Err("channels.telegram.token_missing".to_string())
    } else {
        Ok(token)
    }
}

fn secure_token_stored(state: &AppState) -> bool {
    secure::get_model_api_key(&secure_context(state), TELEGRAM_SECRET_ID)
        .ok()
        .and_then(|result| result.api_key)
        .is_some_and(|token| !token.trim().is_empty())
}

fn migrate_legacy_telegram_token_with<F>(
    channels: &mut crate::models::ChannelPrefs,
    mut store_and_verify: F,
) -> Result<bool, String>
where
    F: FnMut(&str) -> Result<(), String>,
{
    let Some(legacy_token) = channels
        .telegram_bot_token
        .as_deref()
        .map(str::trim)
        .filter(|token| !token.is_empty())
        .map(str::to_string)
    else {
        return Ok(false);
    };
    store_and_verify(&legacy_token)?;
    channels.telegram_bot_token = None;
    channels.telegram_token_stored = Some(true);
    Ok(true)
}

pub(crate) fn migrate_telegram_settings(
    state: &AppState,
    settings: &mut AppSettings,
) -> Result<bool, String> {
    let Some(prefs) = settings.ui_prefs.as_mut() else {
        return Ok(false);
    };
    let Some(channels) = prefs.channels.as_mut() else {
        return Ok(false);
    };
    let mut changed = false;
    if channels.telegram_proxy_mode.is_none() {
        channels.telegram_proxy_mode = Some(
            if channels.telegram_proxy_enabled == Some(false) {
                "direct"
            } else {
                "system"
            }
            .to_string(),
        );
        changed = true;
    }
    if channels.telegram_proxy_enabled.take().is_some() {
        changed = true;
    }
    let migrated = migrate_legacy_telegram_token_with(channels, |legacy_token| {
        secure::store_model_api_key(&secure_context(state), TELEGRAM_SECRET_ID, legacy_token)
            .map_err(|_| "channels.telegram.token_migration_failed".to_string())?;
        let loaded = secure_token(state)
            .map_err(|_| "channels.telegram.token_migration_verify_failed".to_string())?;
        if loaded != legacy_token {
            return Err("channels.telegram.token_migration_verify_failed".to_string());
        }
        Ok(())
    })?;
    if migrated {
        changed = true;
    } else {
        let stored = secure_token_stored(state);
        if channels.telegram_token_stored != Some(stored) {
            channels.telegram_token_stored = Some(stored);
            changed = true;
        }
    }
    Ok(changed)
}

pub(crate) fn preserve_legacy_telegram_token(
    existing: &AppSettings,
    incoming_ui_prefs: &mut Option<UiPrefs>,
) {
    let Some(legacy_token) = existing
        .ui_prefs
        .as_ref()
        .and_then(|prefs| prefs.channels.as_ref())
        .and_then(|channels| channels.telegram_bot_token.as_ref())
        .filter(|token| !token.trim().is_empty())
        .cloned()
    else {
        return;
    };
    let channels = incoming_ui_prefs
        .get_or_insert_with(Default::default)
        .channels
        .get_or_insert_with(Default::default);
    if channels.telegram_bot_token.is_none() {
        channels.telegram_bot_token = Some(legacy_token);
    }
}

pub(crate) fn scrub_telegram_secret(settings: &mut AppSettings) {
    if let Some(channels) = settings
        .ui_prefs
        .as_mut()
        .and_then(|prefs| prefs.channels.as_mut())
    {
        channels.telegram_bot_token = None;
        channels.telegram_proxy_enabled = None;
    }
}

#[tauri::command]
pub async fn channels_telegram_token_save_verified(
    state: State<'_, AppState>,
    input: TelegramTokenSaveInput,
) -> Result<Ack, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        let token = input.token.trim().to_string();
        if token.is_empty()
            || token.len() > 512
            || token.chars().any(|character| character.is_whitespace())
        {
            return Err("channels.telegram.token_invalid".to_string());
        }
        secure::store_model_api_key(&secure_context(&state), TELEGRAM_SECRET_ID, &token)
            .map_err(|_| "channels.telegram.token_save_failed".to_string())?;
        let loaded = secure_token(&state)
            .map_err(|_| "channels.telegram.token_verify_failed".to_string())?;
        if loaded != token {
            return Err("channels.telegram.token_verify_failed".to_string());
        }
        let mut settings = storage::load_settings(&state.db_path, &state.runtime_root)?;
        let channels = settings
            .ui_prefs
            .get_or_insert_with(Default::default)
            .channels
            .get_or_insert_with(Default::default);
        channels.telegram_bot_token = None;
        channels.telegram_token_stored = Some(true);
        storage::persist_ui_prefs(&state.db_path, &settings.ui_prefs)?;
        state.log(
            "INFO",
            "channels_telegram_token_save_verified: token securely stored",
        );
        Ok(Ack {
            ok: true,
            message: "stored".to_string(),
        })
    })
    .await
    .map_err(|_| "channels.telegram.token_save_failed".to_string())?
}

#[tauri::command]
pub async fn channels_telegram_token_clear(state: State<'_, AppState>) -> Result<Ack, String> {
    let state = state.inner().clone();
    tauri::async_runtime::spawn_blocking(move || {
        secure::delete_model_api_key(&secure_context(&state), TELEGRAM_SECRET_ID)
            .map_err(|_| "channels.telegram.token_clear_failed".to_string())?;
        let mut settings = storage::load_settings(&state.db_path, &state.runtime_root)?;
        if let Some(channels) = settings
            .ui_prefs
            .as_mut()
            .and_then(|prefs| prefs.channels.as_mut())
        {
            channels.telegram_bot_token = None;
            channels.telegram_token_stored = Some(false);
        }
        storage::persist_ui_prefs(&state.db_path, &settings.ui_prefs)?;
        state.log("INFO", "channels_telegram_token_clear: token cleared");
        Ok(Ack {
            ok: true,
            message: "cleared".to_string(),
        })
    })
    .await
    .map_err(|_| "channels.telegram.token_clear_failed".to_string())?
}

#[cfg(test)]
#[path = "channels_telegram_secure_tests.rs"]
mod tests;
