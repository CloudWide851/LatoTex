fn read_library_bib_preview(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<String, String> {
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

    let preview_path = if source
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("bib"))
        .unwrap_or(false)
    {
        Some(source)
    } else {
        let sibling = source.with_extension("bib");
        if sibling.exists() && sibling.is_file() {
            Some(sibling)
        } else {
            None
        }
    };

    preview_path
        .map(|path| fs::read_to_string(path).map_err(|e| e.to_string()))
        .transpose()
        .map(|value| value.unwrap_or_default())
}

pub fn library_open_document_runtime(
    state: &crate::state::AppState,
    project_id: &str,
    relative_path: &str,
    bust_cache: bool,
) -> Result<crate::models::LibraryDocumentOpenResponse, String> {
    let citation = library_citation_summary(&state.db_path, project_id, relative_path)?;
    let bib_preview = read_library_bib_preview(&state.db_path, project_id, relative_path)?;
    let pdf_preview =
        library_resolve_pdf_preview_runtime(state, project_id, relative_path, bust_cache)?;

    Ok(crate::models::LibraryDocumentOpenResponse {
        citation,
        bib_preview,
        pdf_preview,
    })
}

#[cfg(test)]
#[path = "library_document_state_tests.rs"]
mod library_document_state_tests;
