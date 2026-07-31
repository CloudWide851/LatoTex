use super::analysis_academic_providers::{compact, evidence, fetch, normalize_doi, ProviderError};
use super::ReferenceEvidence;
use serde_json::Value;
use urlencoding::encode;

fn provider_error(provider: &str, suffix: &str, retryable: bool) -> ProviderError {
    ProviderError {
        code: format!("academic.{provider}.{suffix}"),
        retryable,
    }
}

fn parse_json(provider: &str, bytes: &[u8]) -> Result<Value, ProviderError> {
    serde_json::from_slice(bytes).map_err(|_| provider_error(provider, "parse", false))
}

fn value_text(value: &Value) -> Option<String> {
    match value {
        Value::String(text) => Some(compact(text)),
        Value::Array(values) => values.iter().find_map(value_text),
        Value::Object(object) => ["$", "#text", "@value", "value"]
            .iter()
            .find_map(|key| object.get(*key).and_then(value_text)),
        _ => None,
    }
    .filter(|text| !text.is_empty())
}

fn recursive_value<'a>(value: &'a Value, key: &str) -> Option<&'a Value> {
    match value {
        Value::Object(object) => object.get(key).or_else(|| {
            object
                .values()
                .find_map(|child| recursive_value(child, key))
        }),
        Value::Array(values) => values.iter().find_map(|child| recursive_value(child, key)),
        _ => None,
    }
}

pub(super) fn search_pubmed(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let ids_payload = fetch(
        "pubmed",
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esearch.fcgi",
        &[
            ("db", "pubmed".to_string()),
            ("term", query.to_string()),
            ("retmode", "json".to_string()),
            ("retmax", limit.to_string()),
        ],
    )?;
    let ids_json = parse_json("pubmed", &ids_payload)?;
    let ids = ids_json
        .pointer("/esearchresult/idlist")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(limit)
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }
    let summary = fetch(
        "pubmed",
        "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/esummary.fcgi",
        &[
            ("db", "pubmed".to_string()),
            ("id", ids.join(",")),
            ("retmode", "json".to_string()),
        ],
    )?;
    parse_pubmed_summary(&summary, limit)
}

fn parse_pubmed_summary(
    bytes: &[u8],
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload = parse_json("pubmed", bytes)?;
    let result = payload
        .get("result")
        .and_then(Value::as_object)
        .ok_or_else(|| provider_error("pubmed", "parse", false))?;
    let ids = result
        .get("uids")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .filter_map(Value::as_str)
        .take(limit);
    Ok(ids
        .filter_map(|id| {
            let entry = result.get(id)?;
            let title = entry.get("title").and_then(Value::as_str).map(compact)?;
            let article_ids = entry
                .get("articleids")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let doi = article_ids.iter().find_map(|item| {
                (item.get("idtype").and_then(Value::as_str) == Some("doi"))
                    .then(|| item.get("value").and_then(Value::as_str))
                    .flatten()
                    .and_then(normalize_doi)
            });
            let authors = entry
                .get("authors")
                .and_then(Value::as_array)
                .into_iter()
                .flatten()
                .filter_map(|author| author.get("name").and_then(Value::as_str).map(compact))
                .collect();
            let year = entry
                .get("pubdate")
                .and_then(Value::as_str)
                .and_then(|value| value.get(..4))
                .and_then(|value| value.parse::<i32>().ok());
            Some(evidence(
                format!("pmid:{id}"),
                title,
                authors,
                year,
                entry
                    .get("fulljournalname")
                    .and_then(Value::as_str)
                    .map(compact),
                doi,
                None,
                None,
                None,
                format!("https://pubmed.ncbi.nlm.nih.gov/{id}/"),
                None,
                None,
                "pubmed",
            ))
        })
        .collect())
}

pub(super) fn search_doaj(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let endpoint = format!("https://doaj.org/api/search/articles/{}", encode(query));
    let bytes = fetch("doaj", &endpoint, &[("pageSize", limit.to_string())])?;
    parse_doaj(&bytes, limit)
}

