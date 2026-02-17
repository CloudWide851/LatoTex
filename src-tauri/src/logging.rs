use chrono::Local;
use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::Once;
use uuid::Uuid;

static PANIC_HOOK_ONCE: Once = Once::new();

fn now_for_filename() -> String {
    Local::now().format("%Y%m%d-%H%M%S").to_string()
}

fn now_for_line() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S%.3f").to_string()
}

fn random_suffix() -> String {
    Uuid::new_v4().to_string().replace('-', "")[..8].to_string()
}

pub fn create_session_log(logs_dir: &Path) -> Result<PathBuf, String> {
    fs::create_dir_all(logs_dir).map_err(|e| e.to_string())?;
    let name = format!("{}-{}.log", now_for_filename(), random_suffix());
    let path = logs_dir.join(name);
    OpenOptions::new()
        .create(true)
        .append(true)
        .open(&path)
        .map_err(|e| e.to_string())?;
    Ok(path)
}

pub fn append_log_line(log_file: &Path, level: &str, message: &str) -> Result<(), String> {
    let mut file = OpenOptions::new()
        .create(true)
        .append(true)
        .open(log_file)
        .map_err(|e| e.to_string())?;
    let sanitized = message.replace('\n', " ");
    let line = format!("[{}] [{}] {}\n", now_for_line(), level, sanitized);
    file.write_all(line.as_bytes()).map_err(|e| e.to_string())?;
    file.flush().map_err(|e| e.to_string())
}

pub fn install_panic_hook(logs_dir: PathBuf, session_log: PathBuf) {
    PANIC_HOOK_ONCE.call_once(move || {
        std::panic::set_hook(Box::new(move |panic_info| {
            let crash_file = logs_dir.join(format!(
                "{}-{}-crash.log",
                now_for_filename(),
                random_suffix()
            ));

            let payload = if let Some(s) = panic_info.payload().downcast_ref::<&str>() {
                s.to_string()
            } else if let Some(s) = panic_info.payload().downcast_ref::<String>() {
                s.clone()
            } else {
                "Unknown panic payload".to_string()
            };

            let location = panic_info
                .location()
                .map(|l| format!("{}:{}:{}", l.file(), l.line(), l.column()))
                .unwrap_or_else(|| "unknown".to_string());

            let backtrace = Backtrace::force_capture();
            let crash_body = format!(
                "timestamp: {}\nlocation: {}\nmessage: {}\n\nbacktrace:\n{}\n",
                now_for_line(),
                location,
                payload,
                backtrace
            );

            let _ = fs::write(&crash_file, crash_body);
            let _ = append_log_line(
                &session_log,
                "CRASH",
                &format!(
                    "panic captured at {}. crash log: {}",
                    location,
                    crash_file.to_string_lossy()
                ),
            );
        }));
    });
}
