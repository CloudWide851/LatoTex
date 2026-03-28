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

    let (stem, citation_key, bib_entry) = if let Some(zotero_target) = parse_zotero_target(trimmed) {
        let bibtex = fetch_zotero_bibtex(&zotero_target)?;
        let stem = match &zotero_target {
            ZoteroTarget::Item {
                scope,
                owner_id,
                key,
            } => format!("zotero-{scope}-{owner_id}-item-{}", slugify_name(key, "item")),
            ZoteroTarget::Collection {
                scope,
                owner_id,
                key,
            } => format!("zotero-{scope}-{owner_id}-collection-{}", slugify_name(key, "collection")),
        };
        let key = sanitize_citation_key(&stem);
        (stem, key, bibtex)
    } else if let Some(doi) = normalize_doi(trimmed) {
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
    let final_entry = if bib_entry.contains(&format!("@misc{{{citation_key}"))
        || bib_entry.contains(&format!("@article{{{citation_key}"))
    {
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

fn extract_bib_entry_key(content: &str) -> Option<String> {
    let marker = content.find('@')?;
    let rest = &content[marker..];
    let open = rest.find('{')?;
    let after_open = &rest[open + 1..];
    let end = after_open.find(',')?;
    let key = after_open[..end].trim();
    if key.is_empty() {
        None
    } else {
        Some(key.to_string())
    }
}

fn trim_bib_value(raw: &str) -> String {
    let mut value = raw.trim().trim_end_matches(',').trim().to_string();
    if (value.starts_with('{') && value.ends_with('}'))
        || (value.starts_with('"') && value.ends_with('"'))
    {
        value = value[1..value.len() - 1].trim().to_string();
    }
    value
}

fn extract_bib_field_value(content: &str, field: &str) -> Option<String> {
    let needle = field.to_lowercase();
    for line in content.lines() {
        let trimmed = line.trim();
        let lower = trimmed.to_lowercase();
        if !lower.starts_with(&needle) {
            continue;
        }
        let tail = trimmed[needle.len()..].trim_start();
        if !tail.starts_with('=') {
            continue;
        }
        let value = trim_bib_value(&tail[1..]);
        if !value.is_empty() {
            return Some(value);
        }
    }
    None
}

fn push_unique_url(urls: &mut Vec<String>, url: String) {
    if url.is_empty() {
        return;
    }
    if urls.iter().any(|item| item.eq_ignore_ascii_case(&url)) {
        return;
    }
    urls.push(url);
}

fn normalize_url(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_end_matches(',').trim().to_string();
    if trimmed.is_empty() {
        return None;
    }
    if trimmed.starts_with("http://") || trimmed.starts_with("https://") {
        return Some(trimmed);
    }
    if let Some(doi) = normalize_doi(&trimmed) {
        return Some(format!("https://doi.org/{doi}"));
    }
    None
}

pub fn library_citation_summary(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<LibraryCitationSummaryResponse, String> {
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

    let bib_candidate = if source
        .extension()
        .and_then(|ext| ext.to_str())
        .unwrap_or_default()
        .eq_ignore_ascii_case("bib")
    {
        Some(source.clone())
    } else {
        let candidate = source.with_extension("bib");
        if candidate.exists() && candidate.is_file() {
            Some(candidate)
        } else {
            None
        }
    };

    let mut urls: Vec<String> = Vec::new();
    let mut citation_key = None;
    let mut title = None;
    let mut authors: Vec<String> = Vec::new();
    let mut published_at = None;
    let mut doi = None;
    let mut arxiv_id = None;
    let mut source_name = None;
    let mut bib_relative_path = None;

    if let Some(bib_path) = bib_candidate {
        let bib_content = fs::read_to_string(&bib_path).map_err(|e| e.to_string())?;
        citation_key = extract_bib_entry_key(&bib_content);
        title = extract_bib_field_value(&bib_content, "title");
        authors = extract_bib_authors(&bib_content);
        published_at = extract_bib_field_value(&bib_content, "year")
            .or_else(|| extract_bib_field_value(&bib_content, "date"));
        doi = extract_bib_field_value(&bib_content, "doi");
        arxiv_id = extract_bib_field_value(&bib_content, "eprint");

        if let Some(url_value) = extract_bib_field_value(&bib_content, "url") {
            if let Some(normalized_url) = normalize_url(&url_value) {
                push_unique_url(&mut urls, normalized_url);
            } else {
                push_unique_url(&mut urls, url_value);
            }
        }
        if let Some(doi_value) = doi.as_ref() {
            push_unique_url(&mut urls, format!("https://doi.org/{doi_value}"));
        }
        if let Some(arxiv_value) = arxiv_id.as_ref() {
            push_unique_url(&mut urls, format!("https://arxiv.org/abs/{arxiv_value}"));
        }

        if arxiv_id.is_none() {
            for url in &urls {
                if let Some(extracted) = extract_arxiv_id(url) {
                    arxiv_id = Some(extracted);
                    break;
                }
            }
        }

        let rel = bib_path
            .strip_prefix(&papers_root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        bib_relative_path = Some(rel);
    }

    if let Some(remote) = fetch_remote_metadata(doi.as_deref(), arxiv_id.as_deref(), &urls) {
        if title.is_none() {
            title = remote.title;
        }
        for author in remote.authors {
            push_unique_author(&mut authors, author);
        }
        if published_at.is_none() {
            published_at = remote.published_at;
        }
        if doi.is_none() {
            doi = remote.doi;
        }
        if arxiv_id.is_none() {
            arxiv_id = remote.arxiv_id;
        }
        source_name = remote.source;
        for url in remote.urls {
            push_unique_url(&mut urls, url);
        }
    }

    Ok(LibraryCitationSummaryResponse {
        source_path: normalized_relative,
        bib_path: bib_relative_path,
        citation_key,
        title,
        authors,
        published_at,
        doi,
        arxiv_id,
        source: source_name,
        urls,
    })
}

