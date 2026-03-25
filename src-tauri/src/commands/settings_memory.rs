use crate::models::RuntimeMemorySnapshot;
use crate::state::AppState;
use tauri::State;

#[cfg(not(target_os = "windows"))]
use std::fs;

#[cfg(target_os = "windows")]
fn sample_current_process_memory_bytes() -> (u64, Option<u64>) {
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX,
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
    (
        counters.WorkingSetSize as u64,
        Some(counters.PrivateUsage as u64),
    )
}

#[cfg(not(target_os = "windows"))]
fn sample_current_process_memory_bytes() -> (u64, Option<u64>) {
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

#[cfg(target_os = "windows")]
fn sample_process_memory_bytes(process_id: u32) -> (u64, Option<u64>) {
    use windows_sys::Win32::Foundation::CloseHandle;
    use windows_sys::Win32::System::ProcessStatus::{
        K32GetProcessMemoryInfo, PROCESS_MEMORY_COUNTERS_EX,
    };
    use windows_sys::Win32::System::Threading::{
        OpenProcess, PROCESS_QUERY_LIMITED_INFORMATION, PROCESS_VM_READ,
    };

    let handle = unsafe {
        OpenProcess(
            PROCESS_QUERY_LIMITED_INFORMATION | PROCESS_VM_READ,
            0,
            process_id,
        )
    };
    if handle.is_null() {
        return (0, None);
    }

    let mut counters: PROCESS_MEMORY_COUNTERS_EX = unsafe { std::mem::zeroed() };
    let ok = unsafe {
        K32GetProcessMemoryInfo(
            handle,
            &mut counters as *mut PROCESS_MEMORY_COUNTERS_EX as *mut _,
            std::mem::size_of::<PROCESS_MEMORY_COUNTERS_EX>() as u32,
        )
    };
    unsafe {
        CloseHandle(handle);
    }
    if ok == 0 {
        return (0, None);
    }
    (
        counters.WorkingSetSize as u64,
        Some(counters.PrivateUsage as u64),
    )
}

#[cfg(target_os = "windows")]
fn utf16_cstr_to_lower(input: &[u16]) -> String {
    let len = input
        .iter()
        .position(|value| *value == 0)
        .unwrap_or(input.len());
    String::from_utf16_lossy(&input[..len]).to_lowercase()
}

#[cfg(target_os = "windows")]
fn is_webview_process_name(name: &str) -> bool {
    name.contains("msedgewebview2") || name.contains("webview2")
}

#[cfg(target_os = "windows")]
fn sample_webview_children_memory(parent_process_id: u32) -> (u64, u64, u32) {
    use windows_sys::Win32::Foundation::{CloseHandle, INVALID_HANDLE_VALUE};
    use windows_sys::Win32::System::Diagnostics::ToolHelp::{
        CreateToolhelp32Snapshot, Process32FirstW, Process32NextW, PROCESSENTRY32W,
        TH32CS_SNAPPROCESS,
    };

    let snapshot = unsafe { CreateToolhelp32Snapshot(TH32CS_SNAPPROCESS, 0) };
    if snapshot == INVALID_HANDLE_VALUE {
        return (0, 0, 0);
    }

    let mut entry: PROCESSENTRY32W = unsafe { std::mem::zeroed() };
    entry.dwSize = std::mem::size_of::<PROCESSENTRY32W>() as u32;

    let mut rss_total = 0_u64;
    let mut private_total = 0_u64;
    let mut process_count = 0_u32;

    let mut ok = unsafe { Process32FirstW(snapshot, &mut entry) };
    while ok != 0 {
        if entry.th32ParentProcessID == parent_process_id {
            let name = utf16_cstr_to_lower(&entry.szExeFile);
            if is_webview_process_name(&name) {
                let (rss, private_bytes) = sample_process_memory_bytes(entry.th32ProcessID);
                if rss > 0 || private_bytes.is_some() {
                    process_count = process_count.saturating_add(1);
                    rss_total = rss_total.saturating_add(rss);
                    private_total = private_total.saturating_add(private_bytes.unwrap_or(0));
                }
            }
        }
        ok = unsafe { Process32NextW(snapshot, &mut entry) };
    }

    unsafe {
        CloseHandle(snapshot);
    }

    (rss_total, private_total, process_count)
}

#[tauri::command]
pub fn runtime_memory_snapshot(
    _state: State<'_, AppState>,
) -> Result<RuntimeMemorySnapshot, String> {
    let process_id = std::process::id();
    let (rss_bytes, private_bytes) = sample_current_process_memory_bytes();

    #[cfg(target_os = "windows")]
    let (
        webview_rss_bytes,
        webview_private_raw,
        webview_process_count,
        total_rss_bytes,
        total_private_bytes,
    ) = {
        let (webview_rss, webview_private, webview_count) =
            sample_webview_children_memory(process_id);
        let total_rss = rss_bytes.saturating_add(webview_rss);
        let total_private = private_bytes.map(|value| value.saturating_add(webview_private));
        (
            Some(webview_rss),
            Some(webview_private),
            Some(webview_count),
            Some(total_rss),
            total_private,
        )
    };

    #[cfg(not(target_os = "windows"))]
    let (
        webview_rss_bytes,
        webview_private_raw,
        webview_process_count,
        total_rss_bytes,
        total_private_bytes,
    ) = (None, None, None, None, private_bytes);

    Ok(RuntimeMemorySnapshot {
        process_id,
        rss_bytes,
        private_bytes,
        webview_rss_bytes,
        webview_private_bytes: webview_private_raw,
        webview_process_count,
        total_rss_bytes,
        total_private_bytes,
        sampled_at: chrono::Utc::now().to_rfc3339(),
    })
}
