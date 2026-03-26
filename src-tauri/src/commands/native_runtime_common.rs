use std::path::{Component, Path, PathBuf};
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

pub(crate) fn safe_relative_path(input: &str) -> Result<PathBuf, String> {
    let mut out = PathBuf::new();
    for component in Path::new(input).components() {
        match component {
            Component::Normal(value) => out.push(value),
            Component::CurDir => {}
            _ => return Err(format!("Unsupported relative path: {input}")),
        }
    }
    if out.as_os_str().is_empty() {
        return Err("Relative path cannot be empty".to_string());
    }
    Ok(out)
}

fn is_noise_log_line(line: &str) -> bool {
    let normalized = line.trim();
    normalized.is_empty()
        || normalized.starts_with("This is ")
        || normalized.starts_with("entering extended mode")
        || normalized.starts_with("Initial Win CP for")
        || normalized.starts_with("I changed them all to CP")
        || normalized.starts_with("Rc files read:")
        || normalized.starts_with("Latexmk: This is Latexmk")
        || normalized.starts_with("No existing .aux file")
}

pub(crate) fn sanitize_log_lines(text: &str) -> Vec<String> {
    let mut lines = Vec::new();
    for raw in text.lines() {
        let line = raw.trim();
        if is_noise_log_line(line) {
            continue;
        }
        if lines.iter().any(|item: &String| item == line) {
            continue;
        }
        lines.push(line.to_string());
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
