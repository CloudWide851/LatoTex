fn run_git(root: &Path, args: &[&str]) -> Result<String, String> {
    let mut command = Command::new("git");
    hide_console_window(&mut command);
    let output = command
        .arg("-c")
        .arg("core.quotepath=false")
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
    let mut command = Command::new("git");
    hide_console_window(&mut command);
    let output = command.arg("--version").output().ok()?;
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

fn parse_numstat(raw: &str) -> std::collections::HashMap<String, (u32, u32)> {
    let mut map: std::collections::HashMap<String, (u32, u32)> = std::collections::HashMap::new();
    for line in raw.lines() {
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.len() < 3 {
            continue;
        }
        let added = parts[0].parse::<u32>().unwrap_or(0);
        let removed = parts[1].parse::<u32>().unwrap_or(0);
        let path = normalize_numstat_path(parts[2..].join("\t").trim());
        if path.is_empty() {
            continue;
        }
        let entry = map.entry(path).or_insert((0_u32, 0_u32));
        entry.0 = entry.0.saturating_add(added);
        entry.1 = entry.1.saturating_add(removed);
    }
    map
}

fn normalize_status_path(raw: &str) -> String {
    let candidate = raw.rsplit(" -> ").next().unwrap_or(raw).trim();
    let unquoted = candidate.trim_matches('"');
    unquoted.replace('\\', "/")
}

fn normalize_numstat_path(raw: &str) -> String {
    let candidate = raw.rsplit(" -> ").next().unwrap_or(raw).trim();
    let unquoted = candidate.trim_matches('"');
    let path = expand_brace_rename_path(unquoted);
    path.replace('\\', "/")
}

fn expand_brace_rename_path(input: &str) -> String {
    let Some(start) = input.find('{') else {
        return input.to_string();
    };
    let Some(end) = input[start..].find('}') else {
        return input.to_string();
    };
    let end_index = start + end;
    let inside = &input[start + 1..end_index];
    let Some((_, right)) = inside.split_once("=>") else {
        return input.to_string();
    };
    let prefix = &input[..start];
    let suffix = &input[end_index + 1..];
    format!("{prefix}{}{suffix}", right.trim())
}

fn estimate_untracked_added_lines(root: &Path, relative_path: &str) -> u32 {
    let file_path = root.join(relative_path);
    let Ok(bytes) = fs::read(&file_path) else {
        return 0;
    };
    if bytes.contains(&0) {
        return 0;
    }
    let content = String::from_utf8_lossy(&bytes);
    let line_count = content.lines().count();
    u32::try_from(line_count).unwrap_or(0)
}

fn parse_hunk_header(header: &str) -> (Option<u32>, Option<u32>) {
    let mut old_line = None;
    let mut new_line = None;
    // @@ -12,3 +12,7 @@
    let chunks = header.split_whitespace().collect::<Vec<_>>();
    if chunks.len() >= 3 {
        if let Some(old) = chunks.get(1) {
            old_line = old
                .trim_start_matches('-')
                .split(',')
                .next()
                .and_then(|value| value.parse::<u32>().ok());
        }
        if let Some(new) = chunks.get(2) {
            new_line = new
                .trim_start_matches('+')
                .split(',')
                .next()
                .and_then(|value| value.parse::<u32>().ok());
        }
    }
    (old_line, new_line)
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

