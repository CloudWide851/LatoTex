use crate::models::{
    Ack, RuntimeLogClearInput, RuntimeLogEntry, RuntimeLogInfo, RuntimeLogReadInput,
    RuntimeLogReadResponse, RuntimeLogSession, RuntimeLogSessionListResponse, RuntimeLogWriteInput,
};
use crate::state::AppState;
use chrono::{DateTime, Utc};
use std::fs;
use std::fs::File;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use tauri::State;

const CLEAR_SESSION_TOKEN: &str = "CLEAR_CURRENT_SESSION";

fn normalize_log_file_name(raw: &str) -> Result<String, String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Err("Log file name is required".to_string());
    }
    if trimmed.contains('/') || trimmed.contains('\\') {
        return Err("Log file name must not contain path separators".to_string());
    }
    if trimmed.contains("..") {
        return Err("Log file name must not contain parent path segments".to_string());
    }
    if !trimmed.to_ascii_lowercase().ends_with(".log") {
        return Err("Log file name must end with .log".to_string());
    }
    Ok(trimmed.to_string())
}

fn resolve_log_path_from_roots(
    logs_dir: &Path,
    session_log_path: &Path,
    input_name: Option<&str>,
) -> Result<PathBuf, String> {
    let Some(raw) = input_name else {
        return Ok(session_log_path.to_path_buf());
    };
    let normalized = normalize_log_file_name(raw)?;
    let candidate = logs_dir.join(&normalized);
    if !candidate.exists() {
        return Err(format!("Log file not found: {normalized}"));
    }
    let logs_dir_resolved = logs_dir
        .canonicalize()
        .map_err(|e| format!("Failed to resolve logs directory: {e}"))?;
    let candidate_resolved = candidate
        .canonicalize()
        .map_err(|e| format!("Failed to resolve log file path: {e}"))?;
    if !candidate_resolved.starts_with(&logs_dir_resolved) {
        return Err("Resolved log file is outside logs directory".to_string());
    }
    Ok(candidate_resolved)
}

