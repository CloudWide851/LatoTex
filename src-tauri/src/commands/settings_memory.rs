use crate::models::RuntimeMemorySnapshot;
use crate::state::AppState;
use std::process::Command;
use tauri::State;
#[cfg(not(target_os = "windows"))]
use std::fs;

#[cfg(target_os = "windows")]
fn sample_process_memory_bytes(process_id: u32) -> (u64, Option<u64>) {
    let command = format!(
        "Get-Process -Id {process_id} | Select-Object Id,WorkingSet64,PrivateMemorySize64 | ConvertTo-Json -Compress"
    );
    let output = Command::new("powershell")
        .arg("-NoProfile")
        .arg("-Command")
        .arg(command)
        .output();
    let Ok(output) = output else {
        return (0, None);
    };
    if !output.status.success() {
        return (0, None);
    }
    let raw = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if raw.is_empty() {
        return (0, None);
    }
    let parsed: serde_json::Value = match serde_json::from_str(&raw) {
        Ok(value) => value,
        Err(_) => return (0, None),
    };
    let rss = parsed
        .get("WorkingSet64")
        .and_then(|value| value.as_u64())
        .unwrap_or(0);
    let private = parsed
        .get("PrivateMemorySize64")
        .and_then(|value| value.as_u64());
    (rss, private)
}

#[cfg(not(target_os = "windows"))]
fn sample_process_memory_bytes(_process_id: u32) -> (u64, Option<u64>) {
    let Ok(raw) = fs::read_to_string("/proc/self/statm") else {
        return (0, None);
    };
    let mut parts = raw.split_whitespace();
    let _total_pages = parts.next();
    let rss_pages = parts
        .next()
        .and_then(|value| value.parse::<u64>().ok())
        .unwrap_or(0);
    let page_size = 4096_u64;
    (rss_pages.saturating_mul(page_size), None)
}

#[tauri::command]
pub fn runtime_memory_snapshot(
    _state: State<'_, AppState>,
) -> Result<RuntimeMemorySnapshot, String> {
    let process_id = std::process::id();
    let (rss_bytes, private_bytes) = sample_process_memory_bytes(process_id);
    Ok(RuntimeMemorySnapshot {
        process_id,
        rss_bytes,
        private_bytes,
        sampled_at: chrono::Utc::now().to_rfc3339(),
    })
}
