use std::env;
use std::path::{Path, PathBuf};
use std::process::Command;

#[cfg(target_os = "windows")]
const POWERSHELL_CANDIDATES: [&str; 3] = [
    "C:\\Program Files\\PowerShell\\7\\pwsh.exe",
    "C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe",
    "powershell.exe",
];

fn tools_dir_candidates() -> Vec<PathBuf> {
    let mut candidates = vec![PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/tools")];
    if let Ok(exe_path) = env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources/tools"));
            candidates.push(exe_dir.join("tools"));
            candidates.push(exe_dir.join("../resources/tools"));
        }
    }
    candidates
}

pub(super) fn bundled_tool_path(relative_path: &str) -> Option<PathBuf> {
    let normalized = relative_path.trim().replace('\\', "/").trim_start_matches('/').to_string();
    if normalized.is_empty() {
        return None;
    }
    tools_dir_candidates()
        .into_iter()
        .map(|root| root.join(Path::new(&normalized)))
        .find(|candidate| candidate.exists() && candidate.is_file())
}

pub(super) fn resolve_poppler_tool(tool_name: &str) -> PathBuf {
    let normalized = tool_name.trim();
    if let Some(path) = bundled_tool_path(&format!("poppler/{normalized}")) {
        return path;
    }
    PathBuf::from(normalized)
}

#[cfg(target_os = "windows")]
pub(super) fn resolve_powershell() -> PathBuf {
    for candidate in POWERSHELL_CANDIDATES {
        let path = PathBuf::from(candidate);
        if path.is_absolute() {
            if path.exists() {
                return path;
            }
            continue;
        }
        return path;
    }
    PathBuf::from("powershell.exe")
}

pub(super) fn run_command_capture(command_path: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new(command_path)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(if detail.is_empty() {
            format!("command failed: {}", command_path.to_string_lossy())
        } else {
            detail
        });
    }
    Ok(String::from_utf8_lossy(&output.stdout).to_string())
}
