use crate::models::{
    Ack, AppSettings, ProviderHealth, ProviderTestInput, RuntimeLogInfo, RuntimeLogWriteInput,
    SettingsUpdateInput,
};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use tauri::State;

#[tauri::command]
pub fn settings_get(state: State<'_, AppState>) -> Result<AppSettings, String> {
    state.log("INFO", "settings_get");
    storage::load_settings(&state.db_path)
}

#[tauri::command]
pub fn settings_update(
    state: State<'_, AppState>,
    input: SettingsUpdateInput,
) -> Result<AppSettings, String> {
    state.log("INFO", "settings_update");
    storage::update_settings(&state.db_path, input)
}

#[tauri::command]
pub fn provider_test(
    _state: State<'_, AppState>,
    input: ProviderTestInput,
) -> Result<ProviderHealth, String> {
    _state.log("INFO", &format!("provider_test: {}", input.provider));
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

#[tauri::command]
pub fn runtime_log_write(
    state: State<'_, AppState>,
    input: RuntimeLogWriteInput,
) -> Result<Ack, String> {
    let level = if input.level.trim().is_empty() {
        "INFO"
    } else {
        input.level.trim()
    };
    state.log(level, &input.message);
    Ok(Ack {
        ok: true,
        message: "logged".to_string(),
    })
}

#[tauri::command]
pub fn runtime_log_info(state: State<'_, AppState>) -> Result<RuntimeLogInfo, String> {
    Ok(RuntimeLogInfo {
        session_log_file: state.session_log_path.to_string_lossy().to_string(),
        logs_dir: state.logs_dir.to_string_lossy().to_string(),
        install_mode: state.install_mode.clone(),
        version: state.app_version.clone(),
    })
}
