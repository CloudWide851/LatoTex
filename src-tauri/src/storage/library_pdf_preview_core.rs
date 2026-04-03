struct LibraryPdfPreviewContext {
    project_root: PathBuf,
    papers_root: PathBuf,
    normalized_relative: String,
    source: PathBuf,
}

fn prepare_library_pdf_preview_context(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<LibraryPdfPreviewContext, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let normalized_relative = relative_path.trim().replace('\\', "/");
    if normalized_relative.is_empty() {
        return Err("Library path cannot be empty".to_string());
    }

    let source = safe_join(&papers_root, &normalized_relative)?;
    if !source.exists() || !source.is_file() {
        return Err("Library file does not exist".to_string());
    }

    Ok(LibraryPdfPreviewContext {
        project_root,
        papers_root,
        normalized_relative,
        source,
    })
}

fn current_unix_ms() -> u64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn hash_remote_url(url: &str) -> String {
    use std::hash::{Hash, Hasher};
    let mut hasher = std::collections::hash_map::DefaultHasher::new();
    url.hash(&mut hasher);
    format!("{:016x}", hasher.finish())
}

fn to_workspace_relative(project_root: &Path, path: &Path) -> Result<String, String> {
    let canonical_root = project_root.canonicalize().map_err(|e| e.to_string())?;
    let normalized_path = if path.exists() {
        path.canonicalize().map_err(|e| e.to_string())?
    } else {
        path.to_path_buf()
    };
    let relative = normalized_path
        .strip_prefix(&canonical_root)
        .map_err(|e| e.to_string())?
        .to_string_lossy()
        .replace('\\', "/");
    Ok(relative)
}

fn find_remote_pdf_url(summary: &LibraryCitationSummaryResponse) -> Option<String> {
    for url in &summary.urls {
        let lower = url.to_lowercase();
        if lower.ends_with(".pdf") || lower.contains(".pdf?") {
            return Some(url.clone());
        }
        if lower.contains("arxiv.org/abs/") {
            if let Some(arxiv_id) = extract_arxiv_id(url) {
                return Some(format!("https://arxiv.org/pdf/{arxiv_id}.pdf"));
            }
        }
    }
    summary
        .arxiv_id
        .as_ref()
        .map(|arxiv_id| format!("https://arxiv.org/pdf/{arxiv_id}.pdf"))
}

fn pdf_bytes_valid(bytes: &[u8]) -> bool {
    let first_non_whitespace = bytes
        .iter()
        .position(|byte| !byte.is_ascii_whitespace())
        .unwrap_or(bytes.len());
    bytes
        .get(first_non_whitespace..)
        .map(|value| value.starts_with(b"%PDF-"))
        .unwrap_or(false)
}

fn cached_pdf_file_ready(cache_path: &Path) -> bool {
    let Ok(mut file) = std::fs::File::open(cache_path) else {
        return false;
    };
    let Ok(metadata) = file.metadata() else {
        return false;
    };
    if metadata.len() == 0 {
        return false;
    }
    let mut header = [0_u8; 16];
    let Ok(read) = std::io::Read::read(&mut file, &mut header) else {
        return false;
    };
    pdf_bytes_valid(&header[..read])
}

fn temp_cache_path(cache_target: &Path) -> PathBuf {
    let file_name = cache_target
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or("paper.pdf");
    cache_target.with_file_name(format!("{file_name}.download"))
}

fn cache_remote_pdf_file<F>(
    cache_target: &Path,
    source_url: &str,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    use std::io::{Read, Write};

    let client = reqwest::blocking::Client::builder()
        .connect_timeout(std::time::Duration::from_secs(20))
        .timeout(std::time::Duration::from_secs(180))
        .user_agent("LatoTex/0.1.0")
        .build()
        .map_err(|e| e.to_string())?;
    let mut response = client.get(source_url).send().map_err(|e| e.to_string())?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("HTTP {status}"));
    }

    if let Some(parent) = cache_target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp_path = temp_cache_path(cache_target);
    let mut file = std::fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let total_bytes = response.content_length();
    let mut downloaded_bytes = 0_u64;
    let mut header = Vec::<u8>::with_capacity(32);
    let mut buffer = [0_u8; 64 * 1024];
    on_progress(downloaded_bytes, total_bytes);

    loop {
        let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read]).map_err(|e| e.to_string())?;
        if header.len() < 32 {
            let remaining = 32_usize.saturating_sub(header.len());
            header.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        downloaded_bytes = downloaded_bytes.saturating_add(read as u64);
        on_progress(downloaded_bytes, total_bytes);
    }

    file.flush().map_err(|e| e.to_string())?;
    if !pdf_bytes_valid(&header) {
        let _ = fs::remove_file(&temp_path);
        return Err("Remote file is not a valid PDF stream".to_string());
    }
    fs::rename(&temp_path, cache_target).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })?;
    on_progress(downloaded_bytes, total_bytes);
    Ok(())
}

