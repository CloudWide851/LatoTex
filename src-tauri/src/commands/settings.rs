use crate::models::{AppSettings, ProviderHealth, ProviderTestInput, SettingsUpdateInput};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, String> {
    storage::load_settings(&state.db_path)
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    input: SettingsUpdateInput,
) -> Result<AppSettings, String> {
    storage::update_settings(&state.db_path, input)
}

#[tauri::command]
pub fn provider_test(
    _state: State<'_, AppState>,
    input: ProviderTestInput,
) -> Result<ProviderHealth, String> {
    let has_key = secure::has_api_key(&input.provider)?;
    let message = if has_key {
        "API key is available in system keyring"
    } else {
        "No API key found in system keyring"
    };
    Ok(ProviderHealth {
        provider: input.provider,
        ok: has_key,
        message: message.to_string(),
    })
}
