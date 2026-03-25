use super::{ReferenceCheckItem, ReferenceCheckResponse, ReferenceEvidence};
use regex::Regex;
use reqwest::blocking::Client;
use serde_json::Value;
use std::collections::HashSet;
use std::time::Duration;
use urlencoding::decode;

fn decode_html_entities(input: &str) -> String {
    input
        .replace("&amp;", "&")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
}

fn normalize_result_url(raw_href: &str) -> String {
    let href = decode_html_entities(raw_href);
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

fn parse_duckduckgo_results(html: &str, limit: usize) -> Vec<ReferenceEvidence> {
    let anchor_re =
        Regex::new(r#"(?s)<a[^>]*class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>(.*?)</a>"#)
            .expect("valid regex");
    let strip_tag_re = Regex::new(r"(?s)<[^>]+>").expect("valid regex");
    let mut items = Vec::new();

    for capture in anchor_re.captures_iter(html) {
        if items.len() >= limit {
            break;
        }
        let href = capture.get(1).map(|m| m.as_str()).unwrap_or_default();
        let raw_title = capture.get(2).map(|m| m.as_str()).unwrap_or_default();
        let title = decode_html_entities(strip_tag_re.replace_all(raw_title, "").trim());
        if title.is_empty() {
            continue;
        }
        let url = normalize_result_url(href);
        if url.is_empty() {
            continue;
        }
        items.push(ReferenceEvidence {
            title,
            url,
            snippet: String::new(),
        });
    }

    items
}

fn parse_wikipedia_results(json: &Value, limit: usize) -> Vec<ReferenceEvidence> {
    let mut items = Vec::new();
    let Some(search) = json
        .get("query")
        .and_then(|value| value.get("search"))
        .and_then(|value| value.as_array())
    else {
        return items;
    };
    for entry in search {
        if items.len() >= limit {
            break;
        }
        let title = entry
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if title.is_empty() {
            continue;
        }
        let snippet = entry
            .get("snippet")
            .and_then(|value| value.as_str())
            .map(decode_html_entities)
            .unwrap_or_default();
        let encoded_title = title.replace(' ', "_");
        let url = format!("https://en.wikipedia.org/wiki/{encoded_title}");
        items.push(ReferenceEvidence {
            title,
            url,
            snippet,
        });
    }
    items
}

fn parse_crossref_results(json: &Value, limit: usize) -> Vec<ReferenceEvidence> {
    let mut items = Vec::new();
    let Some(entries) = json
        .get("message")
        .and_then(|value| value.get("items"))
        .and_then(|value| value.as_array())
    else {
        return items;
    };
    for entry in entries {
        if items.len() >= limit {
            break;
        }
        let title = entry
            .get("title")
            .and_then(|value| value.as_array())
            .and_then(|arr| arr.first())
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let url = entry
            .get("URL")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        if title.is_empty() || url.is_empty() {
            continue;
        }
        let snippet = entry
            .get("container-title")
            .and_then(|value| value.as_array())
            .and_then(|arr| arr.first())
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        items.push(ReferenceEvidence {
            title,
            url,
            snippet,
        });
    }
    items
}

fn search_with_duckduckgo(
    client: &Client,
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, String> {
    let search_url = format!(
        "https://duckduckgo.com/html/?q={}",
        urlencoding::encode(query)
    );
    let response = client
        .get(search_url)
        .header("User-Agent", "LatoTex/0.1")
        .send()
        .map_err(|e| format!("duckduckgo request failed: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("duckduckgo body read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("duckduckgo status {status}"));
    }
    Ok(parse_duckduckgo_results(&body, limit))
}

fn search_with_wikipedia(
    client: &Client,
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, String> {
    let response = client
        .get("https://en.wikipedia.org/w/api.php")
        .query(&[
            ("action", "query"),
            ("list", "search"),
            ("srsearch", query),
            ("utf8", "1"),
            ("format", "json"),
            ("srlimit", &limit.to_string()),
        ])
        .header("User-Agent", "LatoTex/0.1")
        .send()
        .map_err(|e| format!("wikipedia request failed: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("wikipedia body read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("wikipedia status {status}"));
    }
    let parsed =
        serde_json::from_str::<Value>(&body).map_err(|e| format!("wikipedia parse failed: {e}"))?;
    Ok(parse_wikipedia_results(&parsed, limit))
}

fn search_with_crossref(
    client: &Client,
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, String> {
    let response = client
        .get("https://api.crossref.org/works")
        .query(&[
            ("query.bibliographic", query),
            ("rows", &limit.to_string()),
            ("sort", "relevance"),
            ("order", "desc"),
        ])
        .header("User-Agent", "LatoTex/0.1 (mailto:devnull@example.com)")
        .send()
        .map_err(|e| format!("crossref request failed: {e}"))?;
    let status = response.status();
    let body = response
        .text()
        .map_err(|e| format!("crossref body read failed: {e}"))?;
    if !status.is_success() {
        return Err(format!("crossref status {status}"));
    }
    let parsed =
        serde_json::from_str::<Value>(&body).map_err(|e| format!("crossref parse failed: {e}"))?;
    Ok(parse_crossref_results(&parsed, limit))
}

fn dedupe_evidence(items: Vec<ReferenceEvidence>, limit: usize) -> Vec<ReferenceEvidence> {
    let mut seen = HashSet::<String>::new();
    let mut out = Vec::new();
    for item in items {
        if out.len() >= limit {
            break;
        }
        let key = format!(
            "{}|{}",
            item.url.trim().to_ascii_lowercase(),
            item.title.trim().to_ascii_lowercase()
        );
        if key.trim() == "|" || !seen.insert(key) {
            continue;
        }
        out.push(item);
    }
    out
}

pub(crate) fn run_reference_check_queries(
    queries: Vec<String>,
    limit: u32,
) -> Result<ReferenceCheckResponse, String> {
    let limit = limit.clamp(1, 8) as usize;
    let queries: Vec<String> = queries
        .into_iter()
        .map(|query| query.trim().to_string())
        .filter(|query| !query.is_empty())
        .take(16)
        .collect();
    if queries.is_empty() {
        return Err("No reference query provided".to_string());
    }

    let client = Client::builder()
        .timeout(Duration::from_secs(12))
        .build()
        .map_err(|e| e.to_string())?;
    let mut items = Vec::new();
    for query in queries {
        let mut aggregated = Vec::<ReferenceEvidence>::new();
        let mut source_ok = Vec::<&str>::new();
        let mut source_errors = Vec::<String>::new();

        match search_with_duckduckgo(&client, &query, limit) {
            Ok(results) => {
                if !results.is_empty() {
                    source_ok.push("duckduckgo");
                    aggregated.extend(results);
                }
            }
            Err(error) => source_errors.push(error),
        }

        match search_with_wikipedia(&client, &query, limit) {
            Ok(results) => {
                if !results.is_empty() {
                    source_ok.push("wikipedia");
                    aggregated.extend(results);
                }
            }
            Err(error) => source_errors.push(error),
        }

        match search_with_crossref(&client, &query, limit) {
            Ok(results) => {
                if !results.is_empty() {
                    source_ok.push("crossref");
                    aggregated.extend(results);
                }
            }
            Err(error) => source_errors.push(error),
        }

        let results = dedupe_evidence(aggregated, limit);
        if results.is_empty() {
            let message = if source_errors.is_empty() {
                "No search evidence found".to_string()
            } else {
                format!("No search evidence found; {}", source_errors.join(" | "))
            };
            items.push(ReferenceCheckItem {
                query,
                ok: false,
                message,
                results,
            });
            continue;
        }
        let source_info = if source_ok.is_empty() {
            "unknown".to_string()
        } else {
            source_ok.join(", ")
        };
        items.push(ReferenceCheckItem {
            query,
            ok: true,
            message: format!("Search evidence collected via {source_info}"),
            results,
        });
    }

    Ok(ReferenceCheckResponse { items })
}
