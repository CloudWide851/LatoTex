use super::ReferenceEvidence;
use crate::outbound_http::{build_blocking_client, classify_transport_failure, OutboundProxyMode};
use regex::Regex;
use reqwest::blocking::Response;
use serde_json::Value;
use std::io::Read;
use std::time::Duration;
use urlencoding::decode;

const MAX_PROVIDER_BODY_BYTES: u64 = 2 * 1024 * 1024;

#[derive(Debug, Clone)]
pub(super) struct ProviderError {
    pub code: String,
    pub retryable: bool,
}

fn provider_error(provider: &str, suffix: &str, retryable: bool) -> ProviderError {
    ProviderError {
        code: format!("academic.{provider}.{suffix}"),
        retryable,
    }
}

fn bounded_body(provider: &str, response: Response) -> Result<Vec<u8>, ProviderError> {
    if response
        .content_length()
        .is_some_and(|size| size > MAX_PROVIDER_BODY_BYTES)
    {
        return Err(provider_error(provider, "response_too_large", false));
    }
    let mut bytes = Vec::new();
    response
        .take(MAX_PROVIDER_BODY_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|_| provider_error(provider, "response_read", true))?;
    if bytes.len() as u64 > MAX_PROVIDER_BODY_BYTES {
        return Err(provider_error(provider, "response_too_large", false));
    }
    Ok(bytes)
}

pub(super) fn fetch(
    provider: &str,
    endpoint: &str,
    query: &[(&str, String)],
) -> Result<Vec<u8>, ProviderError> {
    let (client, resolution) = build_blocking_client(
        endpoint,
        &OutboundProxyMode::System,
        Duration::from_secs(10),
    )
    .map_err(|code| {
        provider_error(
            provider,
            if code.contains("proxy") {
                "proxy_resolve"
            } else {
                "client"
            },
            true,
        )
    })?;
    let response = client
        .get(endpoint)
        .query(query)
        .header(
            "Accept",
            "application/json, application/atom+xml, text/html",
        )
        .header("User-Agent", "LatoTex/0.1 (research evidence)")
        .send()
        .map_err(|error| {
            let failure = classify_transport_failure(&error, &resolution.source);
            provider_error(provider, &failure.stage, failure.retryable)
        })?;
    let status = response.status();
    if !status.is_success() {
        return Err(provider_error(
            provider,
            &format!("http_{}", status.as_u16()),
            status.as_u16() == 429 || status.is_server_error(),
        ));
    }
    bounded_body(provider, response)
}

