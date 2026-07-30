use super::analysis_academic_providers::{compact, evidence, fetch, normalize_doi, ProviderError};
use super::ReferenceEvidence;
use serde_json::Value;
use urlencoding::encode;

fn parse_json(provider: &str, bytes: &[u8]) -> Result<Value, ProviderError> {
    serde_json::from_slice(bytes).map_err(|_| ProviderError {
        code: format!("academic.{provider}.parse"),
        retryable: false,
    })
}

fn provider_error(provider: &str, suffix: &str, retryable: bool) -> ProviderError {
    ProviderError {
        code: format!("academic.{provider}.{suffix}"),
        retryable,
    }
}

pub(super) fn search_semantic_scholar(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "semantic_scholar",
        "https://api.semanticscholar.org/graph/v1/paper/search",
        &[
            ("query", query.to_string()),
            ("limit", limit.to_string()),
            (
                "fields",
                "paperId,title,authors,year,venue,externalIds,openAccessPdf,citationCount,abstract,url"
                    .to_string(),
            ),
        ],
    )?;
    parse_semantic_scholar(&bytes, limit)
}

fn parse_semantic_scholar(
    bytes: &[u8],
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload = parse_json("semantic_scholar", bytes)?;
    Ok(payload
        .get("data")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|entry| {
            let title = entry.get("title").and_then(Value::as_str).map(compact)?;
            if title.is_empty() {
                return None;
            }
            let external_ids = entry.get("externalIds").unwrap_or(&Value::Null);
            let doi = external_ids
                .get("DOI")
                .and_then(Value::as_str)
                .and_then(normalize_doi);
            let arxiv_id = external_ids
                .get("ArXiv")
                .and_then(Value::as_str)
                .map(str::to_string);
            let paper_id = entry.get("paperId").and_then(Value::as_str)?;
            let landing = entry
                .get("url")
                .and_then(Value::as_str)
                .map(str::to_string)
                .unwrap_or_else(|| format!("https://www.semanticscholar.org/paper/{paper_id}"));
            let pdf_url = entry
                .get("openAccessPdf")
                .and_then(|value| value.get("url"))
                .and_then(Value::as_str)
                .map(str::to_string);
            Some(evidence(
                doi.as_ref()
                    .map(|value| format!("doi:{value}"))
                    .or_else(|| arxiv_id.as_ref().map(|value| format!("arxiv:{value}")))
                    .unwrap_or_else(|| format!("semantic_scholar:{paper_id}")),
                title,
                entry
                    .get("authors")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|author| author.get("name").and_then(Value::as_str).map(compact))
                    .collect(),
                entry
                    .get("year")
                    .and_then(Value::as_i64)
                    .map(|year| year as i32),
                entry.get("venue").and_then(Value::as_str).map(compact),
                doi,
                arxiv_id,
                pdf_url.as_ref().map(|_| true),
                pdf_url,
                landing,
                entry.get("citationCount").and_then(Value::as_u64),
                entry
                    .get("abstract")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                "semantic_scholar",
            ))
        })
        .collect())
}

pub(super) fn search_europe_pmc(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "europe_pmc",
        "https://www.ebi.ac.uk/europepmc/webservices/rest/search",
        &[
            ("query", query.to_string()),
            ("format", "json".to_string()),
            ("pageSize", limit.to_string()),
            ("resultType", "core".to_string()),
        ],
    )?;
    parse_europe_pmc(&bytes, limit)
}

