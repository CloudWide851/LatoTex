use super::*;
use crate::commands::runtime_assets::find_runtime_asset_entry;
use std::io::{BufRead, BufReader};
#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;
use std::path::{Path, PathBuf};
use std::process::{Child, Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::Instant;

const SHARE_TUNNEL_READY_TIMEOUT_SECS: u64 = 45;
const SHARE_TUNNEL_RESTART_MAX: u32 = 4;
const CLOUDFLARED_TARGET_NAME: &str = "cloudflared.exe";
#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

#[cfg(target_os = "windows")]
fn cloudflared_runtime_binary(runtime_root: &Path) -> PathBuf {
    runtime_root.join("tools").join(CLOUDFLARED_TARGET_NAME)
}

#[cfg(target_os = "windows")]
fn ensure_cloudflared_binary(runtime_root: &Path) -> Result<PathBuf, String> {
    if let Some(binary) = find_runtime_asset_entry(runtime_root, "cloudflared") {
        return Ok(binary);
    }
    let binary = cloudflared_runtime_binary(runtime_root);
    if binary.is_file() {
        return Ok(binary);
    }
    Err("cloudflared.runtimeAsset.required".to_string())
}

fn mark_share_failed(runtime: &Arc<Mutex<ShareRuntime>>, message: &str) {
    if let Ok(mut guard) = runtime.lock() {
        guard.status = "failed".to_string();
        guard.tunnel_state = "failed".to_string();
        guard.tunnel_error = Some(message.to_string());
    }
}

#[cfg(target_os = "windows")]
fn apply_tunnel_url(runtime: &Arc<Mutex<ShareRuntime>>, line: &str) {
    for token in line.split_whitespace() {
        if token.starts_with("https://") && token.contains("trycloudflare.com") {
            let url = token.trim().trim_end_matches('/').to_string();
            if let Ok(mut guard) = runtime.lock() {
                if guard.tunnel_url.as_ref() != Some(&url) {
                    guard.tunnel_url = Some(url);
                }
                guard.status = "ready".to_string();
                guard.tunnel_state = "ready".to_string();
                guard.tunnel_error = None;
            }
            break;
        }
    }
}

#[cfg(target_os = "windows")]
fn spawn_cloudflared(
    binary: &Path,
    local_port: u16,
    runtime: &Arc<Mutex<ShareRuntime>>,
) -> Result<Child, String> {
    let mut command = Command::new(binary);
    command
        .args([
            "tunnel",
            "--url",
            &format!("http://127.0.0.1:{local_port}"),
            "--no-autoupdate",
        ])
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());
    #[cfg(target_os = "windows")]
    {
        command.creation_flags(CREATE_NO_WINDOW);
    }
    let mut child = command
        .spawn()
        .map_err(|error| format!("cloudflared spawn failed: {error}"))?;
    let stdout = child.stdout.take();
    let stderr = child.stderr.take();
    if let Some(stream) = stdout {
        let runtime_clone = runtime.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                apply_tunnel_url(&runtime_clone, &line);
            }
        });
    }
    if let Some(stream) = stderr {
        let runtime_clone = runtime.clone();
        thread::spawn(move || {
            let reader = BufReader::new(stream);
            for line in reader.lines().map_while(Result::ok) {
                apply_tunnel_url(&runtime_clone, &line);
            }
        });
    }
    Ok(child)
}

#[cfg(target_os = "windows")]
pub(super) fn start_cloud_tunnel(runtime_root: &Path, runtime: Arc<Mutex<ShareRuntime>>) {
    let runtime_root = runtime_root.to_path_buf();
    thread::spawn(move || {
        if let Ok(mut guard) = runtime.lock() {
            guard.status = "starting".to_string();
            guard.tunnel_state = "pending".to_string();
            guard.tunnel_error = None;
        }
        let binary = match ensure_cloudflared_binary(&runtime_root) {
            Ok(path) => path,
            Err(error) => {
                mark_share_failed(&runtime, &format!("cloudflared setup failed: {error}"));
                return;
            }
        };
        let local_port = match runtime.lock() {
            Ok(guard) => guard.local_port,
            Err(_) => {
                mark_share_failed(&runtime, "failed to lock share runtime");
                return;
            }
        };
        let mut restart_count = 0_u32;
        let mut started = Instant::now();
        let first_child = match spawn_cloudflared(&binary, local_port, &runtime) {
            Ok(process) => process,
            Err(error) => {
                mark_share_failed(&runtime, &error);
                return;
            }
        };
        if let Ok(mut guard) = runtime.lock() {
            guard.cloudflared_child = Some(first_child);
            guard.status = "starting".to_string();
            guard.tunnel_state = "pending".to_string();
            guard.tunnel_error = None;
        }

        loop {
            thread::sleep(Duration::from_millis(280));
            let mut fail_reason: Option<String> = None;
            let mut should_stop = false;
            let mut has_url = false;
            if let Ok(mut guard) = runtime.lock() {
                should_stop = guard.stop_flag.load(Ordering::Relaxed);
                if should_stop {
                    return;
                }
                has_url = guard.tunnel_url.is_some();
                if let Some(child) = guard.cloudflared_child.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            fail_reason = Some(format!("cloudflared exited: {status}"));
                        }
                        Ok(None) => {}
                        Err(error) => {
                            fail_reason = Some(format!("cloudflared status check failed: {error}"));
                        }
                    }
                } else {
                    fail_reason = Some("cloudflared process missing".to_string());
                }
            }
            if should_stop {
                return;
            }
            if has_url && fail_reason.is_none() {
                continue;
            }
            if fail_reason.is_none()
                && started.elapsed().as_secs() > SHARE_TUNNEL_READY_TIMEOUT_SECS
            {
                fail_reason =
                    Some("cloudflared tunnel url timeout; failed to obtain public url".to_string());
            }
            if let Some(message) = fail_reason {
                if let Ok(mut guard) = runtime.lock() {
                    if let Some(child) = guard.cloudflared_child.as_mut() {
                        let _ = child.kill();
                    }
                    if restart_count >= SHARE_TUNNEL_RESTART_MAX {
                        guard.status = "failed".to_string();
                        guard.tunnel_state = "failed".to_string();
                        guard.tunnel_error = Some(format!(
                            "{message}; retries exhausted ({}/{})",
                            restart_count, SHARE_TUNNEL_RESTART_MAX
                        ));
                        return;
                    }
                    restart_count = restart_count.saturating_add(1);
                    guard.status = "starting".to_string();
                    guard.tunnel_state = "pending".to_string();
                    guard.tunnel_url = None;
                    guard.tunnel_error = Some(format!(
                        "{message}; restarting ({}/{})",
                        restart_count, SHARE_TUNNEL_RESTART_MAX
                    ));
                }
                let delay_ms = 450_u64.saturating_mul(2_u64.saturating_pow(restart_count.min(3)));
                thread::sleep(Duration::from_millis(delay_ms.min(2400)));
                let child = match spawn_cloudflared(&binary, local_port, &runtime) {
                    Ok(process) => process,
                    Err(error) => {
                        mark_share_failed(&runtime, &error);
                        return;
                    }
                };
                if let Ok(mut guard) = runtime.lock() {
                    guard.cloudflared_child = Some(child);
                    guard.status = "starting".to_string();
                    guard.tunnel_state = "pending".to_string();
                }
                started = Instant::now();
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub(super) fn start_cloud_tunnel(_runtime_root: &Path, runtime: Arc<Mutex<ShareRuntime>>) {
    mark_share_failed(
        &runtime,
        "cloud tunnel is only implemented for Windows runtime",
    );
}
