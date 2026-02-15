use crate::models::{
    Ack, GitAvailabilityResponse, GitBranchInfo, GitCheckoutInput, GitCommitInfo, GitCommitInput,
    GitDownloadStartResponse, GitDownloadStatusResponse, GitLogInput, GitPathsInput, GitRefInput,
    GitRemoteInput, GitStatusEntry, GitStatusResponse, GitTaskInput,
};
use crate::state::{AppState, GitDownloadTask};
use crate::storage;
use reqwest::blocking::Client;
use serde::Deserialize;
use std::fs::{self, File};
use std::io::{Read, Write};
use std::path::Path;
use std::process::Command;
use std::sync::atomic::Ordering;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, Instant};
use tauri::State;
use uuid::Uuid;

const GIT_RELEASE_API: &str = "https://api.github.com/repos/git-for-windows/git/releases/latest";
const DOWNLOAD_USER_AGENT: &str = "LatoTex/0.1.0 (+https://github.com/git-for-windows/git)";

fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let output = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .map_err(|e| e.to_string())?;

    if output.status.success() {
        Ok(String::from_utf8_lossy(&output.stdout).trim().to_string())
    } else {
        Err(String::from_utf8_lossy(&output.stderr).trim().to_string())
    }
}

fn read_git_version() -> Option<String> {
    let output = Command::new("git").arg("--version").output().ok()?;
    if !output.status.success() {
        return None;
    }
    Some(String::from_utf8_lossy(&output.stdout).trim().to_string())
}

fn set_task_status(status_lock: &Arc<Mutex<String>>, status: &str) {
    if let Ok(mut guard) = status_lock.lock() {
        *guard = status.to_string();
    }
}

fn set_task_error(error_lock: &Arc<Mutex<Option<String>>>, message: Option<String>) {
    if let Ok(mut guard) = error_lock.lock() {
        *guard = message;
    }
}

fn parse_branch_header(line: &str) -> (String, Option<String>, u32, u32) {
    let mut branch = "HEAD".to_string();
    let mut upstream = None;
    let mut ahead = 0;
    let mut behind = 0;
    let header = line.trim_start_matches("## ").trim();

    if let Some((left, right)) = header.split_once("...") {
        branch = left.to_string();
        if let Some((up, detail)) = right.split_once(' ') {
            upstream = Some(up.to_string());
            if detail.contains("ahead") {
                if let Some(num) = detail
                    .split("ahead ")
                    .nth(1)
                    .and_then(|s| s.split([' ', ',', ']']).next())
                    .and_then(|n| n.parse::<u32>().ok())
                {
                    ahead = num;
                }
            }
            if detail.contains("behind") {
                if let Some(num) = detail
                    .split("behind ")
                    .nth(1)
                    .and_then(|s| s.split([' ', ',', ']']).next())
                    .and_then(|n| n.parse::<u32>().ok())
                {
                    behind = num;
                }
            }
        } else {
            upstream = Some(right.to_string());
        }
    } else if !header.is_empty() {
        branch = header.to_string();
    }

    (branch, upstream, ahead, behind)
}

#[derive(Debug, Deserialize)]
struct GitHubRelease {
    assets: Vec<GitHubAsset>,
}

#[derive(Debug, Deserialize)]
struct GitHubAsset {
    name: String,
    browser_download_url: String,
}

fn select_git_windows_asset(release: GitHubRelease) -> Option<GitHubAsset> {
    release.assets.into_iter().find(|asset| {
        let name = asset.name.to_ascii_lowercase();
        name.contains("64-bit.exe") && name.starts_with("git-")
    })
}

#[tauri::command]
pub fn git_check_installed(state: State<'_, AppState>) -> Result<GitAvailabilityResponse, String> {
    state.log("INFO", "git_check_installed");
    let version = read_git_version();
    Ok(GitAvailabilityResponse {
        installed: version.is_some(),
        version,
    })
}

#[tauri::command]
pub fn git_init_repo(state: State<'_, AppState>, input: GitRefInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_init_repo: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    run_git(&root, &["init"])?;
    Ok(Ack {
        ok: true,
        message: "initialized".to_string(),
    })
}

