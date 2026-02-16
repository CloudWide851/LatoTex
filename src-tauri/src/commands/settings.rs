use crate::models::{
    Ack, AppSettings, ProtocolHealth, ProtocolTestInput, RuntimeLogEntry, RuntimeLogInfo,
    RuntimeLogReadInput, RuntimeLogReadResponse, RuntimeLogWriteInput, SettingsUpdateInput,
};
use crate::secure;
use crate::state::AppState;
use crate::storage;
use std::fs;
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
pub fn protocol_test(
    _state: State<'_, AppState>,
    input: ProtocolTestInput,
) -> Result<ProtocolHealth, String> {
    _state.log("INFO", &format!("protocol_test: {}", input.protocol_id));
    let has_key = secure::has_api_key(&input.protocol_id)?;
    let message = if has_key {
        "API key is available in system keyring"
    } else {
        "No API key found in system keyring"
    };
    Ok(ProtocolHealth {
        protocol_id: input.protocol_id,
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
        runtime_root: state.runtime_root.to_string_lossy().to_string(),
        install_mode: state.install_mode.clone(),
        version: state.app_version.clone(),
    })
}

fn parse_runtime_log_line(raw_line: &str) -> RuntimeLogEntry {
    let raw = raw_line.to_string();
    let mut timestamp = String::new();
    let mut level = "INFO".to_string();
    let mut message = raw_line.to_string();

    if raw_line.starts_with('[') {
        if let Some(ts_end) = raw_line.find(']') {
            timestamp = raw_line[1..ts_end].trim().to_string();
            let rest = raw_line[ts_end + 1..].trim_start();
            if rest.starts_with('[') {
                if let Some(level_end) = rest.find(']') {
                    let parsed_level = rest[1..level_end].trim();
                    if !parsed_level.is_empty() {
                        level = parsed_level.to_uppercase();
                    }
                    message = rest[level_end + 1..].trim_start().to_string();
                } else {
                    message = rest.to_string();
                }
            } else {
                message = rest.to_string();
            }
        }
    }

    RuntimeLogEntry {
        timestamp,
        level,
        message,
        raw,
    }
}

#[tauri::command]
pub fn runtime_log_read(
    state: State<'_, AppState>,
    input: RuntimeLogReadInput,
) -> Result<RuntimeLogReadResponse, String> {
    let max_limit = 5000_u32;
    let limit = input.limit.unwrap_or(500).clamp(1, max_limit) as usize;
    let content = fs::read_to_string(&state.session_log_path).map_err(|e| e.to_string())?;
    let mut entries: Vec<RuntimeLogEntry> = content
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(parse_runtime_log_line)
        .collect();
    if entries.len() > limit {
        let start = entries.len() - limit;
        entries = entries.split_off(start);
    }
    Ok(RuntimeLogReadResponse { entries })
}
