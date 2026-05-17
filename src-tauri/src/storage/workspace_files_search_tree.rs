fn node_sort_key(node: &ResourceNode) -> (u8, String) {
    let rank = if node.kind == "directory" { 0 } else { 1 };
    (rank, node.name.to_lowercase())
}

fn is_legacy_draw_export_hidden_asset(path: &Path, name: &str, is_dir: bool) -> bool {
    if is_dir || !name.starts_with('.') {
        return false;
    }
    let extension = Path::new(name)
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !matches!(extension.as_str(), "png" | "jpg" | "jpeg" | "gif" | "webp" | "svg") {
        return false;
    }
    let stem = Path::new(name)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if stem != ".drawio" && stem != "drawio" {
        return false;
    }
    path.parent().is_some_and(|parent| {
        parent
            .ancestors()
            .filter_map(|entry| entry.file_name().and_then(|value| value.to_str()))
            .any(|entry| entry.eq_ignore_ascii_case("drawings"))
    })
}

fn should_show_workspace_entry(path: &Path, name: &str, is_dir: bool) -> bool {
    if is_dir && name == ".git" {
        return false;
    }
    if is_dir && is_python_venv_dir(path, name) {
        return true;
    }
    if is_legacy_draw_export_hidden_asset(path, name, is_dir) {
        return true;
    }
    if !name.starts_with('.') {
        return true;
    }
    matches!(name, ".gitignore" | ".editorconfig")
}

fn looks_like_python_venv_name(name: &str) -> bool {
    matches!(
        name.to_ascii_lowercase().as_str(),
        ".venv" | "venv" | "env" | ".env" | "virtualenv"
    )
}

fn is_python_venv_dir(path: &Path, name: &str) -> bool {
    if !looks_like_python_venv_name(name) {
        return false;
    }
    path.join("pyvenv.cfg").exists()
        || path.join("Scripts").join("python.exe").exists()
        || path.join("Scripts").join("activate").exists()
        || path.join("bin").join("python").exists()
        || path.join("bin").join("activate").exists()
}

fn directory_role_for_path(path: &Path, name: &str) -> Option<String> {
    if is_python_venv_dir(path, name) {
        return Some("pythonVenv".to_string());
    }
    None
}

pub fn is_workspace_path_within_python_venv(root_path: &Path, relative_path: &str) -> bool {
    let normalized = relative_path.trim().replace('\\', "/");
    let trimmed = normalized.trim_matches('/');
    if trimmed.is_empty() {
        return false;
    }
    let candidate = root_path.join(trimmed);
    let mut current = candidate.as_path();
    while current.starts_with(root_path) {
        let Some(name) = current.file_name().and_then(|value| value.to_str()) else {
            break;
        };
        if is_python_venv_dir(current, name) {
            return true;
        }
        let Some(parent) = current.parent() else {
            break;
        };
        if parent == current {
            break;
        }
        current = parent;
    }
    false
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
        let directory_role = directory_role_for_path(path, &name);
        let mut children = Vec::new();
        if directory_role.as_deref() != Some("pythonVenv") {
            for item in fs::read_dir(path).map_err(|e| e.to_string())? {
                let item = item.map_err(|e| e.to_string())?;
                let item_name = item.file_name().to_string_lossy().to_string();
                let item_path = item.path();
                if !should_show_workspace_entry(&item_path, &item_name, item_path.is_dir()) {
                    continue;
                }
                children.push(build_resource_node(root_path, &item_path)?);
            }
            children.sort_by_key(node_sort_key);
        }
        Ok(ResourceNode {
            name,
            relative_path,
            kind: "directory".to_string(),
            directory_role,
            children,
        })
    } else {
        Ok(ResourceNode {
            name,
            relative_path,
            kind: "file".to_string(),
            directory_role: None,
            children: Vec::new(),
        })
    }
}
