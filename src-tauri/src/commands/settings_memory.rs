use crate::models::RuntimeMemorySnapshot;
use crate::state::AppState;
use tauri::State;

#[cfg(not(target_os = "windows"))]
use std::fs;

#[cfg(target_os = "windows")]
fn sample_process_memory_bytes(_process_id: u32) -> (u64, Option<u64>) {
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo,
        PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::Threading::GetCurrentProcess;

    let mut counters: PROCESS_MEMORY_COUNTERS_EX = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        K32GetProcessMemoryInfo(
            GetCurrentProcess(),
            &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut _,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        )
    };
    if ok == 0 {
        return (0, None);
    }
    (counters.WorkingSetSize as u64, Some(counters.PrivateUsage as u64))
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
