use regex::Regex;
use reqwest::blocking::Client;
use reqwest::Url;
use std::time::Duration;

#[derive(Default)]
struct CitationRemoteMetadata {
    title: Option<String>,
    authors: Vec<String>,
    published_at: Option<String>,
    doi: Option<String>,
    arxiv_id: Option<String>,
    source: Option<String>,
    urls: Vec<String>,
}

fn normalize_whitespace(input: &str) -> String {
    input
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn decode_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
}

fn push_unique_author(authors: &mut Vec<String>, author: String) {
    let normalized = normalize_whitespace(&author);
    if normalized.is_empty() {
        return;
    }
    if authors
        .iter()
        .any(|item| item.eq_ignore_ascii_case(&normalized))
    {
        return;
    }
    authors.push(normalized);
}

fn push_unique_metadata_url(urls: &mut Vec<String>, url: String) {
    if let Some(normalized) = normalize_pdf_like_url(&url, None) {
        push_unique_url(urls, normalized);
        return;
    }
    push_unique_url(urls, url);
}

fn extract_bib_authors(content: &str) -> Vec<String> {
    let mut authors = Vec::new();
    if let Some(author_field) = extract_bib_field_value(content, "author") {
        for item in author_field.split(" and ") {
            push_unique_author(&mut authors, item.to_string());
        }
    }
    authors
}

fn format_date_parts(parts: &[i64]) -> Option<String> {
    if parts.is_empty() {
        return None;
    }
    let year = parts[0];
    if year <= 0 {
        return None;
    }
    if parts.len() >= 3 {
        return Some(format!("{year:04}-{:02}-{:02}", parts[1], parts[2]));
    }
    if parts.len() == 2 {
        return Some(format!("{year:04}-{:02}", parts[1]));
    }
    Some(format!("{year:04}"))
}

fn extract_crossref_date(message: &Value) -> Option<String> {
    let candidates = ["published-print", "published-online", "issued", "created"];
    for key in candidates {
        let Some(date_parts) = message
            .get(key)
            .and_then(|value| value.get("date-parts"))
            .and_then(|value| value.as_array())
            .and_then(|parts| parts.first())
            .and_then(|value| value.as_array())
        else {
            continue;
        };
        let parsed: Vec<i64> = date_parts.iter().filter_map(|item| item.as_i64()).collect();
        if let Some(formatted) = format_date_parts(&parsed) {
            return Some(formatted);
        }
    }
    None
}

fn http_client() -> Option<Client> {
    Client::builder()
        .timeout(Duration::from_secs(8))
        .user_agent("LatoTex/0.1.0")
        .build()
        .ok()
}

fn looks_like_pdf_url(value: &str) -> bool {
    let lower = value.trim().to_lowercase();
    lower.ends_with(".pdf")
        || lower.contains(".pdf?")
        || lower.contains("/pdf/")
        || lower.contains("downloadpdf")
}

fn normalize_pdf_like_url(value: &str, base_url: Option<&str>) -> Option<String> {
    let trimmed = value.trim().trim_end_matches(',').trim();
    if trimmed.is_empty() {
        return None;
    }
    if let Some(normalized) = normalize_url(trimmed) {
        return Some(normalized);
    }
    let base = base_url?;
    let base = Url::parse(base).ok()?;
    base.join(trimmed)
        .ok()
        .map(|resolved| resolved.to_string())
        .filter(|resolved| resolved.starts_with("http://") || resolved.starts_with("https://"))
}

