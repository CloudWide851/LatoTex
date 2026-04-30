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
pub async fn git_status(
    state: State<'_, AppState>,
    input: GitRefInput,
) -> Result<GitStatusResponse, String> {
    state.log("INFO", &format!("git_status: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || {
        let root = storage::load_project_root(&db_path, &project_id)?;

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

        let raw = run_git(
            &root,
            &[
                "status",
                "--porcelain=v1",
                "-b",
                "--untracked-files=normal",
                "--ignored=matching",
            ],
        )?;
        let unstaged_numstat =
            parse_numstat(&run_git(&root, &["diff", "--numstat"]).unwrap_or_default());
        let staged_numstat =
            parse_numstat(&run_git(&root, &["diff", "--cached", "--numstat"]).unwrap_or_default());
        let mut lines = raw.lines();
        let header = lines.next().unwrap_or_default();
        let (branch, upstream, ahead, behind) = parse_branch_header(header);

        let mut changes = Vec::new();
        for line in lines {
            if line.len() < 4 {
                continue;
            }
            let mut chars = line.chars();
            let index_status_char = chars.next().unwrap_or(' ');
            let worktree_status_char = chars.next().unwrap_or(' ');
            let index_status = index_status_char.to_string();
            let worktree_status = worktree_status_char.to_string();
            let ignored = index_status_char == '!' && worktree_status_char == '!';
            let untracked = index_status_char == '?' || worktree_status_char == '?';
            let status_implies_change = matches!(index_status_char, 'R' | 'C' | 'T' | 'U' | 'D')
                || matches!(worktree_status_char, 'R' | 'C' | 'T' | 'U' | 'D');
            let (path, previous_path) = parse_status_paths(&line[3..]);
            if storage::is_workspace_path_within_python_venv(&root, &path) {
                continue;
            }
            let absolute_path = root.join(&path);
            if absolute_path.exists() && absolute_path.is_dir() {
                continue;
            }
            let staged = staged_numstat.get(&path).copied().unwrap_or((0, 0));
            let unstaged = unstaged_numstat.get(&path).copied().unwrap_or((0, 0));
            let mut added_lines = staged.0.saturating_add(unstaged.0);
            let removed_lines = staged.1.saturating_add(unstaged.1);
            if added_lines == 0 && removed_lines == 0 {
                if untracked {
                    added_lines = estimate_untracked_added_lines(&root, &path);
                } else if !ignored
                    && !status_implies_change
                    && !path_has_effective_content_change(
                        &root,
                        &path,
                        index_status_char,
                        worktree_status_char,
                    )?
                {
                    continue;
                }
            }
            changes.push(GitStatusEntry {
                path,
                previous_path,
                index_status,
                worktree_status,
                added_lines,
                removed_lines,
                ignored,
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_branches(
    state: State<'_, AppState>,
    input: GitRefInput,
) -> Result<Vec<GitBranchInfo>, String> {
    state.log("INFO", &format!("git_branches: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || {
        let root = storage::load_project_root(&db_path, &project_id)?;
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn git_log(
    state: State<'_, AppState>,
    input: GitLogInput,
) -> Result<Vec<GitCommitInfo>, String> {
    state.log("INFO", &format!("git_log: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let limit = input.limit.unwrap_or(100).min(200).to_string();
    spawn_blocking(move || {
        let root = storage::load_project_root(&db_path, &project_id)?;
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
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn git_commit_files(
    state: State<'_, AppState>,
    input: GitCommitFilesInput,
) -> Result<Vec<GitCommitFileEntry>, String> {
    state.log(
        "INFO",
        &format!("git_commit_files: {}@{}", input.project_id, input.revision),
    );
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let revision = input.revision.trim();
    if revision.is_empty() {
        return Ok(Vec::new());
    }

    let numstat = parse_numstat(
        &run_git(&root, &["show", "--format=", "--numstat", revision]).unwrap_or_default(),
    );
    let raw = run_git(
        &root,
        &["show", "--format=", "--name-status", "--find-renames", revision],
    )?;

    let mut files = Vec::new();
    for line in raw.lines() {
        if line.trim().is_empty() {
            continue;
        }
        let parts = line.split('\t').collect::<Vec<_>>();
        if parts.len() < 2 {
            continue;
        }
        let status_raw = parts[0].trim();
        let status = status_raw.chars().next().unwrap_or('M').to_string();
        let mut previous_path = None;
        let path = if status == "R" || status == "C" {
            if parts.len() < 3 {
                continue;
            }
            previous_path = Some(normalize_status_path(parts[1]));
            normalize_status_path(parts[2])
        } else {
            let path_raw = parts.last().copied().unwrap_or_default();
            normalize_status_path(path_raw)
        };
        if path.is_empty() {
            continue;
        }
        let absolute_path = root.join(&path);
        if absolute_path.exists() && absolute_path.is_dir() {
            continue;
        }
        let (added_lines, removed_lines) = numstat.get(&path).copied().unwrap_or((0, 0));
        files.push(GitCommitFileEntry {
            path,
            previous_path,
            status,
            added_lines,
            removed_lines,
        });
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

#[tauri::command]
pub fn git_stage(state: State<'_, AppState>, input: GitPathsInput) -> Result<Ack, String> {
    state.log("INFO", &format!("git_stage: {}", input.project_id));
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let raw_status = run_git(
        &root,
        &[
            "status",
            "--porcelain=v1",
            "--untracked-files=normal",
            "--ignored=matching",
        ],
    )?;
    let stageable = collect_stageable_paths(&raw_status);
    let mut explicit_paths = Vec::<String>::new();
    for path in input.paths {
        let normalized = normalize_status_path(&path);
        if normalized.is_empty() || explicit_paths.contains(&normalized) {
            continue;
        }
        explicit_paths.push(normalized);
    }
    let target_paths = if explicit_paths.is_empty() {
        stageable
            .into_iter()
            .filter(|path| !storage::is_workspace_path_within_python_venv(&root, path))
            .collect::<Vec<_>>()
    } else {
        explicit_paths
    };

    if target_paths.is_empty() {
        return Ok(Ack {
            ok: true,
            message: "nothing to stage".to_string(),
        });
    }

    {
        let mut command = Command::new("git");
        hide_console_window(&mut command);
        command.arg("-C").arg(&root).arg("add").arg("--");
        for path in target_paths {
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
        hide_console_window(&mut command);
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

fn synthetic_untracked_diff(root: &Path, relative_path: &str) -> Option<GitDiffResponse> {
    let porcelain = run_git(root, &["status", "--porcelain=v1", "--", relative_path]).ok()?;
    if !porcelain.lines().any(|line| line.starts_with("?? ")) {
        return None;
    }
    let file_path = root.join(relative_path);
    if !file_path.exists() || !file_path.is_file() {
        return None;
    }
    let bytes = fs::read(file_path).ok()?;
    if bytes.contains(&0) {
        return Some(GitDiffResponse {
            path: relative_path.to_string(),
            staged: false,
            added_lines: 0,
            removed_lines: 0,
            hunks: Vec::new(),
        });
    }
    let content = String::from_utf8_lossy(&bytes);
    let mut lines = Vec::new();
    for (index, line) in content.lines().enumerate() {
        lines.push(GitDiffLine {
            kind: "added".to_string(),
            old_line: None,
            new_line: Some((index + 1) as u32),
            text: format!("+{line}"),
        });
    }
    let hunk = GitDiffHunk {
        header: format!("@@ -0,0 +1,{} @@", lines.len()),
        lines,
    };
    Some(GitDiffResponse {
        path: relative_path.to_string(),
        staged: false,
        added_lines: hunk.lines.len() as u32,
        removed_lines: 0,
        hunks: vec![hunk],
    })
}

#[tauri::command]
pub fn git_diff_file(
    state: State<'_, AppState>,
    input: GitDiffInput,
) -> Result<GitDiffResponse, String> {
    state.log(
        "INFO",
        &format!(
            "git_diff_file: project={}, path={}, staged={}",
            input.project_id,
            input.path,
            input.staged.unwrap_or(false)
        ),
    );
    let root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let staged = input.staged.unwrap_or(false);
    let context_lines = input.context_lines.unwrap_or(3).min(10).to_string();
    let revision = input
        .revision
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());

    let unified_arg = format!("--unified={context_lines}");
    let args = if let Some(commit_rev) = revision {
        vec![
            "show",
            "--format=",
            unified_arg.as_str(),
            commit_rev,
            "--",
            input.path.as_str(),
        ]
    } else {
        let mut built = vec!["diff"];
        if staged {
            built.push("--cached");
        }
        built.push(unified_arg.as_str());
        built.push("--");
        built.push(input.path.as_str());
        built
    };

    let patch = run_git(&root, &args)?;
    let numstat_args = if let Some(commit_rev) = revision {
        vec![
            "show",
            "--format=",
            "--numstat",
            commit_rev,
            "--",
            input.path.as_str(),
        ]
    } else if staged {
        vec!["diff", "--cached", "--numstat", "--", input.path.as_str()]
    } else {
        vec!["diff", "--numstat", "--", input.path.as_str()]
    };
    let numstat = parse_numstat(&run_git(&root, &numstat_args).unwrap_or_default());
    let (added_lines, removed_lines) = numstat.get(&input.path).copied().unwrap_or((0, 0));

    let mut hunks: Vec<GitDiffHunk> = Vec::new();
    let mut current_hunk: Option<GitDiffHunk> = None;
    let mut old_line = None::<u32>;
    let mut new_line = None::<u32>;

    for raw_line in patch.lines() {
        if raw_line.starts_with("@@") {
            if let Some(hunk) = current_hunk.take() {
                hunks.push(hunk);
            }
            let (old_start, new_start) = parse_hunk_header(raw_line);
            old_line = old_start;
            new_line = new_start;
            current_hunk = Some(GitDiffHunk {
                header: raw_line.to_string(),
                lines: Vec::new(),
            });
            continue;
        }

        if current_hunk.is_none() {
            continue;
        }

        let (kind, old_at, new_at) = if raw_line.starts_with('+') && !raw_line.starts_with("+++") {
            let old_at = None;
            let new_at = new_line;
            new_line = new_line.map(|line| line.saturating_add(1));
            ("added".to_string(), old_at, new_at)
        } else if raw_line.starts_with('-') && !raw_line.starts_with("---") {
            let old_at = old_line;
            let new_at = None;
            old_line = old_line.map(|line| line.saturating_add(1));
            ("removed".to_string(), old_at, new_at)
        } else {
            let old_at = old_line;
            let new_at = new_line;
            old_line = old_line.map(|line| line.saturating_add(1));
            new_line = new_line.map(|line| line.saturating_add(1));
            ("context".to_string(), old_at, new_at)
        };

        if let Some(hunk) = current_hunk.as_mut() {
            hunk.lines.push(GitDiffLine {
                kind,
                old_line: old_at,
                new_line: new_at,
                text: raw_line.to_string(),
            });
        }
    }

    if let Some(hunk) = current_hunk.take() {
        hunks.push(hunk);
    }

    if hunks.is_empty() && !staged && revision.is_none() {
        if let Some(synthetic) = synthetic_untracked_diff(&root, &input.path) {
            return Ok(synthetic);
        }
    }

    Ok(GitDiffResponse {
        path: input.path,
        staged,
        added_lines,
        removed_lines,
        hunks,
    })
}