fn parse_doaj(bytes: &[u8], limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload = parse_json("doaj", bytes)?;
    Ok(payload
        .get("results")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|entry| {
            let bib = entry.get("bibjson")?;
            let title = bib.get("title").and_then(Value::as_str).map(compact)?;
            let identifiers = bib
                .get("identifier")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let doi = identifiers.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("doi"))
                    .then(|| item.get("id").and_then(Value::as_str))
                    .flatten()
                    .and_then(normalize_doi)
            });
            let links = bib
                .get("link")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_default();
            let fulltext = links.iter().find_map(|item| {
                (item.get("type").and_then(Value::as_str) == Some("fulltext"))
                    .then(|| item.get("url").and_then(Value::as_str).map(str::to_string))
                    .flatten()
            });
            let landing = fulltext
                .clone()
                .or_else(|| doi.as_ref().map(|value| format!("https://doi.org/{value}")))?;
            Some(evidence(
                doi.as_ref()
                    .map(|value| format!("doi:{value}"))
                    .unwrap_or_else(|| {
                        format!(
                            "doaj:{}",
                            entry.get("id").and_then(Value::as_str).unwrap_or(&title)
                        )
                    }),
                title,
                bib.get("author")
                    .and_then(Value::as_array)
                    .into_iter()
                    .flatten()
                    .filter_map(|author| author.get("name").and_then(Value::as_str).map(compact))
                    .collect(),
                bib.get("year")
                    .and_then(Value::as_i64)
                    .map(|year| year as i32),
                bib.pointer("/journal/title")
                    .and_then(Value::as_str)
                    .map(compact),
                doi,
                None,
                Some(fulltext.is_some()),
                fulltext,
                landing,
                None,
                bib.get("abstract")
                    .and_then(Value::as_str)
                    .map(str::to_string),
                "doaj",
            ))
        })
        .collect())
}

pub(super) fn search_dblp(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "dblp",
        "https://dblp.org/search/publ/api",
        &[
            ("q", query.to_string()),
            ("h", limit.to_string()),
            ("format", "json".to_string()),
        ],
    )?;
    parse_dblp(&bytes, limit)
}

fn parse_dblp(bytes: &[u8], limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload = parse_json("dblp", bytes)?;
    Ok(payload
        .pointer("/result/hits/hit")
        .and_then(Value::as_array)
        .into_iter()
        .flatten()
        .take(limit)
        .filter_map(|entry| {
            let info = entry.get("info")?;
            let title = info.get("title").and_then(value_text)?;
            let doi = info
                .get("doi")
                .and_then(value_text)
                .and_then(|value| normalize_doi(&value));
            let landing = info
                .get("url")
                .and_then(value_text)
                .or_else(|| doi.as_ref().map(|value| format!("https://doi.org/{value}")))?;
            let author_values = info
                .pointer("/authors/author")
                .and_then(Value::as_array)
                .cloned()
                .unwrap_or_else(|| {
                    info.pointer("/authors/author")
                        .cloned()
                        .into_iter()
                        .collect()
                });
            Some(evidence(
                doi.as_ref()
                    .map(|value| format!("doi:{value}"))
                    .unwrap_or_else(|| {
                        format!(
                            "dblp:{}",
                            entry.get("@id").and_then(Value::as_str).unwrap_or(&title)
                        )
                    }),
                title,
                author_values.iter().filter_map(value_text).collect(),
                info.get("year")
                    .and_then(value_text)
                    .and_then(|value| value.parse::<i32>().ok()),
                info.get("venue").and_then(value_text),
                doi,
                None,
                None,
                None,
                landing,
                None,
                None,
                "dblp",
            ))
        })
        .collect())
}

pub(super) fn search_openaire(
    query: &str,
    limit: usize,
) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let bytes = fetch(
        "openaire",
        "https://api.openaire.eu/search/publications",
        &[
            ("keywords", query.to_string()),
            ("format", "json".to_string()),
            ("size", limit.to_string()),
        ],
    )?;
    parse_openaire(&bytes, limit)
}