fn europe_pmc_pdf(entry: &Value) -> Option<String> {
    entry
        .get("fullTextUrlList")
        .and_then(|value| value.get("fullTextUrl"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .find(|item| {
            item.get("documentStyle")
                .and_then(Value::as_str)
                .is_some_and(|value| value.eq_ignore_ascii_case("pdf"))
        })
        .and_then(|item| item.get("url"))
        .and_then(Value::as_str)
        .map(str::to_string)
}

fn parse_europe_pmc(bytes: &[u8], limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload = parse_json("europe_pmc", bytes)?;
    Ok(payload
        .get("resultList")
        .and_then(|value| value.get("result"))
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|entry| {
            let title = entry.get("title").and_then(Value::as_str).map(compact)?;
            if title.is_empty() {
                return None;
            }
            let doi = entry
                .get("doi")
                .and_then(Value::as_str)
                .and_then(normalize_doi);
            let source = entry.get("source").and_then(Value::as_str).unwrap_or("MED");
            let id = entry.get("id").and_then(Value::as_str)?;
            let landing = format!("https://europepmc.org/article/{source}/{id}");
            let pdf_url = europe_pmc_pdf(entry);
            Some(evidence(
                doi.as_ref()
                    .map(|value| format!("doi:{value}"))
                    .unwrap_or_else(|| format!("europe_pmc:{source}:{id}")),
                title,
                entry
                    .get("authorString")
                    .and_then(Value::as_str)
                    .map(|authors| {
                        authors
                            .split(',')
                            .map(compact)
                            .filter(|value| !value.is_empty())
                            .collect()
                    })
                    .unwrap_or_default(),
                entry
                    .get("pubYear")
                    .and_then(Value::as_str)
                    .and_then(|year| year.parse::<i32>().ok()),
                entry
                    .get("journalTitle")
                    .and_then(Value::as_str)
                    .map(compact),
                doi,
                None,
                entry
                    .get("isOpenAccess")
                    .and_then(Value::as_str)
                    .map(|value| value.eq_ignore_ascii_case("Y"))
                    .or_else(|| pdf_url.as_ref().map(|_| true)),
                pdf_url,
                landing,
                entry
                    .get("citedByCount")
                    .and_then(Value::as_u64)
                    .or_else(|| {
                        entry
                            .get("citedByCount")
                            .and_then(Value::as_str)
                            .and_then(|value| value.parse().ok())
                    }),
                entry
                    .get("abstractText")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                "europe_pmc",
            ))
        })
        .collect())
}

fn valid_contact_email(raw: &str) -> bool {
    let value = raw.trim();
    let mut parts = value.split('@');
    let (Some(local), Some(domain), None) = (parts.next(), parts.next(), parts.next()) else {
        return false;
    };
    !local.is_empty()
        && domain.contains('.')
        && !value.contains(char::is_whitespace)
        && value.chars().count() <= 254
}

fn query_doi(query: &str) -> Option<String> {
    query.split_whitespace().find_map(|part| {
        normalize_doi(part).filter(|value| value.starts_with("10.") && value.contains('/'))
    })
}

pub(super) fn unpaywall_enabled(query: &str, contact_email: Option<&str>) -> bool {
    contact_email.is_some_and(valid_contact_email) && query_doi(query).is_some()
}

pub(super) fn search_unpaywall(
    query: &str,
    contact_email: &str,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    if !valid_contact_email(contact_email) {
        return Err(provider_error("unpaywall", "contact_email_invalid", false));
    }
    let doi = query_doi(query).ok_or_else(|| provider_error("unpaywall", "doi_missing", false))?;
    let endpoint = format!("https://api.unpaywall.org/v2/{}", encode(&doi));
    let bytes = fetch(
        "unpaywall",
        &endpoint,
        &[("email", contact_email.trim().to_string())],
    )?;
    parse_unpaywall(&bytes)
}

fn parse_unpaywall(bytes: &[u8]) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let entry = parse_json("unpaywall", bytes)?;
    let title = entry
        .get("title")
        .and_then(Value::as_str)
        .map(compact)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| provider_error("unpaywall", "missing_title", false))?;
    let doi = entry
        .get("doi")
        .and_then(Value::as_str)
        .and_then(normalize_doi)
        .ok_or_else(|| provider_error("unpaywall", "doi_missing", false))?;
    let best = entry.get("best_oa_location").unwrap_or(&Value::Null);
    let landing = entry
        .get("doi_url")
        .and_then(Value::as_str)
        .or_else(|| best.get("url").and_then(Value::as_str))
        .unwrap_or("https://doi.org")
        .to_string();
    let authors = entry
        .get("z_authors")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(|author| {
            let given = author.get("given").and_then(Value::as_str).unwrap_or("");
            let family = author.get("family").and_then(Value::as_str).unwrap_or("");
            let name = compact(&format!("{given} {family}"));
            (!name.is_empty()).then_some(name)
        })
        .collect();
    Ok(vec![evidence(
        format!("doi:{doi}"),
        title,
        authors,
        entry
            .get("year")
            .and_then(Value::as_i64)
            .map(|year| year as i32),
        entry
            .get("journal_name")
            .and_then(Value::as_str)
            .map(compact),
        Some(doi),
        None,
        entry.get("is_oa").and_then(Value::as_bool),
        best.get("url_for_pdf")
            .and_then(Value::as_str)
            .map(str::to_string),
        landing,
        None,
        None,
        "unpaywall",
    )])
}

