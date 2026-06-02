use super::native_runtime::configure_hidden_process;
use crate::models::ToolchainStatus;
use std::path::{Path, PathBuf};
use std::process::Command;

pub(crate) fn first_nonempty_version_line(stdout: &[u8], stderr: &[u8]) -> Option<String> {
    [stdout, stderr].into_iter().find_map(|bytes| {
        let text = String::from_utf8_lossy(bytes).trim().to_string();
        if text.is_empty() {
            None
        } else {
            Some(text.lines().next().unwrap_or("").trim().to_string())
        }
    })
}

pub(crate) fn version_of(executable: &Path, arg: Option<&str>) -> Option<String> {
    let mut command = Command::new(executable);
    configure_hidden_process(&mut command);
    command.arg(arg.unwrap_or("--version"));
    let output = command.output().ok()?;
    if !output.status.success() {
        return None;
    }
    first_nonempty_version_line(&output.stdout, &output.stderr)
}

fn find_executable_on_path(name: &str) -> Option<PathBuf> {
    let path_var = std::env::var_os("PATH")?;
    for dir in std::env::split_paths(&path_var) {
        let candidate = dir.join(name);
        if candidate.is_file() {
            return Some(candidate);
        }
    }
    None
}

pub(crate) fn local_toolchain_candidates(kind: &str) -> &'static [&'static str] {
    match kind {
        "git" => &["git.exe"],
        "go" => &["go.exe"],
        "python" => &["python.exe", "py.exe"],
        "node" => &["node.exe"],
        "java" => &["javac.exe", "java.exe"],
        "c" => &["clang.exe", "gcc.exe", "cl.exe"],
        "cpp" => &["clang++.exe", "g++.exe", "cl.exe"],
        "zig" => &["zig.exe"],
        "rust" => &["rustc.exe", "cargo.exe"],
        _ => &[],
    }
}

pub(crate) fn verify_local_toolchain(
    plugin_id: String,
    contribution_id: String,
    kind: String,
    version_arg: Option<&str>,
) -> Option<ToolchainStatus> {
    let candidates = local_toolchain_candidates(&kind);
    if candidates.is_empty() {
        return None;
    }
    let resolved = candidates
        .iter()
        .find_map(|name| find_executable_on_path(name))?;
    let version = version_of(&resolved, version_arg);
    Some(ToolchainStatus {
        plugin_id,
        contribution_id,
        kind,
        installed: true,
        install_path: None,
        executable_path: Some(resolved.to_string_lossy().to_string()),
        version,
        message: "toolchain.detected".to_string(),
        source: "local".to_string(),
    })
}

pub(crate) fn find_local_toolchain_executable(kind: &str) -> Option<PathBuf> {
    local_toolchain_candidates(kind)
        .iter()
        .find_map(|name| find_executable_on_path(name))
}

pub(crate) fn find_local_toolchain_executable_from_names(names: &[&str]) -> Option<PathBuf> {
    names.iter().find_map(|name| find_executable_on_path(name))
}

pub(crate) fn resolve_executable_in_root(root: &Path, names: &[String]) -> Option<PathBuf> {
    let search_dirs = ["", "bin", "cmd", "Scripts"];
    names.iter().find_map(|name| {
        search_dirs.iter().find_map(|dir| {
            let candidate = if dir.is_empty() {
                root.join(name)
            } else {
                root.join(dir).join(name)
            };
            candidate.is_file().then_some(candidate)
        })
    })
}

#[cfg(test)]
mod tests {
    use super::first_nonempty_version_line;

    #[test]
    fn version_line_falls_back_to_stderr_for_java_style_output() {
        let version = first_nonempty_version_line(b"", br#"java version "21.0.5""#);
        assert_eq!(version.as_deref(), Some(r#"java version "21.0.5""#));
    }

    #[test]
    fn version_line_prefers_stdout_when_available() {
        let version = first_nonempty_version_line(b"rustc 1.91.0\nextra", b"ignored");
        assert_eq!(version.as_deref(), Some("rustc 1.91.0"));
    }
}
