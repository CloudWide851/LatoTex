use super::native_runtime::configure_hidden_process;
use super::plugins_trusted_recipes::{is_cran_r_installer, CRAN_R_SIGNER_SUBJECT};
use crate::models::PluginToolchainInstaller;
use crate::storage;
use serde::Deserialize;
use std::fs;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::time::{Duration, Instant};

const SIGNATURE_TIMEOUT: Duration = Duration::from_secs(30);
const INSTALL_TIMEOUT: Duration = Duration::from_secs(600);

#[derive(Debug, Deserialize)]
#[serde(rename_all = "PascalCase")]
struct AuthenticodeResult {
    status: String,
    subject: String,
}

struct TemporaryInstaller {
    path: PathBuf,
}

impl Drop for TemporaryInstaller {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.path);
    }
}

fn powershell_path() -> Result<PathBuf, String> {
    let system_root = std::env::var_os("SystemRoot")
        .ok_or_else(|| "toolchain.signature_unavailable".to_string())?;
    let path = PathBuf::from(system_root)
        .join("System32")
        .join("WindowsPowerShell")
        .join("v1.0")
        .join("powershell.exe");
    path.is_file()
        .then_some(path)
        .ok_or_else(|| "toolchain.signature_unavailable".to_string())
}

fn command_output_with_timeout(
    mut command: Command,
    timeout: Duration,
    timeout_code: &str,
) -> Result<(Vec<u8>, Vec<u8>, bool), String> {
    configure_hidden_process(&mut command);
    let mut child = command
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|_| "toolchain.process_spawn_failed".to_string())?;
    let started = Instant::now();
    loop {
        if let Some(status) = child
            .try_wait()
            .map_err(|_| "toolchain.process_wait_failed".to_string())?
        {
            let mut stdout = Vec::new();
            let mut stderr = Vec::new();
            if let Some(mut stream) = child.stdout.take() {
                let _ = stream.read_to_end(&mut stdout);
            }
            if let Some(mut stream) = child.stderr.take() {
                let _ = stream.read_to_end(&mut stderr);
            }
            return Ok((stdout, stderr, status.success()));
        }
        if started.elapsed() >= timeout {
            let _ = child.kill();
            let _ = child.wait();
            return Err(timeout_code.to_string());
        }
        std::thread::sleep(Duration::from_millis(50));
    }
}

fn verify_cran_r_signature(path: &Path) -> Result<(), String> {
    let script = r#"$signature = Get-AuthenticodeSignature -LiteralPath $env:LATOTEX_TRUSTED_INSTALLER; [pscustomobject]@{ Status = $signature.Status.ToString(); Subject = $signature.SignerCertificate.Subject } | ConvertTo-Json -Compress"#;
    let mut command = Command::new(powershell_path()?);
    command
        .args([
            "-NoLogo",
            "-NoProfile",
            "-NonInteractive",
            "-ExecutionPolicy",
            "Bypass",
            "-Command",
            script,
        ])
        .env("LATOTEX_TRUSTED_INSTALLER", path);
    let (stdout, _, success) =
        command_output_with_timeout(command, SIGNATURE_TIMEOUT, "toolchain.signature_timeout")?;
    if !success || stdout.len() > 16 * 1024 {
        return Err("toolchain.signature_invalid".to_string());
    }
    let parsed: AuthenticodeResult =
        serde_json::from_slice(&stdout).map_err(|_| "toolchain.signature_invalid".to_string())?;
    if parsed.status != "Valid" || parsed.subject != CRAN_R_SIGNER_SUBJECT {
        return Err("toolchain.signature_untrusted".to_string());
    }
    Ok(())
}

fn cran_r_silent_args(target: &Path) -> Vec<String> {
    vec![
        "/VERYSILENT".to_string(),
        "/SUPPRESSMSGBOXES".to_string(),
        "/NORESTART".to_string(),
        "/SP-".to_string(),
        "/NOICONS".to_string(),
        format!("/DIR={}", target.to_string_lossy()),
    ]
}

pub(crate) fn install_trusted_executable(
    installer: &PluginToolchainInstaller,
    bytes: &[u8],
    target: &Path,
) -> Result<(), String> {
    if !cfg!(windows) || !is_cran_r_installer(installer) {
        return Err("toolchain.installer_unsafe".to_string());
    }
    let parent = target
        .parent()
        .ok_or_else(|| "toolchain.install_path_invalid".to_string())?;
    fs::create_dir_all(parent).map_err(|_| "toolchain.install_path_invalid".to_string())?;
    let installer_path = target.with_extension("trusted-installer.exe");
    let _temporary_installer = TemporaryInstaller {
        path: installer_path.clone(),
    };
    storage::atomic_write_file(&installer_path, bytes)
        .map_err(|_| "toolchain.installer_write_failed".to_string())?;
    verify_cran_r_signature(&installer_path)?;

    let mut command = Command::new(&installer_path);
    command.args(cran_r_silent_args(target));
    let (_, _, success) =
        command_output_with_timeout(command, INSTALL_TIMEOUT, "toolchain.install_timeout")?;
    if !success {
        return Err("toolchain.install_failed".to_string());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::cran_r_silent_args;
    use std::path::Path;

    #[test]
    fn cran_r_installer_arguments_are_fixed_and_structured() {
        let args = cran_r_silent_args(Path::new(r"C:\LatoTex Runtime\R"));
        assert_eq!(args.len(), 6);
        assert_eq!(args[0], "/VERYSILENT");
        assert_eq!(args[4], "/NOICONS");
        assert_eq!(args[5], r"/DIR=C:\LatoTex Runtime\R");
        assert!(args
            .iter()
            .all(|arg| !arg.contains('&') && !arg.contains('|')));
    }
}