#[cfg(test)]
mod tests {
    use super::{parse_europe_pmc, parse_semantic_scholar, parse_unpaywall, unpaywall_enabled};

    #[test]
    fn parses_semantic_scholar_fixture() {
        let payload = br#"{"data":[{"paperId":"p1","title":"Evidence title","year":2025,"venue":"Venue","externalIds":{"DOI":"10.1000/TEST"},"authors":[{"name":"A. Researcher"}],"openAccessPdf":{"url":"https://example.test/a.pdf"},"citationCount":7,"abstract":"Supported abstract","url":"https://example.test/p1"}]}"#;
        let items = parse_semantic_scholar(payload, 5).unwrap();
        assert_eq!(items[0].stable_id, "doi:10.1000/test");
        assert_eq!(items[0].evidence_level, "abstract");
        assert_eq!(items[0].citation_count, Some(7));
    }

    #[test]
    fn parses_europe_pmc_fixture() {
        let payload = br#"{"resultList":{"result":[{"id":"123","source":"MED","title":"Biomedical evidence","authorString":"One A, Two B","pubYear":"2024","journalTitle":"Journal","doi":"10.2000/PMC","isOpenAccess":"Y","abstractText":"Observed result","citedByCount":4,"fullTextUrlList":{"fullTextUrl":[{"documentStyle":"pdf","url":"https://example.test/pmc.pdf"}]}}]}}"#;
        let items = parse_europe_pmc(payload, 3).unwrap();
        assert_eq!(items[0].doi.as_deref(), Some("10.2000/pmc"));
        assert_eq!(items[0].authors.len(), 2);
        assert_eq!(items[0].open_access, Some(true));
    }

    #[test]
    fn unpaywall_requires_email_and_doi_and_parses_fixture() {
        assert!(unpaywall_enabled(
            "10.3000/OPEN",
            Some("researcher@example.org")
        ));
        assert!(!unpaywall_enabled(
            "topic search",
            Some("researcher@example.org")
        ));
        assert!(!unpaywall_enabled("10.3000/OPEN", Some("invalid")));
        assert!(!unpaywall_enabled(
            "10.3000/OPEN",
            Some("researcher@@example.org")
        ));
        let payload = br#"{"doi":"10.3000/OPEN","title":"Open paper","year":2023,"journal_name":"OA Journal","is_oa":true,"doi_url":"https://doi.org/10.3000/open","z_authors":[{"given":"Open","family":"Author"}],"best_oa_location":{"url":"https://example.test/open","url_for_pdf":"https://example.test/open.pdf"}}"#;
        let items = parse_unpaywall(payload).unwrap();
        assert_eq!(items[0].stable_id, "doi:10.3000/open");
        assert_eq!(
            items[0].pdf_url.as_deref(),
            Some("https://example.test/open.pdf")
        );
    }
}
