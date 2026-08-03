use super::{
    clamp_pty_size, public_failure_code, strip_windows_verbatim_prefix,
    terminal_activation_command, terminal_shell_command, venv_bin_dir, TerminalShellSpec,
};
use crate::models::TerminalLaunchKind;
use std::path::PathBuf;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

#[test]
fn clamps_terminal_size() {
    let small = clamp_pty_size(Some(1), Some(1));
    assert_eq!(small.cols, 40);
    assert_eq!(small.rows, 8);
    let large = clamp_pty_size(Some(999), Some(999));
    assert_eq!(large.cols, 240);
    assert_eq!(large.rows, 120);
}

#[test]
fn resolves_platform_venv_bin_dir() {
    let root = PathBuf::from("demo-venv");
    let rendered = venv_bin_dir(&root).to_string_lossy().replace('\\', "/");
    if cfg!(target_os = "windows") {
        assert!(rendered.ends_with("demo-venv/Scripts"));
    } else {
        assert!(rendered.ends_with("demo-venv/bin"));
    }
}

#[test]
fn strips_windows_verbatim_paths_for_shell_display() {
    if cfg!(target_os = "windows") {
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\H:\LatoTex"),
            r"H:\LatoTex"
        );
        assert_eq!(
            strip_windows_verbatim_prefix(r"\\?\UNC\server\share\demo"),
            r"\\server\share\demo"
        );
    } else {
        assert_eq!(strip_windows_verbatim_prefix("/tmp/demo"), "/tmp/demo");
    }
}

#[test]
fn builds_configured_terminal_shell_specs() {
    let powershell = terminal_shell_command("powershell");
    if cfg!(target_os = "windows") {
        assert!(powershell.shell.to_lowercase().contains("powershell"));
        assert!(powershell.args.iter().any(|arg| arg == "-NoProfile"));
        assert!(!powershell
            .args
            .iter()
            .any(|arg| arg.contains("Activate.ps1")));
        let cmd = terminal_shell_command("cmd");
        assert!(!cmd.args.iter().any(|arg| arg.contains("activate.bat")));
    } else {
        assert!(!powershell.shell.trim().is_empty());
        if cfg!(target_os = "macos") {
            assert!(powershell.shell.ends_with("zsh") || powershell.shell.ends_with("bash"));
        } else {
            assert!(powershell.shell.ends_with("bash") || powershell.shell.ends_with("sh"));
        }
        assert!(powershell.args.iter().any(|arg| arg.contains('i')));
    }
}

#[test]
fn builds_shell_specific_research_env_activation_commands() {
    let venv = PathBuf::from(r"H:\LatoTex\.venv");
    let powershell = terminal_activation_command("powershell.exe", &venv);
    assert!(powershell.contains("Activate.ps1"));
    assert!(!powershell.contains('\n'));
    let cmd = terminal_activation_command("cmd.exe", &venv);
    assert!(cmd.starts_with("call "));
    assert!(cmd.contains("activate.bat"));
}

#[test]
fn serializes_only_stable_terminal_failure_fields() {
    let value = public_failure_code("terminal.failure.start_timeout", "shell", true);
    let parsed: serde_json::Value = serde_json::from_str(&value).unwrap();
    assert_eq!(parsed["code"], "terminal.failure.start_timeout");
    assert_eq!(parsed["stage"], "shell");
    assert_eq!(parsed["retryable"], true);
    assert_eq!(parsed.as_object().unwrap().len(), 3);
}

#[test]
fn cancelled_start_never_creates_a_pty() {
    let result = super::lifecycle::prepare_terminal(
        TerminalShellSpec {
            shell: "powershell.exe".to_string(),
            args: Vec::new(),
            env: Vec::new(),
            launch_kind: TerminalLaunchKind::Shell,
            resource_lease: None,
        },
        PathBuf::from("."),
        clamp_pty_size(None, None),
        Arc::new(AtomicBool::new(true)),
    );
    let error = result.err().expect("cancelled start must fail");
    assert_eq!(error.failure.code, "terminal.failure.start_cancelled");
    assert_eq!(error.failure.stage, "queued");
}