pub(super) fn compact(raw: &str) -> String {
    raw.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn strip_tags(raw: &str) -> String {
    let tags = Regex::new(r"(?s)<[^>]+>").expect("valid tag regex");
    compact(
        &tags
            .replace_all(raw, " ")
            .replace("&amp;", "&")
            .replace("&lt;", "<")
            .replace("&gt;", ">")
            .replace("&quot;", "\"")
            .replace("&#39;", "'"),
    )
}

pub(super) fn normalize_doi(raw: &str) -> Option<String> {
    let value = raw
        .trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("doi:")
        .trim()
        .to_ascii_lowercase();
    (!value.is_empty()).then_some(value)
}

fn first_string(entry: &Value, key: &str) -> Option<String> {
    entry
        .get(key)
        .and_then(Value::as_array)
        .and_then(|values| values.first())
        .and_then(Value::as_str)
        .map(compact)
        .filter(|value| !value.is_empty())
}

pub(super) fn evidence(
    stable_id: String,
    title: String,
    authors: Vec<String>,
    year: Option<i32>,
    venue: Option<String>,
    doi: Option<String>,
    arxiv_id: Option<String>,
    open_access: Option<bool>,
    pdf_url: Option<String>,
    landing_url: String,
    citation_count: Option<u64>,
    abstract_text: Option<String>,
    source: &str,
) -> ReferenceEvidence {
    let abstract_text = abstract_text
        .map(|value| compact(&value))
        .filter(|value| !value.is_empty());
    let snippet = abstract_text
        .clone()
        .or_else(|| venue.clone())
        .unwrap_or_default();
    let (retraction_status, correction_status) =
        super::analysis_publication_status::publication_status_from_title(&title);
    ReferenceEvidence {
        stable_id,
        title,
        authors,
        year,
        venue,
        doi,
        arxiv_id,
        open_access,
        pdf_url,
        landing_url: landing_url.clone(),
        citation_count,
        abstract_text: abstract_text.clone(),
        source: source.to_string(),
        evidence_level: if abstract_text.is_some() {
            "abstract"
        } else {
            "metadata"
        }
        .to_string(),
        provenance: vec![source.to_string()],
        original_source_url: landing_url.clone(),
        fulltext_document_hash: None,
        fulltext_anchors: Vec::new(),
        retraction_status,
        correction_status,
        rrf_score: 0.0,
        url: landing_url,
        snippet,
    }
}

fn openalex_abstract(value: &Value) -> Option<String> {
    let object = value.as_object()?;
    let mut words = Vec::<(usize, String)>::new();
    for (word, positions) in object {
        for position in positions.as_array().into_iter().flatten() {
            if let Some(position) = position.as_u64() {
                words.push((position as usize, word.clone()));
            }
        }
    }
    words.sort_by_key(|(position, _)| *position);
    let text = words
        .into_iter()
        .map(|(_, word)| word)
        .collect::<Vec<_>>()
        .join(" ");
    (!text.is_empty()).then_some(text)
}

pub(super) fn search_openalex(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "openalex",
        "https://api.openalex.org/works",
        &[
            ("search", query.to_string()),
            ("per-page", limit.to_string()),
            ("mailto", "devnull@example.com".to_string()),
        ],
    )?;
    parse_openalex(&bytes, limit)
}

fn parse_openalex(bytes: &[u8], limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload: Value =
        serde_json::from_slice(bytes).map_err(|_| provider_error("openalex", "parse", false))?;
    let entries = payload
        .get("results")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(entries
        .into_iter()
        .take(limit)
        .filter_map(|entry| {
            let title = compact(entry.get("title")?.as_str()?);
            if title.is_empty() {
                return None;
            }
            let doi = entry
                .get("doi")
                .and_then(Value::as_str)
                .and_then(normalize_doi);
            let stable_id = doi
                .as_ref()
                .map(|value| format!("doi:{value}"))
                .or_else(|| entry.get("id").and_then(Value::as_str).map(str::to_string))?;
            let authors = entry
                .get("authorships")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|item| {
                    item.get("author")
                        .and_then(|author| author.get("display_name"))
                        .and_then(Value::as_str)
                        .map(compact)
                })
                .collect::<Vec<_>>();
            let primary = entry.get("primary_location").unwrap_or(&Value::Null);
            let landing = primary
                .get("landing_page_url")
                .and_then(Value::as_str)
                .or_else(|| entry.get("id").and_then(Value::as_str))
                .unwrap_or_default()
                .to_string();
            let mut result = evidence(
                stable_id,
                title,
                authors,
                entry
                    .get("publication_year")
                    .and_then(Value::as_i64)
                    .map(|year| year as i32),
                primary
                    .get("source")
                    .and_then(|source| source.get("display_name"))
                    .and_then(Value::as_str)
                    .map(compact),
                doi,
                None,
                entry
                    .get("open_access")
                    .and_then(|open| open.get("is_oa"))
                    .and_then(Value::as_bool),
                primary
                    .get("pdf_url")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                landing,
                entry.get("cited_by_count").and_then(Value::as_u64),
                entry
                    .get("abstract_inverted_index")
                    .and_then(openalex_abstract),
                "openalex",
            );
            super::analysis_publication_status::apply_openalex_publication_status(
                &entry,
                &mut result,
            );
            Some(result)
        })
        .collect())
}

