use std::collections::BTreeMap;

fn citation_index_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("index")
        .join("papers-citation-index.json")
}

fn library_relative_from_path(papers_root: &Path, path: &Path) -> Result<String, String> {
    path.strip_prefix(papers_root)
        .map_err(|e| e.to_string())
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
}

fn collect_library_files_by_ext(root: &Path, ext: &str, out: &mut Vec<PathBuf>) -> Result<(), String> {
    if !root.exists() {
        return Ok(());
    }
    for entry in fs::read_dir(root).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let path = entry.path();
        let name = entry.file_name().to_string_lossy().to_string();
        if name == ".cache" {
            continue;
        }
        let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            collect_library_files_by_ext(&path, ext, out)?;
            continue;
        }
        if path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(ext))
            .unwrap_or(false)
        {
            out.push(path);
        }
    }
    Ok(())
}

fn normalized_library_lookup(value: &str) -> String {
    value
        .trim()
        .replace('\\', "/")
        .trim_start_matches("./")
        .trim_start_matches(".latotex/papers/")
        .to_ascii_lowercase()
}

fn citation_index_status_for_root(project_root: &Path) -> Result<LibraryCitationIndexStatus, String> {
    let papers_root = library_root(project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;
    let mut bib_paths = Vec::new();
    let mut pdf_paths = Vec::new();
    collect_library_files_by_ext(&papers_root, "bib", &mut bib_paths)?;
    collect_library_files_by_ext(&papers_root, "pdf", &mut pdf_paths)?;

    let mut key_to_paths = BTreeMap::<String, Vec<String>>::new();
    let mut invalid_bib_files = Vec::<LibraryCitationIndexIssue>::new();
    let mut missing_pdf_for_bibs = Vec::<String>::new();
    let mut indexed_entries = 0_u32;

    for bib_path in &bib_paths {
        let relative = library_relative_from_path(&papers_root, bib_path)?;
        match fs::read_to_string(bib_path) {
            Ok(content) => {
                if let Some(key) = extract_bib_entry_key(&content) {
                    indexed_entries = indexed_entries.saturating_add(1);
                    key_to_paths.entry(key).or_default().push(relative.clone());
                } else {
                    invalid_bib_files.push(LibraryCitationIndexIssue {
                        path: relative.clone(),
                        message: "citation.key_missing".to_string(),
                    });
                }
            }
            Err(error) => invalid_bib_files.push(LibraryCitationIndexIssue {
                path: relative.clone(),
                message: error.to_string(),
            }),
        }
        let pdf_candidate = bib_path.with_extension("pdf");
        if !pdf_candidate.exists() {
            missing_pdf_for_bibs.push(relative);
        }
    }

    let mut missing_bib_for_pdfs = Vec::<String>::new();
    for pdf_path in &pdf_paths {
        if !pdf_path.with_extension("bib").exists() {
            missing_bib_for_pdfs.push(library_relative_from_path(&papers_root, pdf_path)?);
        }
    }

    let duplicate_keys = key_to_paths
        .into_iter()
        .filter_map(|(citation_key, paths)| {
            if paths.len() > 1 {
                Some(LibraryCitationDuplicateKey { citation_key, paths })
            } else {
                None
            }
        })
        .collect::<Vec<_>>();

    let index_path = citation_index_path(project_root);
    let updated_at = fs::metadata(&index_path)
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(|_| now_iso());

    Ok(LibraryCitationIndexStatus {
        total_bib_files: bib_paths.len() as u32,
        total_pdf_files: pdf_paths.len() as u32,
        indexed_entries,
        duplicate_keys,
        missing_bib_for_pdfs,
        missing_pdf_for_bibs,
        invalid_bib_files,
        index_path: index_path.to_string_lossy().replace('\\', "/"),
        updated_at,
    })
}

pub fn library_citation_index_status(
    db_path: &Path,
    project_id: &str,
) -> Result<LibraryCitationIndexStatus, String> {
    let project_root = load_project_root(db_path, project_id)?;
    citation_index_status_for_root(&project_root)
}

pub fn library_citation_index_rebuild(
    db_path: &Path,
    project_id: &str,
) -> Result<LibraryCitationIndexStatus, String> {
    let project_root = load_project_root(db_path, project_id)?;
    refresh_library_index(&project_root)?;
    let status = citation_index_status_for_root(&project_root)?;
    let index_path = citation_index_path(&project_root);
    if let Some(parent) = index_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(
        &index_path,
        serde_json::to_string_pretty(&status).map_err(|e| e.to_string())?,
    )
    .map_err(|e| e.to_string())?;
    citation_index_status_for_root(&project_root)
}

fn resolve_library_query_path(
    papers_root: &Path,
    query: &str,
) -> Result<(String, String, Vec<String>), String> {
    let normalized = normalized_library_lookup(query);
    if normalized.is_empty() {
        return Err("library.citation_resolver.empty_query".to_string());
    }
    let mut candidates = Vec::<PathBuf>::new();
    collect_library_files_by_ext(papers_root, "bib", &mut candidates)?;
    collect_library_files_by_ext(papers_root, "pdf", &mut candidates)?;
    candidates.sort();

    for candidate in &candidates {
        let relative = library_relative_from_path(papers_root, candidate)?;
        if normalized_library_lookup(&relative) == normalized {
            return Ok((relative, "path".to_string(), Vec::new()));
        }
    }

    let mut title_matches = Vec::<String>::new();
    for candidate in candidates.iter().filter(|path| {
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("bib"))
            .unwrap_or(false)
    }) {
        let relative = library_relative_from_path(papers_root, candidate)?;
        let content = fs::read_to_string(candidate).unwrap_or_default();
        if extract_bib_entry_key(&content)
            .map(|key| key.eq_ignore_ascii_case(query.trim()))
            .unwrap_or(false)
        {
            return Ok((relative, "citationKey".to_string(), Vec::new()));
        }
        if extract_bib_field_value(&content, "title")
            .map(|title| title.to_ascii_lowercase().contains(&normalized))
            .unwrap_or(false)
        {
            title_matches.push(relative);
        }
    }

    if title_matches.len() == 1 {
        return Ok((title_matches.remove(0), "title".to_string(), Vec::new()));
    }
    if title_matches.len() > 1 {
        return Err(format!("library.citation_resolver.ambiguous:{}", title_matches.join(",")));
    }

    Err(format!("library.citation_resolver.not_found:{query}"))
}