#[tauri::command]
pub fn git_download_installer_start(
    state: State<'_, AppState>,
) -> Result<GitDownloadStartResponse, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Git auto installer download is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let client = Client::builder()
            .user_agent(DOWNLOAD_USER_AGENT)
            .timeout(Duration::from_secs(30))
            .build()
            .map_err(|e| e.to_string())?;

        let release = client
            .get(GIT_RELEASE_API)
            .header("Accept", "application/vnd.github+json")
            .send()
            .and_then(|r| r.error_for_status())
            .map_err(|e| e.to_string())?
            .json::<GitHubRelease>()
            .map_err(|e| e.to_string())?;

        let asset = select_git_windows_asset(release)
            .ok_or_else(|| "No Windows x64 Git installer asset found".to_string())?;

        let task_id = Uuid::new_v4().to_string();
        let destination = state.downloads_dir.join(&asset.name);
        if destination.exists() {
            fs::remove_file(&destination).map_err(|e| e.to_string())?;
        }

        let task = GitDownloadTask {
            id: task_id.clone(),
            file_name: asset.name.clone(),
            download_url: asset.browser_download_url.clone(),
            destination_path: destination.clone(),
            downloaded_bytes: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            total_bytes: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            speed_bps: Arc::new(std::sync::atomic::AtomicU64::new(0)),
            cancel_flag: Arc::new(std::sync::atomic::AtomicBool::new(false)),
            status: Arc::new(Mutex::new("downloading".to_string())),
            error: Arc::new(Mutex::new(None)),
        };

        let cloned_task = task.clone();
        {
            let mut tasks = state
                .git_download_tasks
                .lock()
                .map_err(|_| "failed to lock git download tasks".to_string())?;
            tasks.insert(task_id.clone(), task);
        }

        thread::spawn(move || {
            let run = || -> Result<(), String> {
                let mut response = Client::builder()
                    .user_agent(DOWNLOAD_USER_AGENT)
                    .timeout(Duration::from_secs(60))
                    .build()
                    .map_err(|e| e.to_string())?
                    .get(&cloned_task.download_url)
                    .send()
                    .and_then(|r| r.error_for_status())
                    .map_err(|e| e.to_string())?;

                let total = response.content_length().unwrap_or(0);
                cloned_task.total_bytes.store(total, Ordering::Relaxed);

                let mut file = File::create(&cloned_task.destination_path).map_err(|e| e.to_string())?;
                let mut buffer = [0_u8; 64 * 1024];
                let mut bytes_since_tick = 0_u64;
                let mut last_tick = Instant::now();

                loop {
                    if cloned_task.cancel_flag.load(Ordering::Relaxed) {
                        set_task_status(&cloned_task.status, "cancelled");
                        cloned_task.speed_bps.store(0, Ordering::Relaxed);
                        drop(file);
                        let _ = fs::remove_file(&cloned_task.destination_path);
                        return Ok(());
                    }

                    let read_size = response.read(&mut buffer).map_err(|e| e.to_string())?;
                    if read_size == 0 {
                        break;
                    }

                    file.write_all(&buffer[..read_size]).map_err(|e| e.to_string())?;
                    cloned_task
                        .downloaded_bytes
                        .fetch_add(read_size as u64, Ordering::Relaxed);
                    bytes_since_tick += read_size as u64;

                    let elapsed = last_tick.elapsed();
                    if elapsed >= Duration::from_millis(350) {
                        let speed = (bytes_since_tick as f64 / elapsed.as_secs_f64()) as u64;
                        cloned_task.speed_bps.store(speed, Ordering::Relaxed);
                        bytes_since_tick = 0;
                        last_tick = Instant::now();
                    }
                }

                file.flush().map_err(|e| e.to_string())?;
                cloned_task.speed_bps.store(0, Ordering::Relaxed);
                set_task_status(&cloned_task.status, "completed");
                Ok(())
            };

            if let Err(error) = run() {
                set_task_error(&cloned_task.error, Some(error));
                set_task_status(&cloned_task.status, "failed");
                cloned_task.speed_bps.store(0, Ordering::Relaxed);
            }
        });

        Ok(GitDownloadStartResponse {
            task_id,
            file_name: asset.name,
            download_url: asset.browser_download_url,
        })
    }
}

