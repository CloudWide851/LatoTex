use crate::models::{
    Ack, GitBranchInfo, GitCheckoutInput, GitCommitInfo, GitCommitInput, GitLogInput, GitPathsInput,
    GitRefInput, GitRemoteInput, GitStatusEntry, GitStatusResponse,
};
use crate::state::AppState;
use crate::storage;
use std::path::Path;
use std::process::Command;
use tauri::State;

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
