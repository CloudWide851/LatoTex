use serde_json::json;
use std::io::Write;
use std::path::{Path, PathBuf};

pub fn arg_flag(name: &str) -> bool {
    std::env::args().any(|arg| arg == name)
}

pub fn arg_value(name: &str) -> Option<String> {
    let prefix = format!("{name}=");
    std::env::args()
        .find_map(|arg| arg.strip_prefix(&prefix).map(|value| value.to_string()))
}

pub fn enabled() -> bool {
    std::env::var("LATOTEX_SMOKE").ok().as_deref() == Some("1") || arg_flag("--latotex-smoke")
}

pub fn runtime_root() -> Option<PathBuf> {
    arg_value("--latotex-runtime-root")
        .or_else(|| std::env::var("LATOTEX_E2E_RUNTIME_ROOT").ok())
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

pub fn report_path(default_root: Option<&Path>) -> Option<PathBuf> {
    arg_value("--latotex-smoke-report")
        .or_else(|| std::env::var("LATOTEX_SMOKE_REPORT_PATH").ok())
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| default_root.map(|root| root.join("tauri-smoke-report.json")))
}

pub fn progress_path(default_root: Option<&Path>) -> Option<PathBuf> {
    arg_value("--latotex-smoke-progress")
        .or_else(|| std::env::var("LATOTEX_SMOKE_PROGRESS_PATH").ok())
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| runtime_root().map(|root| root.join("tauri-smoke-progress.ndjson")))
        .or_else(|| default_root.map(|root| root.join("tauri-smoke-progress.ndjson")))
}

pub fn scenario() -> Option<String> {
    arg_value("--latotex-smoke-scenario")
        .or_else(|| std::env::var("LATOTEX_SMOKE_SCENARIO").ok())
        .filter(|value| !value.trim().is_empty())
}

pub fn write_progress(stage: &str, status: &str, detail: Option<serde_json::Value>) {
    if !enabled() {
        return;
    }
    let Some(path) = progress_path(None) else {
        return;
    };
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = json!({
        "schema": "latotex.tauri-smoke.progress.v1",
        "pid": std::process::id(),
        "timestamp": crate::storage::now_iso(),
        "stage": stage,
        "status": status,
        "detail": detail,
    });
    if let Ok(mut file) = std::fs::OpenOptions::new().create(true).append(true).open(path) {
        if let Ok(line) = serde_json::to_string(&payload) {
            let _ = writeln!(file, "{line}");
        }
    }
}

pub fn write_boot_marker() {
    if !enabled() {
        return;
    }
    let Some(runtime_root) = runtime_root() else {
        return;
    };
    let path = runtime_root.join("tauri-smoke-boot.json");
    if let Some(parent) = path.parent() {
        let _ = std::fs::create_dir_all(parent);
    }
    let payload = json!({
        "schema": "latotex.tauri-smoke.boot.v1",
        "pid": std::process::id(),
        "timestamp": crate::storage::now_iso(),
        "args": std::env::args().collect::<Vec<_>>(),
        "progressPath": progress_path(Some(&runtime_root)).map(|path| path.to_string_lossy().to_string()),
    });
    if let Ok(serialized) = serde_json::to_string_pretty(&payload) {
        let _ = std::fs::write(path, serialized);
    }
    write_progress("rust.boot", "ok", None);
}