pub(super) fn search_crossref(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "crossref",
        "https://api.crossref.org/works",
        &[
            ("query.bibliographic", query.to_string()),
            ("rows", limit.to_string()),
            ("sort", "relevance".to_string()),
        ],
    )?;
    parse_crossref(&bytes, limit)
}

fn parse_crossref(bytes: &[u8], limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload: Value =
        serde_json::from_slice(bytes).map_err(|_| provider_error("crossref", "parse", false))?;
    let entries = payload
        .get("message")
        .and_then(|message| message.get("items"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(entries
        .into_iter()
        .take(limit)
        .filter_map(|entry| {
            let title = first_string(&entry, "title")?;
            let doi = entry
                .get("DOI")
                .and_then(Value::as_str)
                .and_then(normalize_doi);
            let landing = entry
                .get("URL")
                .and_then(Value::as_str)
                .map(str::to_string)
                .or_else(|| doi.as_ref().map(|value| format!("https://doi.org/{value}")))?;
            let authors = entry
                .get("author")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|author| {
                    let family = author.get("family").and_then(Value::as_str).unwrap_or("");
                    let given = author.get("given").and_then(Value::as_str).unwrap_or("");
                    let name = compact(&format!("{given} {family}"));
                    (!name.is_empty()).then_some(name)
                })
                .collect::<Vec<_>>();
            let year = entry
                .get("issued")
                .and_then(|issued| issued.get("date-parts"))
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_array)
                .and_then(|parts| parts.first())
                .and_then(Value::as_i64)
                .map(|year| year as i32);
            let pdf_url = entry
                .get("link")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .find(|link| {
                    link.get("content-type")
                        .and_then(Value::as_str)
                        .is_some_and(|kind| kind.eq_ignore_ascii_case("application/pdf"))
                })
                .and_then(|link| link.get("URL"))
                .and_then(Value::as_str)
                .map(str::to_string);
            let mut result = evidence(
                doi.as_ref()
                    .map(|value| format!("doi:{value}"))
                    .unwrap_or_else(|| format!("crossref:{}", title.to_ascii_lowercase())),
                title,
                authors,
                year,
                first_string(&entry, "container-title"),
                doi,
                None,
                pdf_url.as_ref().map(|_| true),
                pdf_url,
                landing,
                entry.get("is-referenced-by-count").and_then(Value::as_u64),
                entry
                    .get("abstract")
                    .and_then(Value::as_str)
                    .map(strip_tags),
                "crossref",
            );
            super::analysis_publication_status::apply_crossref_publication_status(
                &entry,
                &mut result,
            );
            Some(result)
        })
        .collect())
}

fn xml_value(entry: &str, tag: &str) -> Option<String> {
    let expression = Regex::new(&format!(r"(?s)<{tag}[^>]*>(.*?)</{tag}>")).ok()?;
    expression
        .captures(entry)
        .and_then(|capture| capture.get(1))
        .map(|value| strip_tags(value.as_str()))
        .filter(|value| !value.is_empty())
}

pub(super) fn search_arxiv(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "arxiv",
        "https://export.arxiv.org/api/query",
        &[
            ("search_query", format!("all:\"{query}\"")),
            ("start", "0".to_string()),
            ("max_results", limit.to_string()),
        ],
    )?;
    let xml = String::from_utf8(bytes).map_err(|_| provider_error("arxiv", "parse", false))?;
    parse_arxiv(&xml, limit)
}

