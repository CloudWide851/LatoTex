use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

pub(crate) fn configure_hidden_process(command: &mut Command) {
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
}

pub(crate) fn sanitize_log_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for raw in text.lines() {
        let sanitized = crate::logging::sanitize_log_message_with_limit(raw, 320);
        if sanitized.is_empty() {
            continue;
        }
        if lines.iter().any(|item: &String| item == &sanitized) {
            continue;
        }
        lines.push(sanitized);
    }
    lines.truncate(24);
    lines
}

pub(crate) fn try_version_command(program: &Path, args: &[&str]) -> Option<String> {
    let mut command = Command::new(program);
    configure_hidden_process(&mut command);
    command.args(args);
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if stdout.is_empty() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        if stderr.is_empty() {
            None
        } else {
            Some(stderr)
        }
    } else {
        Some(stdout)
    }
}

pub(crate) fn command_from_path_or_name(value: &str) -> PathBuf {
    PathBuf::from(value)
}

#[cfg(test)]
mod tests {
    use super::sanitize_log_lines;

    #[test]
    fn process_summary_redacts_without_dropping_keyword_lines() {
        let lines = sanitize_log_lines(
            "This is a compiler line token=secret\nhttps://example.test/run?q=private",
        );
        assert_eq!(lines.len(), 2);
        assert!(lines[0].starts_with("This is a compiler line"));
        assert!(!lines.join(" ").contains("secret"));
        assert!(!lines.join(" ").contains("private"));
    }
}
