const ZOTERO_API_BASES_ENV: &str = "LATOTEX_ZOTERO_API_BASES";
const ARXIV_API_BASES_ENV: &str = "LATOTEX_ARXIV_API_BASES";
const ARXIV_PDF_BASES_ENV: &str = "LATOTEX_ARXIV_PDF_BASES";

const DEFAULT_ZOTERO_API_BASES: [&str; 1] = ["https://api.zotero.org"];
const DEFAULT_ARXIV_API_BASES: [&str; 2] = [
    "https://export.arxiv.org",
    "https://arxiv.org",
];
const DEFAULT_ARXIV_PDF_BASES: [&str; 2] = [
    "https://arxiv.org",
    "https://export.arxiv.org",
];

fn normalize_endpoint_base(value: &str) -> Option<String> {
    let trimmed = value.trim().trim_matches('"').trim();
    if trimmed.is_empty() {
        return None;
    }
    let normalized = trimmed.trim_end_matches('/').to_string();
    if normalized.starts_with("http://") || normalized.starts_with("https://") {
        Some(normalized)
    } else {
        None
    }
}

fn env_endpoint_candidates(var_name: &str) -> Vec<String> {
    std::env::var(var_name)
        .ok()
        .into_iter()
        .flat_map(|value| {
            value
                .split(|ch| matches!(ch, ',' | ';' | '\n' | '\r'))
                .filter_map(normalize_endpoint_base)
                .collect::<Vec<_>>()
        })
        .collect()
}

fn merged_endpoint_candidates(env_name: &str, defaults: &[&str]) -> Vec<String> {
    let mut candidates = env_endpoint_candidates(env_name);
    for default in defaults {
        if let Some(normalized) = normalize_endpoint_base(default) {
            if !candidates
                .iter()
                .any(|item| item.eq_ignore_ascii_case(&normalized))
            {
                candidates.push(normalized);
            }
        }
    }
    candidates
}

fn build_endpoint_url(base: &str, relative: &str) -> String {
    format!(
        "{}/{}",
        base.trim_end_matches('/'),
        relative.trim_start_matches('/')
    )
}

pub fn zotero_api_url_candidates(relative: &str) -> Vec<String> {
    merged_endpoint_candidates(ZOTERO_API_BASES_ENV, &DEFAULT_ZOTERO_API_BASES)
        .into_iter()
        .map(|base| build_endpoint_url(&base, relative))
        .collect()
}

pub fn arxiv_api_query_candidates(arxiv_id: &str) -> Vec<String> {
    let encoded = urlencoding::encode(arxiv_id.trim());
    merged_endpoint_candidates(ARXIV_API_BASES_ENV, &DEFAULT_ARXIV_API_BASES)
        .into_iter()
        .map(|base| build_endpoint_url(&base, &format!("api/query?id_list={encoded}")))
        .collect()
}

pub fn arxiv_pdf_url_candidates(arxiv_id: &str) -> Vec<String> {
    let normalized = arxiv_id.trim();
    merged_endpoint_candidates(ARXIV_PDF_BASES_ENV, &DEFAULT_ARXIV_PDF_BASES)
        .into_iter()
        .map(|base| build_endpoint_url(&base, &format!("pdf/{normalized}.pdf")))
        .collect()
}

pub fn looks_like_arxiv_atom_feed(body: &str) -> bool {
    let trimmed = body.trim();
    if trimmed.is_empty() {
        return false;
    }
    let lower = trimmed.to_ascii_lowercase();
    lower.contains("<feed") && (lower.contains("<entry>") || lower.contains("<opensearch:totalresults>"))
}

#[cfg(test)]
mod library_remote_endpoints_tests {
    use super::*;

    #[test]
    fn arxiv_candidates_keep_official_fallbacks() {
        let candidates = arxiv_api_query_candidates("2401.12345");
        assert!(candidates.iter().any(|item| item.contains("export.arxiv.org/api/query")));
        assert!(candidates.iter().any(|item| item.contains("arxiv.org/api/query")));
    }

    #[test]
    fn zotero_candidates_default_to_official_api() {
        let candidates = zotero_api_url_candidates("users/1/items/ABC?format=bibtex");
        assert_eq!(
            candidates.first().map(String::as_str),
            Some("https://api.zotero.org/users/1/items/ABC?format=bibtex")
        );
    }

    #[test]
    fn arxiv_feed_validation_rejects_html_error_pages() {
        assert!(looks_like_arxiv_atom_feed(
            r#"<?xml version="1.0"?><feed><entry><id>x</id></entry></feed>"#
        ));
        assert!(!looks_like_arxiv_atom_feed("<html><body>blocked</body></html>"));
    }
}
