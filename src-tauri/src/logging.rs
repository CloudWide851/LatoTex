use chrono::Local;
use regex::{Captures, Regex};
use std::backtrace::Backtrace;
use std::fs::{self, OpenOptions};
use std::io::Write;
use std::path::{Path, PathBuf};
use std::sync::{Once, OnceLock};
use uuid::Uuid;

static PANIC_HOOK_ONCE: Once = Once::new();
const LOG_MESSAGE_LIMIT: usize = 2_048;

fn secret_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(
            r#"(?i)(?P<prefix>\\?[\"']?\b(api[_-]?key|apikey|authorization|password|passwd|secret|access[_-]?token|refresh[_-]?token|token|x-api-key)\b\\?[\"']?\s*[:=]\s*)(?P<value>\"[^\"]*\"|'[^']*'|[^\s,;\}\]]+)"#,
        )
        .expect("valid log secret regex")
    })
}

fn bearer_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| {
        Regex::new(r"(?i)\bbearer\s+[A-Za-z0-9._~+/=-]+").expect("valid bearer regex")
    })
}

fn url_pattern() -> &'static Regex {
    static PATTERN: OnceLock<Regex> = OnceLock::new();
    PATTERN.get_or_init(|| Regex::new(r#"(?i)https?://[^\s\"'<>]+"#).expect("valid URL regex"))
}

fn normalize_log_text(message: &str) -> String {
    let mut normalized = String::with_capacity(message.len().min(LOG_MESSAGE_LIMIT));
    let mut pending_space = false;
    for character in message.chars() {
        if character.is_control() || character.is_whitespace() {
            pending_space = !normalized.is_empty();
            continue;
        }
        if pending_space {
            normalized.push(' ');
            pending_space = false;
        }
        normalized.push(character);
    }
    normalized
}

fn redact_url(raw: &str) -> String {
    let query = raw.find('?');
    let fragment = raw.find('#');
    let cut = match (query, fragment) {
        (Some(left), Some(right)) => Some(left.min(right)),
        (Some(index), None) | (None, Some(index)) => Some(index),
        (None, None) => None,
    };
    match cut {
        Some(index) => format!("{}?[REDACTED]", &raw[..index]),
        None => raw.to_string(),
    }
}

pub(crate) fn sanitize_log_message_with_limit(message: &str, limit: usize) -> String {
    let normalized = normalize_log_text(message);
    let bearer_redacted = bearer_pattern().replace_all(&normalized, "Bearer [REDACTED]");
    let secret_redacted =
        secret_pattern().replace_all(&bearer_redacted, |captures: &Captures<'_>| {
            format!(
                "{}[REDACTED]",
                captures
                    .name("prefix")
                    .map(|value| value.as_str())
                    .unwrap_or("secret=")
            )
        });
    let url_redacted = url_pattern().replace_all(&secret_redacted, |captures: &Captures<'_>| {
        redact_url(
            captures
                .get(0)
                .map(|value| value.as_str())
                .unwrap_or_default(),
        )
    });
    let character_count = url_redacted.chars().count();
    if character_count <= limit {
        return url_redacted.into_owned();
    }
    if limit <= 3 {
        return ".".repeat(limit);
    }
    let mut output = url_redacted
        .chars()
        .take(limit.saturating_sub(3))
        .collect::<String>();
    output.push_str("...");
    output
}

pub(crate) fn sanitize_log_message(message: &str) -> String {
    sanitize_log_message_with_limit(message, LOG_MESSAGE_LIMIT)
}

fn sanitize_log_level(level: &str) -> &'static str {
    match level.trim().to_ascii_uppercase().as_str() {
        "TRACE" => "TRACE",
        "DEBUG" => "DEBUG",
        "WARN" => "WARN",
        "ERROR" => "ERROR",
        "CRASH" => "CRASH",
        _ => "INFO",
    }
}

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
    let sanitized = sanitize_log_message(message);
    let line = format!(
        "[{}] [{}] {}\n",
        now_for_line(),
        sanitize_log_level(level),
        sanitized
    );
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
            let _ = append_log_line(
                &crash_file,
                "CRASH",
                &format!(
                    "location={} message={} backtrace={}",
                    location, payload, backtrace
                ),
            );
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

#[cfg(test)]
mod tests {
    use super::{sanitize_log_level, sanitize_log_message, sanitize_log_message_with_limit};

    #[test]
    fn sanitizer_redacts_common_secret_shapes_and_bearer_tokens() {
        let sanitized = sanitize_log_message(
            r#"authorization: Bearer abc.def token=raw password: \"hunter2\" {\"api_key\":\"key-123\"}"#,
        );
        assert!(!sanitized.contains("abc.def"));
        assert!(!sanitized.contains("hunter2"));
        assert!(!sanitized.contains("key-123"));
        assert!(!sanitized.contains("token=raw"));
        assert!(sanitized.contains("[REDACTED]"));
    }

    #[test]
    fn sanitizer_removes_url_query_fragment_and_log_injection_controls() {
        let sanitized = sanitize_log_message(
            "open https://example.test/path?token=secret#section\r\n[ERROR]\tforged",
        );
        assert_eq!(
            sanitized,
            "open https://example.test/path?[REDACTED] [ERROR] forged"
        );
    }

    #[test]
    fn sanitizer_truncates_on_unicode_character_boundaries() {
        let sanitized = sanitize_log_message_with_limit("研究论文安全", 4);
        assert_eq!(sanitized, "研...");
        assert_eq!(sanitized.chars().count(), 4);
    }

    #[test]
    fn unsupported_log_levels_fall_back_to_info() {
        assert_eq!(sanitize_log_level("made-up"), "INFO");
        assert_eq!(sanitize_log_level(" warn "), "WARN");
    }
}