#[tauri::command]
pub fn git_download_status(
    state: State<'_, AppState>,
    input: GitTaskInput,
) -> Result<GitDownloadStatusResponse, String> {
    let tasks = state
        .git_download_tasks
        .lock()
        .map_err(|_| "failed to lock git download tasks".to_string())?;
    let task = tasks
        .get(&input.task_id)
        .ok_or_else(|| "download task not found".to_string())?;

    let downloaded = task.downloaded_bytes.load(Ordering::Relaxed);
    let total = task.total_bytes.load(Ordering::Relaxed);
    let speed = task.speed_bps.load(Ordering::Relaxed);
    let status = task
        .status
        .lock()
        .map_err(|_| "failed to read task status".to_string())?
        .clone();
    let error = task
        .error
        .lock()
        .map_err(|_| "failed to read task error".to_string())?
        .clone();
    let progress_percent = if total > 0 {
        ((downloaded as f64 / total as f64) * 100.0).clamp(0.0, 100.0)
    } else {
        0.0
    };

    Ok(GitDownloadStatusResponse {
        task_id: task.id.clone(),
        status,
        file_name: task.file_name.clone(),
        downloaded_bytes: downloaded,
        total_bytes: total,
        speed_bps: speed,
        progress_percent,
        installer_path: task.destination_path.to_string_lossy().to_string(),
        error,
    })
}

#[tauri::command]
pub fn git_download_cancel(state: State<'_, AppState>, input: GitTaskInput) -> Result<Ack, String> {
    let tasks = state
        .git_download_tasks
        .lock()
        .map_err(|_| "failed to lock git download tasks".to_string())?;
    let task = tasks
        .get(&input.task_id)
        .ok_or_else(|| "download task not found".to_string())?;
    task.cancel_flag.store(true, Ordering::Relaxed);
    set_task_status(&task.status, "cancelling");
    Ok(Ack {
        ok: true,
        message: "cancelling".to_string(),
    })
}

#[tauri::command]
pub fn git_run_installer(state: State<'_, AppState>, input: GitTaskInput) -> Result<Ack, String> {
    #[cfg(not(target_os = "windows"))]
    {
        return Err("Git installer launch is only supported on Windows".to_string());
    }

    #[cfg(target_os = "windows")]
    {
        let tasks = state
            .git_download_tasks
            .lock()
            .map_err(|_| "failed to lock git download tasks".to_string())?;
        let task = tasks
            .get(&input.task_id)
            .ok_or_else(|| "download task not found".to_string())?;
        if !task.destination_path.exists() {
            return Err("Installer file does not exist".to_string());
        }

        Command::new(&task.destination_path)
            .spawn()
            .map_err(|e| e.to_string())?;
        set_task_status(&task.status, "installer-started");
        Ok(Ack {
            ok: true,
            message: "installer started".to_string(),
        })
    }
}