fn resolve_log_path(state: &AppState, input_name: Option<&str>) -> Result<PathBuf, String> {
    resolve_log_path_from_roots(&state.logs_dir, &state.session_log_path, input_name)
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

#[tauri::command]
pub fn runtime_log_list_sessions(
    state: State<'_, AppState>,
) -> Result<RuntimeLogSessionListResponse, String> {
    let current_file_name = state
        .session_log_path
        .file_name()
        .map(|name| name.to_string_lossy().to_string());

    let mut sessions: Vec<(RuntimeLogSession, i64)> = Vec::new();
    let entries = fs::read_dir(&state.logs_dir).map_err(|e| e.to_string())?;
    for entry in entries {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        if !path.is_file() {
            continue;
        }
        let file_name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_default();
        if !file_name.to_ascii_lowercase().ends_with(".log") {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        let modified = metadata.modified().ok();
        let modified_at = modified
            .map(|value| DateTime::<Utc>::from(value).to_rfc3339())
            .unwrap_or_else(|| "1970-01-01T00:00:00Z".to_string());
        let modified_key = modified
            .and_then(|value| value.duration_since(std::time::UNIX_EPOCH).ok())
            .map(|duration| duration.as_secs() as i64)
            .unwrap_or(0);
        let is_current = current_file_name
            .as_deref()
            .map(|current| current.eq_ignore_ascii_case(&file_name))
            .unwrap_or(false);
        sessions.push((
            RuntimeLogSession {
                file_name,
                modified_at,
                size_bytes: metadata.len(),
                is_current,
            },
            modified_key,
        ));
    }

    sessions.sort_by(|(left, left_key), (right, right_key)| {
        right_key
            .cmp(left_key)
            .then_with(|| left.file_name.cmp(&right.file_name))
    });

    Ok(RuntimeLogSessionListResponse {
        sessions: sessions.into_iter().map(|(item, _)| item).collect(),
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

fn runtime_log_entry_matches(entry: &RuntimeLogEntry, input: &RuntimeLogReadInput) -> bool {
    if let Some(level) = input.level.as_deref() {
        let level = level.trim().to_uppercase();
        if !level.is_empty() && entry.level.to_uppercase() != level {
            return false;
        }
    }
    if let Some(keyword) = input.keyword.as_deref() {
        let keyword = keyword.trim().to_lowercase();
        if !keyword.is_empty() {
            let haystack = format!("{} {}", entry.message, entry.raw).to_lowercase();
            if !haystack.contains(&keyword) {
                return false;
            }
        }
    }
    if let Some(from_time) = input.from_time.as_deref() {
        let from_time = from_time.trim();
        if !from_time.is_empty() && !entry.timestamp.is_empty() && entry.timestamp.as_str() < from_time {
            return false;
        }
    }
    if let Some(to_time) = input.to_time.as_deref() {
        let to_time = to_time.trim();
        if !to_time.is_empty() && !entry.timestamp.is_empty() && entry.timestamp.as_str() > to_time {
            return false;
        }
    }
    true
}

fn input_has_runtime_log_filters(input: &RuntimeLogReadInput) -> bool {
    let has_non_empty = |value: &Option<String>| {
        value
            .as_deref()
            .map(str::trim)
            .filter(|item| !item.is_empty())
            .is_some()
    };
    has_non_empty(&input.level)
        || has_non_empty(&input.keyword)
        || has_non_empty(&input.from_time)
        || has_non_empty(&input.to_time)
}

fn read_last_log_lines(path: &Path, limit: usize) -> Result<Vec<String>, String> {
    if limit == 0 {
        return Ok(Vec::new());
    }
    let mut file = match File::open(path) {
        Ok(handle) => handle,
        Err(_) => return Ok(Vec::new()),
    };
    let file_len = file.metadata().map_err(|e| e.to_string())?.len();
    if file_len == 0 {
        return Ok(Vec::new());
    }

    let mut position = file_len;
    let mut newline_count = 0_usize;
    let mut chunks: Vec<Vec<u8>> = Vec::new();
    const CHUNK_SIZE: u64 = 8192;

    while position > 0 && newline_count <= limit {
        let read_len = CHUNK_SIZE.min(position) as usize;
        position -= read_len as u64;
        file.seek(SeekFrom::Start(position))
            .map_err(|e| e.to_string())?;
        let mut buffer = vec![0_u8; read_len];
        file.read_exact(&mut buffer).map_err(|e| e.to_string())?;
        newline_count += buffer.iter().filter(|byte| **byte == b'\n').count();
        chunks.push(buffer);
    }

    chunks.reverse();
    let mut bytes = Vec::new();
    for chunk in chunks {
        bytes.extend_from_slice(&chunk);
    }

    let text = String::from_utf8_lossy(&bytes);
    let mut lines: Vec<&str> = text.lines().collect();
    if position > 0 && !lines.is_empty() {
        lines.remove(0);
    }

    let mut collected = lines
        .into_iter()
        .filter(|line| !line.trim().is_empty())
        .map(|line| line.to_string())
        .collect::<Vec<_>>();

    if collected.len() > limit {
        let start = collected.len() - limit;
        collected = collected.split_off(start);
    }
    Ok(collected)
}

#[tauri::command]
pub fn runtime_log_read(
    state: State<'_, AppState>,
    input: RuntimeLogReadInput,
) -> Result<RuntimeLogReadResponse, String> {
    let max_limit = 5000_u32;
    let limit = input.limit.unwrap_or(500).clamp(1, max_limit) as usize;
    let has_filters = input_has_runtime_log_filters(&input);
    let path = resolve_log_path(&state, input.log_file_name.as_deref())?;

    let mut entries: Vec<RuntimeLogEntry> = if !has_filters {
        read_last_log_lines(&path, limit)?
            .iter()
            .map(|line| parse_runtime_log_line(line))
            .collect()
    } else {
        let content = fs::read_to_string(&path).unwrap_or_default();
        content
            .lines()
            .filter(|line| !line.trim().is_empty())
            .map(parse_runtime_log_line)
            .filter(|entry| runtime_log_entry_matches(entry, &input))
            .collect()
    };

    if entries.len() > limit {
        let start = entries.len() - limit;
        entries = entries.split_off(start);
    }
    Ok(RuntimeLogReadResponse { entries })
}

#[tauri::command]
pub fn runtime_log_clear_current_session(
    state: State<'_, AppState>,
    input: RuntimeLogClearInput,
) -> Result<Ack, String> {
    let token = input.confirm_token.unwrap_or_default();
    if token.trim() != CLEAR_SESSION_TOKEN {
        return Err("Invalid confirm token".to_string());
    }
    fs::write(&state.session_log_path, "").map_err(|e| e.to_string())?;
    state.log("WARN", "runtime_log_clear_current_session");
    Ok(Ack {
        ok: true,
        message: "cleared".to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::{normalize_log_file_name, resolve_log_path_from_roots};
    use std::fs;
    use std::path::PathBuf;
    use std::time::{SystemTime, UNIX_EPOCH};

    fn make_temp_logs_dir() -> PathBuf {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .expect("clock")
            .as_nanos();
        let dir = std::env::temp_dir().join(format!("latotex-log-test-{now}"));
        fs::create_dir_all(&dir).expect("create temp logs dir");
        dir
    }

    #[test]
    fn accepts_plain_log_file_name() {
        let output = normalize_log_file_name("20260319-abc123.log").expect("should parse");
        assert_eq!(output, "20260319-abc123.log");
    }

    #[test]
    fn rejects_path_segments() {
        assert!(normalize_log_file_name("../x.log").is_err());
        assert!(normalize_log_file_name("logs/x.log").is_err());
        assert!(normalize_log_file_name("logs\\x.log").is_err());
    }

    #[test]
    fn rejects_non_log_extension() {
        assert!(normalize_log_file_name("runtime.txt").is_err());
    }

    #[test]
    fn resolves_explicit_log_file_name() {
        let logs_dir = make_temp_logs_dir();
        let session_log = logs_dir.join("session.log");
        let target_log = logs_dir.join("20260320-test.log");
        fs::write(&session_log, "session").expect("write session log");
        fs::write(&target_log, "target").expect("write target log");

        let resolved = resolve_log_path_from_roots(&logs_dir, &session_log, Some("20260320-test.log"))
            .expect("resolve explicit log");
        let resolved_name = resolved
            .file_name()
            .map(|item| item.to_string_lossy().to_string())
            .unwrap_or_default();
        assert_eq!(resolved_name, "20260320-test.log");

        let _ = fs::remove_dir_all(logs_dir);
    }

    #[test]
    fn falls_back_to_session_log_when_name_missing() {
        let logs_dir = make_temp_logs_dir();
        let session_log = logs_dir.join("session.log");
        fs::write(&session_log, "session").expect("write session log");

        let resolved = resolve_log_path_from_roots(&logs_dir, &session_log, None)
            .expect("resolve session log");
        assert_eq!(resolved, session_log);

        let _ = fs::remove_dir_all(logs_dir);
    }
}