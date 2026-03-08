use super::*;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::Ordering;
use std::time::Instant;

const SHARE_TUNNEL_READY_TIMEOUT_SECS: u64 = 45;
const CLOUDFLARED_TARGET_NAME: &str = "cloudflared.exe";
const CLOUDFLARED_RELEASE_NAME: &str = "cloudflared-windows-amd64.exe";
const CLOUDFLARED_DOWNLOAD_URLS: [&str; 2] = [
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe",
    "https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared.exe",
];

#[cfg(target_os = "windows")]
fn cloudflared_runtime_binary(runtime_root: &Path) -> PathBuf {
    runtime_root.join("tools").join(CLOUDFLARED_TARGET_NAME)
}

#[cfg(target_os = "windows")]
fn cloudflared_candidate_sources(runtime_root: &Path) -> Vec<PathBuf> {
    let mut candidates = Vec::<PathBuf>::new();
    candidates.push(runtime_root.join("tools").join(CLOUDFLARED_RELEASE_NAME));
    candidates.push(runtime_root.join("tools").join(CLOUDFLARED_TARGET_NAME));
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/tools/cloudflared-windows-amd64.exe"),
    );
    candidates.push(
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/tools/cloudflared.exe"),
    );
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join("resources/tools/cloudflared-windows-amd64.exe"));
            candidates.push(exe_dir.join("resources/tools/cloudflared.exe"));
            candidates.push(exe_dir.join("tools/cloudflared-windows-amd64.exe"));
            candidates.push(exe_dir.join("tools/cloudflared.exe"));
            candidates.push(exe_dir.join("../resources/tools/cloudflared-windows-amd64.exe"));
            candidates.push(exe_dir.join("../resources/tools/cloudflared.exe"));
        }
    }
    candidates
}

#[cfg(target_os = "windows")]
fn copy_first_existing_cloudflared(runtime_root: &Path) -> Result<Option<PathBuf>, String> {
    let target_binary = cloudflared_runtime_binary(runtime_root);
    let target_parent = target_binary
        .parent()
        .ok_or_else(|| "invalid cloudflared target path".to_string())?;
    fs::create_dir_all(target_parent).map_err(|e| e.to_string())?;
    if target_binary.exists() {
        return Ok(Some(target_binary));
    }
    for source in cloudflared_candidate_sources(runtime_root) {
        if !source.exists() {
            continue;
        }
        if source == target_binary {
            return Ok(Some(target_binary));
        }
        fs::copy(&source, &target_binary).map_err(|e| e.to_string())?;
        return Ok(Some(target_binary));
    }
    Ok(None)
}

#[cfg(target_os = "windows")]
fn download_cloudflared(runtime_root: &Path) -> Result<PathBuf, String> {
    let target_binary = cloudflared_runtime_binary(runtime_root);
    let target_parent = target_binary
        .parent()
        .ok_or_else(|| "invalid cloudflared target path".to_string())?;
    fs::create_dir_all(target_parent).map_err(|e| e.to_string())?;
    let mut errors = Vec::<String>::new();
    for url in CLOUDFLARED_DOWNLOAD_URLS {
        match reqwest::blocking::get(url) {
            Ok(response) => {
                if !response.status().is_success() {
                    errors.push(format!("{url} => {}", response.status()));
                    continue;
                }
                match response.bytes() {
                    Ok(bytes) => {
                        if bytes.len() < 1024 {
                            errors.push(format!("{url} => body too small"));
                            continue;
                        }
                        fs::write(&target_binary, &bytes).map_err(|e| e.to_string())?;
                        return Ok(target_binary);
                    }
                    Err(error) => errors.push(format!("{url} => {}", error)),
                }
            }
            Err(error) => errors.push(format!("{url} => {}", error)),
        }
    }
    Err(format!(
        "download failed; bundled binary expected at src-tauri/resources/tools/{CLOUDFLARED_RELEASE_NAME}; errors: {}",
        errors.join(" | ")
    ))
}

#[cfg(target_os = "windows")]
fn ensure_cloudflared_binary(runtime_root: &Path) -> Result<PathBuf, String> {
    if let Some(binary) = copy_first_existing_cloudflared(runtime_root)? {
        return Ok(binary);
    }
    download_cloudflared(runtime_root)
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


