fn node_sort_key(node: &ResourceNode) -> (u8, String) {
    let rank = if node.kind == "directory" { 0 } else { 1 };
    (rank, node.name.to_lowercase())
}

fn should_show_workspace_entry(name: &str, is_dir: bool) -> bool {
    if is_dir && name == ".git" {
        return false;
    }
    if !name.starts_with('.') {
        return true;
    }
    matches!(name, ".gitignore" | ".editorconfig")
}

fn build_resource_node(root_path: &Path, path: &Path) -> Result<ResourceNode, String> {
    let relative_path = path
        .strip_prefix(root_path)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let name = path
        .file_name()
        .map(|n| n.to_string_lossy().to_string())
        .unwrap_or_else(|| relative_path.clone());

    if path.is_dir() {
        let mut children = Vec::new();
        for item in fs::read_dir(path).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let item_name = item.file_name().to_string_lossy().to_string();
            let item_path = item.path();
            if !should_show_workspace_entry(&item_name, item_path.is_dir()) {
                continue;
            }
            children.push(build_resource_node(root_path, &item_path)?);
        }
        children.sort_by_key(node_sort_key);
        Ok(ResourceNode {
            name,
            relative_path,
            kind: "directory".to_string(),
            children,
        })
    } else {
        Ok(ResourceNode {
            name,
            relative_path,
            kind: "file".to_string(),
            children: Vec::new(),
        })
    }
}

pub fn load_project_root(db_path: &Path, project_id: &str) -> Result<PathBuf, String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.query_row(
        "SELECT root_path FROM projects WHERE id = ?1",
        params![project_id],
        |row| row.get::<_, String>(0).map(PathBuf::from),
    )
    .map_err(|e| e.to_string())
}

fn safe_join(root: &Path, relative_path: &str) -> Result<PathBuf, String> {
    let sanitized = relative_path.replace('\\', "/");
    let candidate = root.join(&sanitized);
    let canonical_root = root.canonicalize().map_err(|e| e.to_string())?;

    let normalized_candidate = if candidate.exists() {
        candidate.canonicalize().map_err(|e| e.to_string())?
    } else {
        let mut existing_parent = candidate.as_path();
        while !existing_parent.exists() {
            existing_parent = existing_parent
                .parent()
                .ok_or_else(|| "Invalid target path".to_string())?;
        }
        let canonical_existing = existing_parent.canonicalize().map_err(|e| e.to_string())?;
        let stripped = candidate
            .strip_prefix(existing_parent)
            .map_err(|e| e.to_string())?;
        canonical_existing.join(stripped)
    };

    if !normalized_candidate.starts_with(&canonical_root) {
        return Err("Path traversal detected".to_string());
    }
    Ok(normalized_candidate)
}

pub fn read_project_file(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<FileReadResponse, String> {
    let root = load_project_root(db_path, project_id)?;
    let target = safe_join(&root, relative_path)?;
    let content = fs::read_to_string(target).map_err(|e| e.to_string())?;
    Ok(FileReadResponse {
        relative_path: relative_path.to_string(),
        content,
    })
}

pub fn read_project_file_binary(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<FileReadBinaryResponse, String> {
    let root = load_project_root(db_path, project_id)?;
    let target = safe_join(&root, relative_path)?;
    let bytes = fs::read(target).map_err(|e| e.to_string())?;
    Ok(FileReadBinaryResponse {
        relative_path: relative_path.to_string(),
        bytes,
    })
}

pub fn write_project_file(db_path: &Path, input: FileWriteInput) -> Result<Ack, String> {
    let root = load_project_root(db_path, &input.project_id)?;
    let target = safe_join(&root, &input.relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, input.content).map_err(|e| e.to_string())?;

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), input.project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Ack {
        ok: true,
        message: "File saved".to_string(),
    })
}

pub fn write_project_file_binary(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
    bytes: &[u8],
) -> Result<Ack, String> {
    let root = load_project_root(db_path, project_id)?;
    let target = safe_join(&root, relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(target, bytes).map_err(|e| e.to_string())?;

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), project_id],
    )
    .map_err(|e| e.to_string())?;

    Ok(Ack {
        ok: true,
        message: "Binary file saved".to_string(),
    })
}

const SEARCH_MAX_FILE_SIZE_BYTES: u64 = 1_048_576;

fn truncate_chars(input: &str, max_chars: usize) -> String {
    let mut output = String::new();
    for (idx, ch) in input.chars().enumerate() {
        if idx >= max_chars {
            output.push_str("...");
            return output;
        }
        output.push(ch);
    }
    output
}

fn is_ignored_search_dir(name: &str) -> bool {
    matches!(name, ".git" | "node_modules" | "target" | "dist" | ".pnpm-store")
}

fn search_tree_for_content(
    root: &Path,
    current: &Path,
    query_lower: &str,
    hits: &mut Vec<ProjectSearchHit>,
    limit: usize,
) -> Result<(), String> {
    if hits.len() >= limit {
        return Ok(());
    }

    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        if hits.len() >= limit {
            break;
        }
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();

        if path.is_dir() {
            if is_ignored_search_dir(&name) {
                continue;
            }
            search_tree_for_content(root, &path, query_lower, hits, limit)?;
            continue;
        }

        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.len() > SEARCH_MAX_FILE_SIZE_BYTES {
            continue;
        }

        let bytes = fs::read(&path).map_err(|e| e.to_string())?;
        if bytes.contains(&0) {
            continue;
        }

        let content = String::from_utf8_lossy(&bytes);
        let relative_path = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");

        for (index, line) in content.lines().enumerate() {
            if hits.len() >= limit {
                break;
            }
            if line.to_lowercase().contains(query_lower) {
                hits.push(ProjectSearchHit {
                    relative_path: relative_path.clone(),
                    line_number: (index + 1) as u32,
                    snippet: truncate_chars(line.trim(), 220),
                });
            }
        }
    }

    Ok(())
}

pub fn search_project_content(
    db_path: &Path,
    input: ProjectSearchInput,
) -> Result<Vec<ProjectSearchHit>, String> {
    let query = input.query.trim();
    if query.is_empty() {
        return Ok(Vec::new());
    }
    let limit = input.limit.unwrap_or(200).clamp(1, 500) as usize;
    let root = load_project_root(db_path, &input.project_id)?;
    let mut hits = Vec::new();
    search_tree_for_content(&root, &root, &query.to_lowercase(), &mut hits, limit)?;
    hits.sort_by(|a, b| {
        a.relative_path
            .cmp(&b.relative_path)
            .then(a.line_number.cmp(&b.line_number))
    });
    if hits.len() > limit {
        hits.truncate(limit);
    }
    Ok(hits)
}

pub fn list_library_tree(db_path: &Path, project_id: &str) -> Result<Vec<ResourceNode>, String> {
    let root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;
    list_workspace_tree(&papers_root)
}

pub fn rescan_library(db_path: &Path, project_id: &str) -> Result<Ack, String> {
    let root = load_project_root(db_path, project_id)?;
    refresh_workspace_index(&root)?;
    refresh_library_index(&root)?;
    Ok(Ack {
        ok: true,
        message: "Library index refreshed".to_string(),
    })
}

