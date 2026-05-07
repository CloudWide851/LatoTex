use std::path::Path;

const LIBRARY_ROOT: &str = ".latotex/papers";

fn normalize_context_path(value: &str) -> Option<String> {
    let normalized = value
        .trim()
        .replace('\\', "/")
        .trim_matches('/')
        .trim_start_matches("./")
        .to_string();
    if normalized.is_empty() {
        return None;
    }
    Some(normalized)
}

fn is_library_document_path(value: &str) -> bool {
    Path::new(value)
        .extension()
        .and_then(|extension| extension.to_str())
        .map(|extension| matches!(extension.to_ascii_lowercase().as_str(), "bib" | "pdf"))
        .unwrap_or(false)
}

pub(crate) fn context_path_candidates(value: &str) -> Vec<String> {
    let Some(normalized) = normalize_context_path(value) else {
        return Vec::new();
    };
    let mut candidates = vec![normalized.clone()];
    if is_library_document_path(&normalized)
        && normalized != LIBRARY_ROOT
        && !normalized.starts_with(&format!("{LIBRARY_ROOT}/"))
    {
        candidates.push(format!("{LIBRARY_ROOT}/{normalized}"));
    }
    candidates
}

#[cfg(test)]
mod tests {
    use super::context_path_candidates;

    #[test]
    fn adds_paper_library_fallback_for_bib_refs() {
        assert_eq!(
            context_path_candidates("demo.bib"),
            vec![
                "demo.bib".to_string(),
                ".latotex/papers/demo.bib".to_string(),
            ],
        );
    }

    #[test]
    fn keeps_existing_paper_library_refs_single() {
        assert_eq!(
            context_path_candidates(".latotex/papers/demo.bib"),
            vec![".latotex/papers/demo.bib".to_string()],
        );
    }
}
