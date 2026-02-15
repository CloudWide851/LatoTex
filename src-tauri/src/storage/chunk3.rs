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
    refresh_library_index(&root)?;
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

fn slugify_name(input: &str, fallback: &str) -> String {
    let mut output = String::new();
    let mut prev_dash = false;
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
            prev_dash = false;
            continue;
        }
        if !prev_dash {
            output.push('-');
            prev_dash = true;
        }
    }
    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        fallback.to_string()
    } else {
        trimmed.to_string()
    }
}

fn normalize_doi(text: &str) -> Option<String> {
    let value = text
        .trim()
        .trim_start_matches("doi:")
        .trim_start_matches("DOI:")
        .trim();
    let lower = value.to_lowercase();
    let from_url = if let Some(index) = lower.find("doi.org/") {
        &value[index + "doi.org/".len()..]
    } else {
        value
    };
    let token = from_url
        .split_whitespace()
        .next()
        .unwrap_or_default()
        .trim_end_matches(['.', ',', ';']);
    if token.starts_with("10.") && token.contains('/') {
        Some(token.to_string())
    } else {
        None
    }
}

fn extract_arxiv_id(text: &str) -> Option<String> {
    let value = text.trim();
    let lower = value.to_lowercase();
    let token = if let Some(index) = lower.find("arxiv.org/abs/") {
        &value[index + "arxiv.org/abs/".len()..]
    } else if let Some(index) = lower.find("arxiv.org/pdf/") {
        &value[index + "arxiv.org/pdf/".len()..]
    } else if lower.starts_with("arxiv:") {
        &value["arxiv:".len()..]
    } else {
        ""
    };
    if token.is_empty() {
        return None;
    }
    let normalized = token
        .split(['?', '#', '/'])
        .next()
        .unwrap_or_default()
        .trim_end_matches(".pdf")
        .trim();
    if normalized.is_empty() {
        None
    } else {
        Some(normalized.to_string())
    }
}

fn sanitize_citation_key(input: &str) -> String {
    let mut output = String::new();
    for ch in input.chars() {
        if ch.is_ascii_alphanumeric() {
            output.push(ch.to_ascii_lowercase());
        } else if matches!(ch, '-' | '_' | ':') {
            output.push('-');
        }
    }
    let trimmed = output.trim_matches('-');
    if trimmed.is_empty() {
        "paper".to_string()
    } else {
        trimmed.to_string()
    }
}

fn unique_path_with_extension(dir: &Path, stem: &str, extension: &str) -> PathBuf {
    let ext = extension.trim_start_matches('.');
    let mut index = 1_u32;
    loop {
        let candidate = if index == 1 {
            dir.join(format!("{stem}.{ext}"))
        } else {
            dir.join(format!("{stem}-{index}.{ext}"))
        };
        if !candidate.exists() {
            return candidate;
        }
        index = index.saturating_add(1);
    }
}

fn touch_project_updated_at(db_path: &Path, project_id: &str) -> Result<(), String> {
    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), project_id],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

pub fn import_library_pdf(db_path: &Path, project_id: &str, source_path: &Path) -> Result<Ack, String> {
    if !source_path.exists() || !source_path.is_file() {
        return Err("Selected PDF file is not accessible".to_string());
    }
    let extension = source_path
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .to_lowercase();
    if extension != "pdf" {
        return Err("Only PDF files can be imported into the paper library".to_string());
    }

    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let stem = source_path
        .file_stem()
        .and_then(|name| name.to_str())
        .unwrap_or("paper");
    let normalized_stem = slugify_name(stem, "paper");
    let target_pdf = unique_path_with_extension(&papers_root, &normalized_stem, "pdf");
    fs::copy(source_path, &target_pdf).map_err(|e| e.to_string())?;

    let citation_key = sanitize_citation_key(
        target_pdf
            .file_stem()
            .and_then(|name| name.to_str())
            .unwrap_or("paper"),
    );
    let title = stem.replace(['_', '-'], " ");
    let bib_entry = format!(
        "@misc{{{citation_key},\n  title = {{{title}}},\n  note = {{Imported from local PDF by LatoTex}}\n}}\n"
    );
    fs::write(target_pdf.with_extension("bib"), bib_entry).map_err(|e| e.to_string())?;

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;
    touch_project_updated_at(db_path, project_id)?;

    Ok(Ack {
        ok: true,
        message: "Paper PDF imported".to_string(),
    })
}

pub fn import_library_link(db_path: &Path, project_id: &str, link: &str) -> Result<Ack, String> {
    let trimmed = link.trim();
    if trimmed.is_empty() {
        return Err("Link cannot be empty".to_string());
    }

    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let (stem, citation_key, bib_entry) = if let Some(doi) = normalize_doi(trimmed) {
        let stem = format!("doi-{}", slugify_name(&doi, "doi"));
        let key = sanitize_citation_key(&stem);
        let entry = format!(
            "@article{{{key},\n  doi = {{{doi}}},\n  url = {{https://doi.org/{doi}}}\n}}\n"
        );
        (stem, key, entry)
    } else if let Some(arxiv_id) = extract_arxiv_id(trimmed) {
        let stem = format!("arxiv-{}", slugify_name(&arxiv_id, "arxiv"));
        let key = sanitize_citation_key(&stem);
        let entry = format!(
            "@misc{{{key},\n  eprint = {{{arxiv_id}}},\n  archivePrefix = {{arXiv}},\n  url = {{https://arxiv.org/abs/{arxiv_id}}}\n}}\n"
        );
        (stem, key, entry)
    } else {
        let timestamp = Utc::now().format("%Y%m%d%H%M%S").to_string();
        let stem = format!("link-{timestamp}");
        let key = sanitize_citation_key(&stem);
        let entry = format!("@misc{{{key},\n  url = {{{trimmed}}}\n}}\n");
        (stem, key, entry)
    };

    let bib_path = unique_path_with_extension(&papers_root, &stem, "bib");
    let final_entry = if bib_entry.contains(&format!("@misc{{{citation_key}")) || bib_entry.contains(&format!("@article{{{citation_key}")) {
        bib_entry
    } else {
        format!("@misc{{{citation_key},\n  url = {{{trimmed}}}\n}}\n")
    };
    fs::write(bib_path, final_entry).map_err(|e| e.to_string())?;

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;
    touch_project_updated_at(db_path, project_id)?;

    Ok(Ack {
        ok: true,
        message: "Paper link imported".to_string(),
    })
}

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
            trash::delete(&path).map_err(|e| e.to_string())?;
        }
        _ => return Err("Unsupported file action".to_string()),
    }

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;
    conn.execute(
        "UPDATE projects SET updated_at = ?1 WHERE id = ?2",
        params![now_iso(), input.project_id],
    )
    .map_err(|e| e.to_string())?;

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;

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

