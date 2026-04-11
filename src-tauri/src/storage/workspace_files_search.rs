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

pub fn resolve_project_relative_path(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<PathBuf, String> {
    let root = load_project_root(db_path, project_id)?;
    safe_join(&root, relative_path)
}

pub fn read_project_file(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<FileReadResponse, String> {
    let target = resolve_project_relative_path(db_path, project_id, relative_path)?;
    let metadata = fs::metadata(&target).map_err(map_workspace_read_error)?;
    if !metadata.is_file() {
        return Err("workspace.file_read.not_file".to_string());
    }
    let content = fs::read_to_string(target).map_err(map_workspace_read_error)?;
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
    let target = resolve_project_relative_path(db_path, project_id, relative_path)?;
    let metadata = fs::metadata(&target).map_err(map_workspace_read_error)?;
    if !metadata.is_file() {
        return Err("workspace.file_read.not_file".to_string());
    }
    let bytes = fs::read(target).map_err(map_workspace_read_error)?;
    Ok(FileReadBinaryResponse {
        relative_path: relative_path.to_string(),
        bytes,
    })
}

fn map_workspace_read_error(error: io::Error) -> String {
    match error.kind() {
        io::ErrorKind::PermissionDenied => "workspace.file_read.access_denied".to_string(),
        _ => error.to_string(),
    }
}

pub fn write_project_file(db_path: &Path, input: FileWriteInput) -> Result<Ack, String> {
    let target = resolve_project_relative_path(db_path, &input.project_id, &input.relative_path)?;
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
    let target = resolve_project_relative_path(db_path, project_id, relative_path)?;
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

pub fn save_draw_export_asset(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
    bytes: &[u8],
) -> Result<DrawExportAssetResponse, String> {
    if bytes.is_empty() {
        return Err("Draw export bytes are empty".to_string());
    }

    let target = resolve_project_relative_path(db_path, project_id, relative_path)?;
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&target, bytes).map_err(|e| e.to_string())?;

    let metadata = fs::metadata(&target).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.len() == 0 {
        return Err("Draw export verification failed".to_string());
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), project_id],
    )
    .map_err(|e| e.to_string())?;

    let file_name = target
        .file_name()
        .map(|value| value.to_string_lossy().to_string())
        .unwrap_or_else(|| "diagram".to_string());

    Ok(DrawExportAssetResponse {
        saved_path: relative_path.replace('\\', "/"),
        file_name,
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

fn push_path_hit(
    root: &Path,
    path: &Path,
    query_lower: &str,
    hits: &mut Vec<ProjectSearchHit>,
    seen: &mut std::collections::HashSet<String>,
    limit: usize,
) -> Result<(), String> {
    if hits.len() >= limit {
        return Ok(());
    }
    let relative_path = path
        .strip_prefix(root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    let file_name = path
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    let relative_lower = relative_path.to_ascii_lowercase();
    if !relative_lower.contains(query_lower) && !file_name.contains(query_lower) {
        return Ok(());
    }
    let dedupe_key = format!("path:{relative_path}");
    if !seen.insert(dedupe_key) {
        return Ok(());
    }
    hits.push(ProjectSearchHit {
        relative_path,
        line_number: None,
        match_kind: "path".to_string(),
        snippet: "Path match".to_string(),
    });
    Ok(())
}

fn search_tree_for_content(
    root: &Path,
    current: &Path,
    query_lower: &str,
    hits: &mut Vec<ProjectSearchHit>,
    seen: &mut std::collections::HashSet<String>,
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
            search_tree_for_content(root, &path, query_lower, hits, seen, limit)?;
            continue;
        }

        push_path_hit(root, &path, query_lower, hits, seen, limit)?;
        if hits.len() >= limit {
            break;
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
                let dedupe_key = format!("content:{relative_path}:{}", index + 1);
                if !seen.insert(dedupe_key) {
                    continue;
                }
                hits.push(ProjectSearchHit {
                    relative_path: relative_path.clone(),
                    line_number: Some((index + 1) as u32),
                    match_kind: "content".to_string(),
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
    let mut seen = std::collections::HashSet::<String>::new();
    search_tree_for_content(&root, &root, &query.to_lowercase(), &mut hits, &mut seen, limit)?;
    hits.sort_by(|a, b| {
        a.match_kind
            .cmp(&b.match_kind)
            .then(a.relative_path
            .cmp(&b.relative_path)
            .then(a.line_number.unwrap_or(0).cmp(&b.line_number.unwrap_or(0))))
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

#[cfg(test)]
mod workspace_files_search_tests {
    use super::{
        is_python_venv_dir, list_workspace_tree, read_project_file_binary, save_draw_export_asset,
        search_project_content,
    };
    use crate::models::ProjectSearchInput;
    use crate::storage;
    use std::fs;
    use std::path::PathBuf;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "latotex-workspace-tree-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn create_project_fixture(name: &str) -> (PathBuf, String, PathBuf, PathBuf) {
        let temp_root = unique_temp_dir(name);
        let runtime_root = temp_root.join("runtime");
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");

        fs::create_dir_all(&projects_dir).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let snapshot = storage::create_project(&db_path, &projects_dir, "Workspace Binary Read Test")
            .unwrap();
        let project_id = snapshot.summary.id;
        let project_root = PathBuf::from(snapshot.summary.root_path);
        (temp_root, project_id, project_root, db_path)
    }

    #[test]
    fn python_venv_detection_requires_real_markers() {
        let root = unique_temp_dir("venv-marker");
        let venv_dir = root.join(".venv");
        fs::create_dir_all(&venv_dir).unwrap();
        assert!(!is_python_venv_dir(&venv_dir, ".venv"));

        fs::write(venv_dir.join("pyvenv.cfg"), "home = C:/Python312").unwrap();
        assert!(is_python_venv_dir(&venv_dir, ".venv"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn python_venv_detection_ignores_normal_folders_with_env_like_names() {
        let root = unique_temp_dir("not-venv");
        let env_dir = root.join("env");
        fs::create_dir_all(env_dir.join("src")).unwrap();

        assert!(!is_python_venv_dir(&env_dir, "env"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_tree_keeps_real_python_venv_collapsed() {
        let root = unique_temp_dir("tree-venv-collapsed");
        let venv_dir = root.join(".venv");
        fs::create_dir_all(venv_dir.join("Lib").join("site-packages")).unwrap();
        fs::write(venv_dir.join("pyvenv.cfg"), "home = C:/Python312").unwrap();
        fs::write(
            venv_dir.join("Lib").join("site-packages").join("demo.py"),
            "print('demo')",
        )
        .unwrap();

        let tree = super::list_workspace_tree(&root).unwrap();
        let venv_node = tree
            .iter()
            .find(|node| node.relative_path == ".venv")
            .expect("venv node should exist");
        assert_eq!(venv_node.directory_role.as_deref(), Some("pythonVenv"));
        assert!(venv_node.children.is_empty());

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn workspace_tree_keeps_legacy_hidden_draw_export_assets_visible() {
        let root = unique_temp_dir("legacy-draw-export-visible");
        let drawings_dir = root.join("drawings");
        fs::create_dir_all(&drawings_dir).unwrap();
        fs::write(drawings_dir.join(".drawio.png"), b"png").unwrap();
        fs::write(drawings_dir.join(".hidden.txt"), b"secret").unwrap();

        let tree = list_workspace_tree(&root).unwrap();
        let drawings_node = tree
            .iter()
            .find(|node| node.relative_path == "drawings")
            .expect("drawings directory should exist");

        assert!(drawings_node
            .children
            .iter()
            .any(|node| node.relative_path == "drawings/.drawio.png"));
        assert!(!drawings_node
            .children
            .iter()
            .any(|node| node.relative_path == "drawings/.hidden.txt"));

        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn read_project_file_binary_reads_local_library_pdf_bytes() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("binary-library");
        let relative_path = ".latotex/papers/demo-paper.pdf";
        let pdf_path = project_root.join(".latotex").join("papers").join("demo-paper.pdf");
        fs::create_dir_all(pdf_path.parent().unwrap()).unwrap();
        fs::write(&pdf_path, b"%PDF-local-library").unwrap();

        let result = read_project_file_binary(&db_path, &project_id, relative_path).unwrap();

        assert_eq!(result.relative_path, relative_path);
        assert_eq!(result.bytes, b"%PDF-local-library");

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn read_project_file_binary_reads_cached_remote_library_pdf_bytes() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("binary-remote-cache");
        let relative_path = ".latotex/cache/papers/remote-preview.pdf";
        let pdf_path = project_root
            .join(".latotex")
            .join("cache")
            .join("papers")
            .join("remote-preview.pdf");
        fs::create_dir_all(pdf_path.parent().unwrap()).unwrap();
        fs::write(&pdf_path, b"%PDF-remote-cache").unwrap();

        let result = read_project_file_binary(&db_path, &project_id, relative_path).unwrap();

        assert_eq!(result.relative_path, relative_path);
        assert_eq!(result.bytes, b"%PDF-remote-cache");

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn save_draw_export_asset_writes_verified_file_into_workspace() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("draw-export");

        let result = save_draw_export_asset(
            &db_path,
            &project_id,
            "drawings/demo.png",
            b"png-binary-data",
        )
        .unwrap();

        assert_eq!(result.saved_path, "drawings/demo.png");
        assert_eq!(result.file_name, "demo.png");
        assert_eq!(
            fs::read(project_root.join("drawings").join("demo.png")).unwrap(),
            b"png-binary-data"
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn save_draw_export_asset_writes_verified_file_into_nested_workspace_folder() {
        let (temp_root, project_id, project_root, db_path) =
            create_project_fixture("draw-export-nested");

        let result = save_draw_export_asset(
            &db_path,
            &project_id,
            "drawings/exports/demo.svg",
            b"<svg>demo</svg>",
        )
        .unwrap();

        assert_eq!(result.saved_path, "drawings/exports/demo.svg");
        assert_eq!(result.file_name, "demo.svg");
        assert_eq!(
            fs::read(project_root.join("drawings").join("exports").join("demo.svg")).unwrap(),
            b"<svg>demo</svg>"
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn search_project_content_returns_path_and_content_hits() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("search-path-and-content");
        fs::write(
            project_root.join("AlphaNotes.txt"),
            "first line\nalpha keyword appears here\nthird line",
        )
        .unwrap();

        let hits = search_project_content(
            &db_path,
            ProjectSearchInput {
                project_id,
                query: "alpha".to_string(),
                limit: Some(20),
            },
        )
        .unwrap();

        assert!(hits.iter().any(|hit| {
            hit.match_kind == "path"
                && hit.relative_path == "AlphaNotes.txt"
                && hit.line_number.is_none()
        }));
        assert!(hits.iter().any(|hit| {
            hit.match_kind == "content"
                && hit.relative_path == "AlphaNotes.txt"
                && hit.line_number == Some(2)
                && hit.snippet.contains("alpha keyword")
        }));

        let _ = fs::remove_dir_all(temp_root);
    }
}