fn parse_arxiv(xml: &str, limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let entry_re = Regex::new(r"(?s)<entry>(.*?)</entry>").expect("valid arxiv entry regex");
    let entries = entry_re
        .captures_iter(&xml)
        .filter_map(|capture| capture.get(1).map(|value| value.as_str().to_string()))
        .take(limit);
    let author_re =
        Regex::new(r"(?s)<author>.*?<name>(.*?)</name>.*?</author>").expect("valid author regex");
    Ok(entries
        .filter_map(|entry| {
            let title = xml_value(&entry, "title")?;
            let landing = xml_value(&entry, "id")?;
            let arxiv_id = landing
                .rsplit('/')
                .next()
                .map(|value| value.split('v').next().unwrap_or(value).to_string())?;
            let authors = author_re
                .captures_iter(&entry)
                .filter_map(|capture| capture.get(1).map(|value| strip_tags(value.as_str())))
                .collect::<Vec<_>>();
            let pdf_url = Regex::new(r#"<link[^>]+title=['"]pdf['"][^>]+href=['"]([^'"]+)['"]"#)
                .ok()
                .and_then(|expression| expression.captures(&entry))
                .and_then(|capture| capture.get(1))
                .map(|value| value.as_str().to_string())
                .or_else(|| Some(format!("https://arxiv.org/pdf/{arxiv_id}")));
            Some(evidence(
                format!("arxiv:{arxiv_id}"),
                title,
                authors,
                xml_value(&entry, "published")
                    .and_then(|value| value.get(..4)?.parse::<i32>().ok()),
                Some("arXiv".to_string()),
                None,
                Some(arxiv_id),
                Some(true),
                pdf_url,
                landing,
                None,
                xml_value(&entry, "summary"),
                "arxiv",
            ))
        })
        .collect())
}

fn normalize_result_url(raw_href: &str) -> String {
    let href = strip_tags(raw_href);
    if let Some(start) = href.find("uddg=") {
        let encoded = &href[start + 5..];
        let encoded = encoded.split('&').next().unwrap_or(encoded);
        if let Ok(decoded) = decode(encoded) {
            return decoded.into_owned();
        }
    }
    if href.starts_with("//") {
        return format!("https:{href}");
    }
    href
}

pub(super) fn search_duckduckgo(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "duckduckgo",
        "https://duckduckgo.com/html/",
        &[("q", query.to_string())],
    )?;
    let html =
        String::from_utf8(bytes).map_err(|_| provider_error("duckduckgo", "parse", false))?;
    let anchor =
        Regex::new(r#"(?s)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#)
            .expect("valid duckduckgo regex");
    Ok(anchor
        .captures_iter(&html)
        .filter_map(|capture| {
            let title = capture.get(2).map(|value| strip_tags(value.as_str()))?;
            let landing = capture
                .get(1)
                .map(|value| normalize_result_url(value.as_str()))?;
            (!title.is_empty() && !landing.is_empty()).then(|| {
                evidence(
                    format!("web:{}", title.to_ascii_lowercase()),
                    title,
                    Vec::new(),
                    None,
                    None,
                    None,
                    None,
                    None,
                    None,
                    landing,
                    None,
                    None,
                    "duckduckgo",
                )
            })
        })
        .take(limit)
        .collect())
}

pub(super) fn search_wikipedia(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "wikipedia",
        "https://en.wikipedia.org/w/api.php",
        &[
            ("action", "query".to_string()),
            ("list", "search".to_string()),
            ("srsearch", query.to_string()),
            ("utf8", "1".to_string()),
            ("format", "json".to_string()),
            ("srlimit", limit.to_string()),
        ],
    )?;
    let payload: Value =
        serde_json::from_slice(&bytes).map_err(|_| provider_error("wikipedia", "parse", false))?;
    Ok(payload
        .get("query")
        .and_then(|value| value.get("search"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|entry| {
            let title = entry.get("title").and_then(Value::as_str).map(compact)?;
            let landing = format!("https://en.wikipedia.org/wiki/{}", title.replace(' ', "_"));
            let mut item = evidence(
                format!("wiki:{}", title.to_ascii_lowercase()),
                title,
                Vec::new(),
                None,
                Some("Wikipedia".to_string()),
                None,
                None,
                None,
                None,
                landing,
                None,
                entry.get("snippet").and_then(Value::as_str).map(strip_tags),
                "wikipedia",
            );
            item.evidence_level = "metadata".to_string();
            Some(item)
        })
        .collect())
}

#[cfg(test)]
#[path = "analysis_academic_providers_tests.rs"]
mod tests;
