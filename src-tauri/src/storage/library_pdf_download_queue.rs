fn collect_resume_candidate_bib_paths(
    root: &Path,
    current: &Path,
    output: &mut Vec<String>,
) -> Result<(), String> {
    for entry in fs::read_dir(current).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                continue;
            };
            if name.eq_ignore_ascii_case(".cache") {
                continue;
            }
            collect_resume_candidate_bib_paths(root, &path, output)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let is_bib = path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("bib"))
            .unwrap_or(false);
        if !is_bib {
            continue;
        }
        let relative = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        output.push(relative);
    }
    Ok(())
}

pub fn queue_library_pdf_download(
    state: &crate::state::AppState,
    project_id: &str,
    relative_path: &str,
) -> Result<LibraryPdfPreviewResponse, String> {
    library_resolve_pdf_preview_runtime(state, project_id, relative_path, false)
}

pub fn resume_library_pdf_downloads(
    state: &crate::state::AppState,
    project_id: &str,
) -> Result<LibraryPdfResumeResponse, String> {
    let project_root = load_project_root(&state.db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let mut candidates = Vec::<String>::new();
    collect_resume_candidate_bib_paths(&papers_root, &papers_root, &mut candidates)?;

    let mut queued = 0_u32;
    let mut skipped = 0_u32;
    let mut failed = 0_u32;
    for relative_path in candidates {
        match queue_library_pdf_download(state, project_id, &relative_path) {
            Ok(preview) if preview.cache_state == LIBRARY_PDF_CACHE_STATE_PENDING => {
                queued = queued.saturating_add(1);
            }
            Ok(_) => {
                skipped = skipped.saturating_add(1);
            }
            Err(_) => {
                failed = failed.saturating_add(1);
            }
        }
    }

    Ok(LibraryPdfResumeResponse {
        queued,
        skipped,
        failed,
    })
}
