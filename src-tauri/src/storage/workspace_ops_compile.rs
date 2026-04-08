fn copy_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let from = item.path();
            let to = target.join(item.file_name());
            copy_recursively(&from, &to)?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn move_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    match fs::rename(source, target) {
        Ok(_) => Ok(()),
        Err(error) => {
            if error.kind() == io::ErrorKind::CrossesDevices {
                copy_recursively(source, target)?;
                if source.is_dir() {
                    fs::remove_dir_all(source).map_err(|e| e.to_string())?;
                } else {
                    fs::remove_file(source).map_err(|e| e.to_string())?;
                }
                Ok(())
            } else {
                Err(error.to_string())
            }
        }
    }
}

fn scope_root(project_root: &Path, scope: &str) -> Result<PathBuf, String> {
    match scope {
        "workspace" => Ok(project_root.to_path_buf()),
        "library" => {
            let root = library_root(project_root);
            fs::create_dir_all(&root).map_err(|e| e.to_string())?;
            Ok(root)
        }
        _ => Err("Unsupported scope".to_string()),
    }
}

pub fn fs_operation(db_path: &Path, input: FsOperationInput) -> Result<FsOperationResult, String> {
    let project_root = load_project_root(db_path, &input.project_id)?;
    let root = scope_root(&project_root, input.scope.trim())?;
    let path = safe_join(&root, &input.path)?;

    match input.action.as_str() {
        "create_file" => {
            if let Some(parent) = path.parent() {
                fs::create_dir_all(parent).map_err(|e| e.to_string())?;
            }
            fs::write(&path, input.content.unwrap_or_default()).map_err(|e| e.to_string())?;
        }
        "create_folder" => {
            fs::create_dir_all(&path).map_err(|e| e.to_string())?;
        }
        "rename" | "move" => {
            let target_relative = input
                .target_path
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            move_recursively(&path, &target)?;
        }
        "copy" => {
            let target_relative = input
                .target_path
                .ok_or_else(|| "targetPath is required".to_string())?;
            let target = safe_join(&root, &target_relative)?;
            copy_recursively(&path, &target)?;
        }
        "delete" => {
            if path.exists() {
                trash::delete(&path).map_err(|e| e.to_string())?;
            }
        }
        _ => return Err("Unsupported file action".to_string()),
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), input.project_id],
    )
    .map_err(|e| e.to_string())?;

    match input.scope.trim() {
        "workspace" => refresh_workspace_index(&project_root)?,
        "library" => refresh_library_index(&project_root)?,
        _ => {}
    }

    Ok(FsOperationResult {
        ok: true,
        message: "Operation completed".to_string(),
    })
}

pub fn record_compile(db_path: &Path, input: CompileRecordInput) -> Result<CompileRecord, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    let record_id = Uuid::new_v4().to_string();
    let now = now_iso();
    let diagnostics_json = serde_json::to_string(&input.diagnostics).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO compile_jobs (id, project_id, main_file, status, diagnostics, duration_ms, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)",
        params![
            record_id,
            input.project_id,
            input.main_file,
            input.status,
            diagnostics_json,
            input.duration_ms as i64,
            now
        ],
    )
    .map_err(|e| e.to_string())?;

    Ok(CompileRecord {
        id: record_id,
        project_id: input.project_id,
        main_file: input.main_file,
        status: input.status,
        diagnostics: input.diagnostics,
        duration_ms: input.duration_ms,
        created_at: now,
    })
}