#[tauri::command]
pub fn git_status(state: State<'_, AppState>, input: GitRefInput) -> Result<GitStatusResponse, String> {
    state.log("INFO", &format!("git_status: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;

    let repo_check = run_git(&root, &["rev-parse", "--is-inside-work-tree"]);
    if repo_check.is_err() {
        return Ok(GitStatusResponse {
            is_repo: false,
            branch: "-".to_string(),
            upstream: None,
            ahead: 0,
            behind: 0,
            changes: Vec::new(),
        });
    }

    let raw = run_git(&root, &["status", "--porcelain=v1", "-b"])?;
    let mut lines = raw.lines();
    let header = lines.next().unwrap_or_default();
    let (branch, upstream, ahead, behind) = parse_branch_header(header);

    let mut changes = Vec::new();
    for line in lines {
        if line.len() < 4 {
            continue;
        }
        let mut chars = line.chars();
        let index_status = chars.next().unwrap_or(' ').to_string();
        let worktree_status = chars.next().unwrap_or(' ').to_string();
        let path = line[3..].trim().to_string();
        changes.push(GitStatusEntry {
            path,
            index_status,
            worktree_status,
        });
    }

    Ok(GitStatusResponse {
        is_repo: true,
        branch,
        upstream,
        ahead,
        behind,
        changes,
    })
}

#[tauri::command]
pub fn git_branches(state: State<'_, AppState>, input: GitRefInput) -> Result<Vec<GitBranchInfo>, String> {
    state.log("INFO", &format!("git_branches: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let raw = run_git(&root, &["branch", "--format=%(HEAD)%09%(refname:short)"])?;
    let mut branches = Vec::new();
    for line in raw.lines() {
        let mut parts = line.split('\t');
        let head = parts.next().unwrap_or_default();
        let name = parts.next().unwrap_or_default().trim();
        if name.is_empty() {
            continue;
        }
        branches.push(GitBranchInfo {
            name: name.to_string(),
            current: head.trim() == "*",
        });
    }
    Ok(branches)
}

#[tauri::command]
pub fn git_log(state: State<'_, AppState>, input: GitLogInput) -> Result<Vec<GitCommitInfo>, String> {
    state.log("INFO", &format!("git_log: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let limit = input.limit.unwrap_or(50).min(200).to_string();
    let raw = run_git(
        &root,
        &[
            "log",
            "--date=iso",
            "--pretty=format:%H%x09%h%x09%an%x09%ad%x09%s",
            "-n",
            &limit,
        ],
    )?;
    let mut commits = Vec::new();
    for line in raw.lines() {
        let parts = line.splitn(5, '\t').collect::<Vec<_>>();
        if parts.len() < 5 {
            continue;
        }
        commits.push(GitCommitInfo {
            hash: parts[0].to_string(),
            short_hash: parts[1].to_string(),
            author: parts[2].to_string(),
            date: parts[3].to_string(),
            subject: parts[4].to_string(),
        });
    }
    Ok(commits)
}

#[tauri::command]
pub fn git_stage(state: State<'_, AppState>, input: GitPathsInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_stage: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    if input.paths.is_empty() {
        run_git(&root, &["add", "-A"])?;
    } else {
        let mut command = Command::new("git");
        command.arg("-C").arg(&root).arg("add").arg("--");
        for path in input.paths {
            command.arg(path);
        }
        let output = command.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }
    Ok(Ack {
        ok: true,
        message: "staged".to_string(),
    })
}

#[tauri::command]
pub fn git_unstage(state: State<'_, AppState>, input: GitPathsInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_unstage: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    if input.paths.is_empty() {
        run_git(&root, &["restore", "--staged", "."])?;
    } else {
        let mut command = Command::new("git");
        command
            .arg("-C")
            .arg(&root)
            .arg("restore")
            .arg("--staged")
            .arg("--");
        for path in input.paths {
            command.arg(path);
        }
        let output = command.output().map_err(|e| e.to_string())?;
        if !output.status.success() {
            return Err(String::from_utf8_lossy(&output.stderr).trim().to_string());
        }
    }
    Ok(Ack {
        ok: true,
        message: "unstaged".to_string(),
    })
}

#[tauri::command]
pub fn git_commit(state: State<'_, AppState>, input: GitCommitInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_commit: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    if input.message.trim().is_empty() {
        return Err("Commit message cannot be empty".to_string());
    }
    run_git(&root, &["commit", "-m", input.message.trim()])?;
    Ok(Ack {
        ok: true,
        message: "committed".to_string(),
    })
}

#[tauri::command]
pub fn git_checkout(state: State<'_, AppState>, input: GitCheckoutInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_checkout: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    if input.create.unwrap_or(false) {
        run_git(&root, &["checkout", "-b", input.branch.trim()])?;
    } else {
        run_git(&root, &["checkout", input.branch.trim()])?;
    }
    Ok(Ack {
        ok: true,
        message: "checked out".to_string(),
    })
}

#[tauri::command]
pub fn git_fetch(state: State<'_, AppState>, input: GitRemoteInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_fetch: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let remote = input.remote.unwrap_or_else(|| "origin".to_string());
    run_git(&root, &["fetch", remote.as_str()])?;
    Ok(Ack {
        ok: true,
        message: "fetched".to_string(),
    })
}

#[tauri::command]
pub fn git_pull(state: State<'_, AppState>, input: GitRemoteInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_pull: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let remote = input.remote.unwrap_or_else(|| "origin".to_string());
    if let Some(branch) = input.branch {
        run_git(&root, &["pull", remote.as_str(), branch.as_str()])?;
    } else {
        run_git(&root, &["pull", remote.as_str()])?;
    }
    Ok(Ack {
        ok: true,
        message: "pulled".to_string(),
    })
}

#[tauri::command]
pub fn git_push(state: State<'_, AppState>, input: GitRemoteInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_push: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let remote = input.remote.unwrap_or_else(|| "origin".to_string());
    if let Some(branch) = input.branch {
        run_git(&root, &["push", remote.as_str(), branch.as_str()])?;
    } else {
        run_git(&root, &["push", remote.as_str()])?;
    }
    Ok(Ack {
        ok: true,
        message: "pushed".to_string(),
    })
}