fn parse_openaire(bytes: &[u8], limit: usize) -> Result<Vec<ReferenceEvidence>, ProviderError> {
    let payload = parse_json("openaire", bytes)?;
    let results = payload
        .pointer("/response/results/result")
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    Ok(results
        .iter()
        .take(limit)
        .filter_map(|entry| {
            let title = recursive_value(entry, "title").and_then(value_text)?;
            let doi = recursive_value(entry, "pid")
                .and_then(value_text)
                .and_then(|value| normalize_doi(&value));
            let landing = recursive_value(entry, "url")
                .and_then(value_text)
                .or_else(|| doi.as_ref().map(|value| format!("https://doi.org/{value}")))?;
            let authors = recursive_value(entry, "creator")
                .map(|value| match value {
                    Value::Array(values) => values.iter().filter_map(value_text).collect(),
                    _ => value_text(value).into_iter().collect(),
                })
                .unwrap_or_default();
            Some(evidence(
                doi.as_ref()
                    .map(|value| format!("doi:{value}"))
                    .unwrap_or_else(|| format!("openaire:{}", compact(&title).to_lowercase())),
                title,
                authors,
                recursive_value(entry, "dateofacceptance")
                    .and_then(value_text)
                    .and_then(|value| value.get(..4)?.parse::<i32>().ok()),
                recursive_value(entry, "publisher").and_then(value_text),
                doi,
                None,
                recursive_value(entry, "bestaccessright")
                    .and_then(value_text)
                    .map(|value| value.to_lowercase().contains("open")),
                None,
                landing,
                None,
                recursive_value(entry, "description").and_then(value_text),
                "openaire",
            ))
        })
        .collect())
}

#[cfg(test)]
mod tests {
    use super::{parse_dblp, parse_doaj, parse_openaire, parse_pubmed_summary};

    #[test]
    fn parses_pubmed_summary_fixture() {
        let fixture = br#"{"result":{"uids":["42"],"42":{"title":"Clinical result","pubdate":"2026 Jan","authors":[{"name":"A Researcher"}],"fulljournalname":"Journal","articleids":[{"idtype":"doi","value":"10.1000/test"}]}}}"#;
        let items = parse_pubmed_summary(fixture, 4).unwrap();
        assert_eq!(items[0].stable_id, "pmid:42");
        assert_eq!(items[0].doi.as_deref(), Some("10.1000/test"));
    }

    #[test]
    fn parses_doaj_and_dblp_fixtures() {
        let doaj = br#"{"results":[{"id":"d1","bibjson":{"title":"Open study","author":[{"name":"A"}],"identifier":[{"type":"doi","id":"10.1/open"}],"link":[{"type":"fulltext","url":"https://example.org/paper"}]}}]}"#;
        let dblp = br#"{"result":{"hits":{"hit":[{"@id":"x","info":{"title":"Graph systems","authors":{"author":[{"text":"B"}]},"year":"2026","venue":"Conf","url":"https://dblp.org/rec/x"}}]}}}"#;
        assert_eq!(parse_doaj(doaj, 4).unwrap()[0].source, "doaj");
        assert_eq!(parse_dblp(dblp, 4).unwrap()[0].source, "dblp");
    }

    #[test]
    fn parses_openaire_nested_fixture() {
        let fixture = br#"{
            "response": {
                "results": {
                    "result": [{
                        "metadata": {
                            "title": {"$": "Open research graph"},
                            "pid": {"$": "https://doi.org/10.1000/openaire"},
                            "creator": [{"$": "A Researcher"}, {"$": "B Scientist"}],
                            "dateofacceptance": {"$": "2026-07-31"},
                            "publisher": {"$": "Open Publisher"},
                            "bestaccessright": {"$": "Open Access"},
                            "description": {"$": "A bounded provider fixture."},
                            "url": {"$": "https://example.org/openaire-paper"}
                        }
                    }]
                }
            }
        }"#;
        let items = parse_openaire(fixture, 4).unwrap();
        assert_eq!(items.len(), 1);
        assert_eq!(items[0].stable_id, "doi:10.1000/openaire");
        assert_eq!(items[0].authors, ["A Researcher", "B Scientist"]);
        assert_eq!(items[0].year, Some(2026));
        assert_eq!(items[0].open_access, Some(true));
        assert_eq!(items[0].landing_url, "https://example.org/openaire-paper");
    }
}