pub fn library_citation_resolve(
    db_path: &Path,
    project_id: &str,
    relative_path: Option<&str>,
    query: Option<&str>,
    include_remote: bool,
) -> Result<LibraryCitationResolveResponse, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;
    let (matched_path, match_kind, mut diagnostics) = if let Some(path) = relative_path
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        (path.replace('\\', "/").trim_start_matches(".latotex/papers/").to_string(), "path".to_string(), Vec::new())
    } else if let Some(query) = query {
        resolve_library_query_path(&papers_root, query)?
    } else {
        return Err("library.citation_resolver.empty_query".to_string());
    };

    let summary = if include_remote {
        library_citation_summary_remote(db_path, project_id, &matched_path)?
    } else {
        library_citation_summary(db_path, project_id, &matched_path)?
    };

    let pdf_preview = prepare_library_pdf_preview_context(db_path, project_id, &matched_path)
        .ok()
        .and_then(|ctx| build_local_preview_response(&ctx, true).ok().flatten());
    if pdf_preview.is_none() {
        diagnostics.push("library.citation_resolver.pdf_missing_or_remote_pending".to_string());
    }

    Ok(LibraryCitationResolveResponse {
        matched_path,
        match_kind,
        summary,
        pdf_preview,
        diagnostics,
    })
}

#[cfg(test)]
mod library_citation_resolver_tests {
    use super::*;

    fn create_fixture(name: &str) -> (PathBuf, String, PathBuf, PathBuf) {
        let temp_root = std::env::temp_dir().join(format!(
            "latotex-library-citation-resolver-{}-{}",
            name,
            Uuid::new_v4()
        ));
        let runtime_root = temp_root.join("runtime");
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");
        fs::create_dir_all(&projects_dir).unwrap();
        initialize_database(&db_path).unwrap();
        let snapshot = create_project(&db_path, &projects_dir, "Citation Resolver Test").unwrap();
        let project_id = snapshot.summary.id;
        let project_root = PathBuf::from(snapshot.summary.root_path);
        (db_path, project_id, project_root, temp_root)
    }

    fn write_paper(papers_root: &Path, relative: &str, key: &str, title: &str) {
        let path = papers_root.join(relative);
        if let Some(parent) = path.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(
            path,
            format!("@article{{{key},\n  title={{{title}}},\n  author={{Test Author}}\n}}\n"),
        )
        .unwrap();
    }

    #[test]
    fn citation_index_status_reports_duplicates_and_missing_companions() {
        let (db_path, project_id, project_root, temp_root) = create_fixture("status");
        let papers_root = library_root(&project_root);
        fs::create_dir_all(&papers_root).unwrap();
        write_paper(&papers_root, "a.bib", "samekey", "First");
        write_paper(&papers_root, "nested/b.bib", "samekey", "Second");
        fs::write(papers_root.join("orphan.pdf"), b"%PDF-1.7\n").unwrap();

        let status = library_citation_index_status(&db_path, &project_id).unwrap();

        assert_eq!(status.total_bib_files, 2);
        assert_eq!(status.total_pdf_files, 1);
        assert_eq!(status.duplicate_keys.len(), 1);
        assert!(status.missing_pdf_for_bibs.iter().any(|path| path == "a.bib"));
        assert!(status.missing_bib_for_pdfs.iter().any(|path| path == "orphan.pdf"));

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn citation_resolve_matches_citation_key_locally() {
        let (db_path, project_id, project_root, temp_root) = create_fixture("resolve");
        let papers_root = library_root(&project_root);
        fs::create_dir_all(&papers_root).unwrap();
        write_paper(&papers_root, "paper.bib", "localkey", "Local Resolver Paper");

        let resolved = library_citation_resolve(
            &db_path,
            &project_id,
            None,
            Some("localkey"),
            false,
        )
        .unwrap();

        assert_eq!(resolved.matched_path, "paper.bib");
        assert_eq!(resolved.match_kind, "citationKey");
        assert_eq!(resolved.summary.citation_key.as_deref(), Some("localkey"));

        let _ = fs::remove_dir_all(temp_root);
    }
}