fn extract_crossref_pdf_urls(message: &Value) -> Vec<String> {
    let mut urls = Vec::new();
    let Some(items) = message.get("link").and_then(|value| value.as_array()) else {
        return urls;
    };
    for item in items {
        let url = item
            .get("URL")
            .or_else(|| item.get("url"))
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let content_type = item
            .get("content-type")
            .or_else(|| item.get("content_type"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .to_lowercase();
        if content_type.contains("pdf") || looks_like_pdf_url(url) {
            if let Some(normalized) = normalize_pdf_like_url(url, None) {
                push_unique_url(&mut urls, normalized);
            }
        }
    }
    urls
}

fn fetch_crossref_metadata(doi: &str) -> Option<CitationRemoteMetadata> {
    let client = http_client()?;
    let encoded = urlencoding::encode(doi);
    let response = client
        .get(format!("https://api.crossref.org/works/{encoded}"))
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let payload: Value = response.json().ok()?;
    let message = payload.get("message")?;
    let mut metadata = CitationRemoteMetadata {
        source: Some("crossref".to_string()),
        ..CitationRemoteMetadata::default()
    };

    metadata.title = message
        .get("title")
        .and_then(|value| value.as_array())
        .and_then(|items| items.first())
        .and_then(|value| value.as_str())
        .map(normalize_whitespace)
        .filter(|value| !value.is_empty());
    metadata.published_at = extract_crossref_date(message);
    metadata.doi = message
        .get("DOI")
        .and_then(|value| value.as_str())
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());

    if let Some(url) = message
        .get("URL")
        .and_then(|value| value.as_str())
        .and_then(normalize_url)
    {
        push_unique_url(&mut metadata.urls, url);
    }
    for pdf_url in extract_crossref_pdf_urls(message) {
        push_unique_url(&mut metadata.urls, pdf_url);
    }

    if let Some(author_items) = message.get("author").and_then(|value| value.as_array()) {
        for author in author_items {
            let given = author.get("given").and_then(|value| value.as_str()).unwrap_or("");
            let family = author.get("family").and_then(|value| value.as_str()).unwrap_or("");
            let merged = normalize_whitespace(&format!("{given} {family}"));
            if !merged.is_empty() {
                push_unique_author(&mut metadata.authors, merged);
            }
        }
    }

    Some(metadata)
}

fn extract_xml_tag_value(block: &str, tag: &str) -> Option<String> {
    let pattern = format!(r"(?is)<{tag}[^>]*>(.*?)</{tag}>");
    let regex = Regex::new(&pattern).ok()?;
    let capture = regex.captures(block)?;
    let raw = capture.get(1)?.as_str();
    let normalized = normalize_whitespace(&decode_entities(raw));
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn fetch_arxiv_metadata(arxiv_id: &str) -> Option<CitationRemoteMetadata> {
    let client = http_client()?;
    let response = client
        .get(format!(
            "https://export.arxiv.org/api/query?id_list={}",
            urlencoding::encode(arxiv_id)
        ))
        .send()
        .ok()?;
    if !response.status().is_success() {
        return None;
    }
    let body = response.text().ok()?;
    let entry_regex = Regex::new(r"(?is)<entry>(.*?)</entry>").ok()?;
    let entry = entry_regex
        .captures(&body)
        .and_then(|capture| capture.get(1))
        .map(|value| value.as_str())?;

    let mut metadata = CitationRemoteMetadata {
        source: Some("arxiv".to_string()),
        arxiv_id: Some(arxiv_id.to_string()),
        ..CitationRemoteMetadata::default()
    };

    metadata.title = extract_xml_tag_value(entry, "title");
    metadata.published_at = extract_xml_tag_value(entry, "published")
        .map(|value| value.chars().take(10).collect::<String>())
        .filter(|value| !value.is_empty());
    metadata.doi = extract_xml_tag_value(entry, "arxiv:doi").and_then(|value| normalize_doi(&value));

    if let Some(url) = extract_xml_tag_value(entry, "id").and_then(|value| normalize_url(&value)) {
        push_unique_url(&mut metadata.urls, url);
    }
    push_unique_url(
        &mut metadata.urls,
        format!("https://arxiv.org/pdf/{arxiv_id}.pdf"),
    );

    let author_regex = Regex::new(r"(?is)<author>\s*<name>(.*?)</name>\s*</author>").ok()?;
    for capture in author_regex.captures_iter(entry) {
        if let Some(raw) = capture.get(1) {
            push_unique_author(&mut metadata.authors, decode_entities(raw.as_str()));
        }
    }

    Some(metadata)
}

fn extract_meta_content_single(html: &str, key: &str) -> Option<String> {
    let escaped = regex::escape(key);
    let first_pattern = format!(
        r#"(?is)<meta[^>]+(?:name|property)\s*=\s*["']{escaped}["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>"#
    );
    let second_pattern = format!(
        r#"(?is)<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:name|property)\s*=\s*["']{escaped}["'][^>]*>"#
    );
    for pattern in [first_pattern, second_pattern] {
        let Some(regex) = Regex::new(&pattern).ok() else {
            continue;
        };
        if let Some(capture) = regex.captures(html) {
            if let Some(value) = capture.get(1) {
                let normalized = normalize_whitespace(&decode_entities(value.as_str()));
                if !normalized.is_empty() {
                    return Some(normalized);
                }
            }
        }
    }
    None
}

fn extract_meta_content_multi(html: &str, key: &str) -> Vec<String> {
    let escaped = regex::escape(key);
    let first_pattern = format!(
        r#"(?is)<meta[^>]+(?:name|property)\s*=\s*["']{escaped}["'][^>]*content\s*=\s*["']([^"']+)["'][^>]*>"#
    );
    let second_pattern = format!(
        r#"(?is)<meta[^>]+content\s*=\s*["']([^"']+)["'][^>]*(?:name|property)\s*=\s*["']{escaped}["'][^>]*>"#
    );
    let mut result = Vec::new();
    for pattern in [first_pattern, second_pattern] {
        let Some(regex) = Regex::new(&pattern).ok() else {
            continue;
        };
        for capture in regex.captures_iter(html) {
            if let Some(value) = capture.get(1) {
                let normalized = normalize_whitespace(&decode_entities(value.as_str()));
                if !normalized.is_empty()
                    && !result.iter().any(|item: &String| item.eq_ignore_ascii_case(&normalized))
                {
                    result.push(normalized);
                }
            }
        }
    }
    result
}

fn extract_html_title(html: &str) -> Option<String> {
    let regex = Regex::new(r"(?is)<title[^>]*>(.*?)</title>").ok()?;
    let capture = regex.captures(html)?;
    let raw = capture.get(1)?.as_str();
    let normalized = normalize_whitespace(&decode_entities(raw));
    if normalized.is_empty() {
        None
    } else {
        Some(normalized)
    }
}

fn extract_pdf_links_from_html(html: &str, page_url: &str) -> Vec<String> {
    let mut urls = Vec::new();
    for key in ["citation_pdf_url", "pdf_url", "og:pdf"] {
        if let Some(value) = extract_meta_content_single(html, key)
            .and_then(|item| normalize_pdf_like_url(&item, Some(page_url)))
        {
            push_unique_url(&mut urls, value);
        }
    }

    let href_regex = Regex::new(
        r#"(?is)<a[^>]+href\s*=\s*["']([^"']+)["'][^>]*>(.*?)</a>"#,
    )
    .ok();
    if let Some(regex) = href_regex {
        for capture in regex.captures_iter(html) {
            let href = capture.get(1).map(|value| value.as_str()).unwrap_or_default();
            let body = capture.get(2).map(|value| value.as_str()).unwrap_or_default();
            let body_text = normalize_whitespace(&decode_entities(body)).to_lowercase();
            let href_lower = href.trim().to_lowercase();
            if href_lower.contains("type=printable") {
                continue;
            }
            let likely_pdf = looks_like_pdf_url(href)
                || body_text.contains("pdf")
                || body_text.contains("download");
            if !likely_pdf {
                continue;
            }
            if let Some(normalized) = normalize_pdf_like_url(href, Some(page_url)) {
                let lower = normalized.to_lowercase();
                if lower.ends_with(".pdf")
                    || lower.contains(".pdf?")
                    || lower.contains("/pdf/")
                {
                    push_unique_url(&mut urls, normalized);
                }
            }
        }
    }
    urls
}

fn merge_remote_metadata(
    target: &mut CitationRemoteMetadata,
    source: CitationRemoteMetadata,
) {
    if target.title.is_none() {
        target.title = source.title;
    }
    for author in source.authors {
        push_unique_author(&mut target.authors, author);
    }
    if target.published_at.is_none() {
        target.published_at = source.published_at;
    }
    if target.doi.is_none() {
        target.doi = source.doi;
    }
    if target.arxiv_id.is_none() {
        target.arxiv_id = source.arxiv_id;
    }
    if target.source.is_none() {
        target.source = source.source;
    }
    for url in source.urls {
        push_unique_metadata_url(&mut target.urls, url);
    }
}

fn fetch_url_metadata(url: &str) -> Option<CitationRemoteMetadata> {
    let client = http_client()?;
    let response = client.get(url).send().ok()?;
    if !response.status().is_success() {
        return None;
    }
    let html = response.text().ok()?;
    let mut metadata = CitationRemoteMetadata {
        source: Some("meta".to_string()),
        ..CitationRemoteMetadata::default()
    };

    metadata.title = extract_meta_content_single(&html, "citation_title")
        .or_else(|| extract_meta_content_single(&html, "og:title"))
        .or_else(|| extract_html_title(&html));
    metadata.published_at = extract_meta_content_single(&html, "citation_publication_date")
        .or_else(|| extract_meta_content_single(&html, "article:published_time"))
        .or_else(|| extract_meta_content_single(&html, "dc.date"))
        .or_else(|| extract_meta_content_single(&html, "date"));
    metadata.doi = extract_meta_content_single(&html, "citation_doi").and_then(|value| normalize_doi(&value));

    for author in extract_meta_content_multi(&html, "citation_author") {
        push_unique_author(&mut metadata.authors, author);
    }
    if metadata.authors.is_empty() {
        for author in extract_meta_content_multi(&html, "author") {
            push_unique_author(&mut metadata.authors, author);
        }
    }

    if let Some(canonical) = extract_meta_content_single(&html, "og:url").and_then(|value| normalize_url(&value))
    {
        push_unique_url(&mut metadata.urls, canonical);
    }
    push_unique_url(&mut metadata.urls, url.to_string());
    for pdf_url in extract_pdf_links_from_html(&html, url) {
        push_unique_url(&mut metadata.urls, pdf_url);
    }
    metadata.arxiv_id = extract_arxiv_id(url);

    Some(metadata)
}

fn fetch_remote_metadata(
    doi: Option<&str>,
    arxiv_id: Option<&str>,
    urls: &[String],
) -> Option<CitationRemoteMetadata> {
    let mut merged: Option<CitationRemoteMetadata> = None;
    if let Some(doi_value) = doi {
        if let Some(result) = fetch_crossref_metadata(doi_value) {
            merged = Some(result);
        }
    }
    if let Some(arxiv_value) = arxiv_id {
        if let Some(result) = fetch_arxiv_metadata(arxiv_value) {
            if let Some(current) = merged.as_mut() {
                merge_remote_metadata(current, result);
            } else {
                merged = Some(result);
            }
        }
    }
    let mut candidate_urls = urls.to_vec();
    if let Some(current) = merged.as_ref() {
        for url in &current.urls {
            if !candidate_urls
                .iter()
                .any(|item| item.eq_ignore_ascii_case(url))
            {
                candidate_urls.push(url.clone());
            }
        }
    }
    for url in urls {
        if let Some(doi_from_url) = normalize_doi(url) {
            if let Some(result) = fetch_crossref_metadata(&doi_from_url) {
                if let Some(current) = merged.as_mut() {
                    merge_remote_metadata(current, result);
                } else {
                    merged = Some(result);
                }
            }
        }
        if let Some(arxiv_from_url) = extract_arxiv_id(url) {
            if let Some(result) = fetch_arxiv_metadata(&arxiv_from_url) {
                if let Some(current) = merged.as_mut() {
                    merge_remote_metadata(current, result);
                } else {
                    merged = Some(result);
                }
            }
        }
    }
    for url in candidate_urls {
        if let Some(result) = fetch_url_metadata(&url) {
            if let Some(current) = merged.as_mut() {
                merge_remote_metadata(current, result);
            } else {
                merged = Some(result);
            }
        }
    }
    merged
}

#[cfg(test)]
#[path = "remote_metadata_fetch_tests.rs"]
mod remote_metadata_fetch_tests;