fn to_library_relative_path_from_workspace(workspace_relative: &str) -> Option<String> {
    let normalized = workspace_relative
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .to_string();
    if normalized.is_empty() {
        return None;
    }
    normalized
        .strip_prefix(".latotex/papers/")
        .map(|value| value.to_string())
}

fn resolve_translated_pdf_workspace_path(
    project_root: &Path,
    papers_root: &Path,
    source_workspace_relative: &str,
) -> Option<String> {
    let source_library_relative = to_library_relative_path_from_workspace(source_workspace_relative)?;
    let translated_relative = translation_pdf_relative_path(&source_library_relative);
    let translated_abs = papers_root.join(Path::new(&translated_relative));
    if !translated_abs.exists() || !translated_abs.is_file() {
        return None;
    }
    to_workspace_relative(project_root, &translated_abs).ok()
}

fn clear_pdf_cache_entry(
    tasks: &std::sync::Arc<std::sync::Mutex<std::collections::HashMap<String, crate::state::LibraryPdfCacheTask>>>,
    task_key: &str,
    cache_path: &Path,
) {
    let _ = fs::remove_file(cache_path);
    if let Ok(mut tasks_guard) = tasks.lock() {
        tasks_guard.remove(task_key);
    }
}

fn resolve_local_pdf_candidate(source: &Path) -> Option<PathBuf> {
    if source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .eq_ignore_ascii_case("pdf")
    {
        return Some(source.to_path_buf());
    }
    let candidate = source.with_extension("pdf");
    if candidate.exists() && candidate.is_file() {
        Some(candidate)
    } else {
        None
    }
}

fn build_preview_response(
    project_root: &Path,
    papers_root: &Path,
    source_workspace_relative: Option<String>,
    source_url: Option<String>,
    cached: bool,
    cache_state: &str,
    cache_error: Option<String>,
    downloaded_bytes: Option<u64>,
    total_bytes: Option<u64>,
) -> LibraryPdfPreviewResponse {
    let translated_relative_path = source_workspace_relative
        .as_deref()
        .and_then(|path| resolve_translated_pdf_workspace_path(project_root, papers_root, path));
    LibraryPdfPreviewResponse {
        relative_path: source_workspace_relative,
        preview_url: None,
        source_url,
        cached,
        cache_state: cache_state.to_string(),
        cache_error,
        downloaded_bytes,
        total_bytes,
        translated_relative_path,
        translated_preview_url: None,
    }
}

fn build_local_preview_response(
    ctx: &LibraryPdfPreviewContext,
) -> Result<Option<LibraryPdfPreviewResponse>, String> {
    let Some(local_pdf_path) = resolve_local_pdf_candidate(&ctx.source) else {
        return Ok(None);
    };
    let source_workspace_relative = to_workspace_relative(&ctx.project_root, &local_pdf_path)?;
    Ok(Some(build_preview_response(
        &ctx.project_root,
        &ctx.papers_root,
        Some(source_workspace_relative),
        None,
        false,
        LIBRARY_PDF_CACHE_STATE_READY,
        None,
        None,
        None,
    )))
}

fn build_remote_cache_path(
    ctx: &LibraryPdfPreviewContext,
    source_url: &str,
) -> Result<PathBuf, String> {
    let cache_dir = ctx.papers_root.join(".cache").join("remote-pdf");
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
    Ok(cache_dir.join(format!("{}.pdf", hash_remote_url(source_url))))
}

fn build_cached_remote_preview_response(
    ctx: &LibraryPdfPreviewContext,
    source_url: &str,
    cache_path: &Path,
) -> Result<LibraryPdfPreviewResponse, String> {
    let source_workspace_relative = to_workspace_relative(&ctx.project_root, cache_path)?;
    Ok(build_preview_response(
        &ctx.project_root,
        &ctx.papers_root,
        Some(source_workspace_relative),
        Some(source_url.to_string()),
        true,
        LIBRARY_PDF_CACHE_STATE_READY,
        None,
        None,
        None,
    ))
}
