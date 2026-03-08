use super::*;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::Instant;

const SHARE_TUNNEL_READY_TIMEOUT_SECS: u64 = 45;

#[cfg(target_os = "windows")]
fn ensure_cloudflared_binary(runtime_root: &Path) -> Result<PathBuf, String> {
    let tool_dir = runtime_root.join("tools");
    fs::create_dir_all(&tool_dir).map_err(|e| e.to_string())?;
    let binary = tool_dir.join("cloudflared.exe");
    if binary.exists() {
        return Ok(binary);
    }
    let download_url =
        "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe";
    let response = reqwest::blocking::get(download_url).map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "cloudflared download failed: {}",
            response.status()
        ));
    }
    let bytes = response.bytes().map_err(|e| e.to_string())?;
    fs::write(&binary, &bytes).map_err(|e| e.to_string())?;
    Ok(binary)
}

fn mark_share_failed(runtime: &Arc<Mutex<ShareRuntime>>, message: &str) {
    if let Ok(mut guard) = runtime.lock() {
        guard.status = "failed".to_string();
        guard.tunnel_state = "failed".to_string();
        guard.tunnel_error = Some(message.to_string());
    }
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
        let mut child = match Command::new(binary)
            .args([
                "tunnel",
                "--url",
                &format!("http://127.0.0.1:{local_port}"),
                "--no-autoupdate",
            ])
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
        {
            Ok(process) => process,
            Err(error) => {
                mark_share_failed(&runtime, &format!("cloudflared spawn failed: {error}"));
                return;
            }
        };
        let stdout = child.stdout.take();
        let stderr = child.stderr.take();
        if let Ok(mut guard) = runtime.lock() {
            guard.cloudflared_child = Some(child);
        }

        let apply_url = move |line: &str, runtime: &Arc<Mutex<ShareRuntime>>| {
            for token in line.split_whitespace() {
                if token.starts_with("https://") && token.contains("trycloudflare.com") {
                    if let Ok(mut guard) = runtime.lock() {
                        if guard.tunnel_url.is_none() {
                            guard.tunnel_url = Some(token.trim().to_string());
                            guard.status = "ready".to_string();
                            guard.tunnel_state = "ready".to_string();
                            guard.tunnel_error = None;
                        }
                    }
                    break;
                }
            }
        };

        if let Some(stream) = stdout {
            let runtime_clone = runtime.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.lines().map_while(Result::ok) {
                    apply_url(&line, &runtime_clone);
                }
            });
        }
        if let Some(stream) = stderr {
            let runtime_clone = runtime.clone();
            thread::spawn(move || {
                let reader = BufReader::new(stream);
                for line in reader.lines().map_while(Result::ok) {
                    apply_url(&line, &runtime_clone);
                }
            });
        }

        let started = Instant::now();
        loop {
            thread::sleep(Duration::from_millis(240));
            let mut fail_reason: Option<String> = None;
            let mut ready = false;
            let mut should_stop = false;
            if let Ok(mut guard) = runtime.lock() {
                should_stop = guard.stop_flag.load(Ordering::Relaxed);
                if should_stop {
                    return;
                }
                if guard.tunnel_url.is_some() {
                    ready = true;
                } else if let Some(child) = guard.cloudflared_child.as_mut() {
                    match child.try_wait() {
                        Ok(Some(status)) => {
                            fail_reason = Some(format!("cloudflared exited: {status}"));
                        }
                        Ok(None) => {}
                        Err(error) => {
                            fail_reason = Some(format!("cloudflared status check failed: {error}"));
                        }
                    }
                }
            }
            if should_stop || ready {
                return;
            }
            if let Some(message) = fail_reason {
                mark_share_failed(&runtime, &message);
                return;
            }
            if started.elapsed().as_secs() > SHARE_TUNNEL_READY_TIMEOUT_SECS {
                if let Ok(mut guard) = runtime.lock() {
                    if let Some(child) = guard.cloudflared_child.as_mut() {
                        let _ = child.kill();
                    }
                }
                mark_share_failed(
                    &runtime,
                    "cloudflared tunnel url timeout; failed to obtain public url",
                );
                return;
            }
        }
    });
}

#[cfg(not(target_os = "windows"))]
pub(super) fn start_cloud_tunnel(_runtime_root: &Path, runtime: Arc<Mutex<ShareRuntime>>) {
    mark_share_failed(&runtime, "cloud tunnel is only implemented for Windows runtime");
}


