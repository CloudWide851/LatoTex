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
