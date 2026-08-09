use super::analysis_fulltext::{enrich_academic_fulltext, FulltextRuntimeContext};
use super::analysis_research_providers::expand_semantic_scholar_related;
use super::analysis_search_coordinator::{run_remote_providers, RemoteSearchBundle};
use super::{
    AcademicProviderHealth, ReferenceCheckItem, ReferenceCheckResponse, ReferenceEvidence,
};
use crate::storage;
use regex::Regex;
use std::cmp::Ordering;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};

const RRF_K: f64 = 60.0;
const LOCAL_BIB_LIMIT: usize = 256;
const QUERY_LIMIT: usize = 512;

fn normalize_identifier(raw: &str) -> Option<String> {
    let value = raw
        .trim()
        .trim_start_matches("https://doi.org/")
        .trim_start_matches("http://doi.org/")
        .trim_start_matches("doi:")
        .trim()
        .to_ascii_lowercase();
    (!value.is_empty()).then_some(value)
}

fn normalized_title(raw: &str) -> String {
    raw.chars()
        .flat_map(char::to_lowercase)
        .filter(|character| character.is_alphanumeric())
        .collect()
}

fn evidence_key(item: &ReferenceEvidence) -> String {
    if let Some(doi) = item.doi.as_deref().and_then(normalize_identifier) {
        return format!("doi:{doi}");
    }
    if let Some(arxiv_id) = item.arxiv_id.as_deref() {
        return format!("arxiv:{}", arxiv_id.trim().to_ascii_lowercase());
    }
    format!(
        "meta:{}|{}|{}",
        normalized_title(&item.title),
        item.authors
            .first()
            .map(|author| normalized_title(author))
            .unwrap_or_default(),
        item.year.map(|year| year.to_string()).unwrap_or_default()
    )
}

fn evidence_level_rank(level: &str) -> u8 {
    match level {
        "fulltext" => 3,
        "abstract" => 2,
        _ => 1,
    }
}

fn merge_evidence(current: &mut ReferenceEvidence, incoming: ReferenceEvidence, score: f64) {
    current.rrf_score += score;
    for provider in incoming.provenance {
        if !current.provenance.contains(&provider) {
            current.provenance.push(provider);
        }
    }
    if current.authors.is_empty() {
        current.authors = incoming.authors;
    }
    current.year = current.year.or(incoming.year);
    current.venue = current.venue.take().or(incoming.venue);
    current.doi = current.doi.take().or(incoming.doi);
    current.arxiv_id = current.arxiv_id.take().or(incoming.arxiv_id);
    current.open_access = current.open_access.or(incoming.open_access);
    current.pdf_url = current.pdf_url.take().or(incoming.pdf_url);
    current.citation_count = current.citation_count.max(incoming.citation_count);
    if current.fulltext_document_hash.is_none() && incoming.fulltext_document_hash.is_some() {
        current.fulltext_document_hash = incoming.fulltext_document_hash;
        current.fulltext_anchors = incoming.fulltext_anchors;
    }
    if incoming.retraction_status == "retracted" {
        current.retraction_status = incoming.retraction_status;
    }
    if matches!(
        incoming.correction_status.as_str(),
        "corrected" | "expression_of_concern"
    ) {
        current.correction_status = incoming.correction_status;
    }
    if evidence_level_rank(&incoming.evidence_level) > evidence_level_rank(&current.evidence_level)
    {
        current.evidence_level = incoming.evidence_level;
        current.abstract_text = incoming.abstract_text;
        current.snippet = incoming.snippet;
    } else if current.abstract_text.is_none() {
        current.abstract_text = incoming.abstract_text;
    }
}

fn reciprocal_rank_merge(
    provider_lists: Vec<Vec<ReferenceEvidence>>,
    limit: usize,
) -> Vec<ReferenceEvidence> {
    let mut merged = HashMap::<String, ReferenceEvidence>::new();
    for list in provider_lists {
        for (rank, mut item) in list.into_iter().enumerate() {
            let score = 1.0 / (RRF_K + rank as f64 + 1.0);
            let key = evidence_key(&item);
            if let Some(current) = merged.get_mut(&key) {
                merge_evidence(current, item, score);
            } else {
                item.rrf_score = score;
                merged.insert(key, item);
            }
        }
    }
    let mut values = merged.into_values().collect::<Vec<_>>();
    values.sort_by(|left, right| {
        right
            .rrf_score
            .partial_cmp(&left.rrf_score)
            .unwrap_or(Ordering::Equal)
            .then_with(|| left.title.to_lowercase().cmp(&right.title.to_lowercase()))
            .then_with(|| left.stable_id.cmp(&right.stable_id))
    });
    values.truncate(limit);
    values
}

fn stable_web_merge(
    provider_lists: Vec<Vec<ReferenceEvidence>>,
    limit: usize,
) -> Vec<ReferenceEvidence> {
    let mut seen = HashSet::<String>::new();
    let mut merged = Vec::new();
    for list in provider_lists {
        for item in list {
            let key = if item.landing_url.trim().is_empty() {
                format!("title:{}", normalized_title(&item.title))
            } else {
                format!("url:{}", item.landing_url.trim().to_ascii_lowercase())
            };
            if seen.insert(key) {
                merged.push(item);
            }
            if merged.len() >= limit {
                return merged;
            }
        }
    }
    merged
}

fn collect_bib_paths(root: &Path, directory: &Path, depth: usize, paths: &mut Vec<PathBuf>) {
    if depth > 8 || paths.len() >= LOCAL_BIB_LIMIT {
        return;
    }
    let Ok(entries) = fs::read_dir(directory) else {
        return;
    };
    for entry in entries.flatten() {
        if paths.len() >= LOCAL_BIB_LIMIT {
            break;
        }
        let path = entry.path();
        let Ok(metadata) = fs::symlink_metadata(&path) else {
            continue;
        };
        if metadata.file_type().is_symlink() {
            continue;
        }
        if metadata.is_dir() {
            let name = entry.file_name().to_string_lossy().to_ascii_lowercase();
            if matches!(
                name.as_str(),
                ".git" | ".latotex" | "node_modules" | "target"
            ) {
                continue;
            }
            collect_bib_paths(root, &path, depth + 1, paths);
        } else if metadata.is_file()
            && path
                .extension()
                .is_some_and(|extension| extension.eq_ignore_ascii_case("bib"))
            && path.starts_with(root)
        {
            paths.push(path);
        }
    }
}

fn bib_field(body: &str, field: &str) -> Option<String> {
    let expression = Regex::new(&format!(
        r#"(?is)(?:^|,)\s*{}\s*=\s*(?:\{{([^}}]*)\}}|"([^"]*)")"#,
        regex::escape(field)
    ))
    .ok()?;
    expression.captures(body).and_then(|capture| {
        capture
            .get(1)
            .or_else(|| capture.get(2))
            .map(|value| {
                value
                    .as_str()
                    .split_whitespace()
                    .collect::<Vec<_>>()
                    .join(" ")
            })
            .filter(|value| !value.is_empty())
    })
}

fn local_bib_search(root: Option<&Path>, query: &str, limit: usize) -> Vec<ReferenceEvidence> {
    let Some(root) = root else {
        return Vec::new();
    };
    let mut paths = Vec::new();
    collect_bib_paths(root, root, 0, &mut paths);
    paths.sort();
    let terms = query
        .split_whitespace()
        .map(|value| value.to_ascii_lowercase())
        .filter(|value| value.len() > 1)
        .collect::<Vec<_>>();
    let entry_re =
        Regex::new(r"(?is)@\w+\s*\{\s*([^,\s]+)\s*,(.*?)\n\}").expect("valid bib entry regex");
    let mut matches = Vec::<(usize, ReferenceEvidence)>::new();
    for path in paths {
        let Ok(relative) = path.strip_prefix(root) else {
            continue;
        };
        let relative = relative.to_string_lossy().replace('\\', "/");
        let Ok(content) =
            storage::read_text_under_root(root, &relative, storage::WORKSPACE_SCAN_FILE_LIMIT)
        else {
            continue;
        };
        for capture in entry_re.captures_iter(&content) {
            let key = capture.get(1).map(|value| value.as_str()).unwrap_or("");
            let body = capture.get(2).map(|value| value.as_str()).unwrap_or("");
            let title = bib_field(body, "title").unwrap_or_default();
            let authors = bib_field(body, "author")
                .map(|value| {
                    value
                        .split(" and ")
                        .map(str::trim)
                        .filter(|value| !value.is_empty())
                        .map(str::to_string)
                        .collect::<Vec<_>>()
                })
                .unwrap_or_default();
            if title.is_empty() {
                continue;
            }
            let haystack = format!("{} {} {}", title, authors.join(" "), key).to_ascii_lowercase();
            let matched = terms
                .iter()
                .filter(|term| haystack.contains(term.as_str()))
                .count();
            if !terms.is_empty() && matched == 0 {
                continue;
            }
            let doi = bib_field(body, "doi").and_then(|value| normalize_identifier(&value));
            let arxiv_id = bib_field(body, "eprint");
            let landing_url = bib_field(body, "url")
                .or_else(|| doi.as_ref().map(|value| format!("https://doi.org/{value}")))
                .or_else(|| {
                    arxiv_id
                        .as_ref()
                        .map(|value| format!("https://arxiv.org/abs/{value}"))
                })
                .unwrap_or_else(|| format!("workspace:{relative}#{key}"));
            let stable_id = doi
                .as_ref()
                .map(|value| format!("doi:{value}"))
                .or_else(|| arxiv_id.as_ref().map(|value| format!("arxiv:{value}")))
                .unwrap_or_else(|| format!("bib:{relative}#{key}"));
            matches.push((
                matched,
                ReferenceEvidence {
                    stable_id,
                    title,
                    authors,
                    year: bib_field(body, "year").and_then(|value| value.parse().ok()),
                    venue: bib_field(body, "journal").or_else(|| bib_field(body, "booktitle")),
                    doi,
                    arxiv_id,
                    open_access: None,
                    pdf_url: bib_field(body, "file"),
                    landing_url: landing_url.clone(),
                    citation_count: None,
                    abstract_text: bib_field(body, "abstract"),
                    source: "local_bib".to_string(),
                    evidence_level: if bib_field(body, "abstract").is_some() {
                        "abstract"
                    } else {
                        "metadata"
                    }
                    .to_string(),
                    provenance: vec!["local_bib".to_string()],
                    original_source_url: format!("workspace:{relative}#{key}"),
                    fulltext_document_hash: None,
                    fulltext_anchors: Vec::new(),
                    retraction_status: "unknown".to_string(),
                    correction_status: "unknown".to_string(),
                    rrf_score: 0.0,
                    url: landing_url,
                    snippet: bib_field(body, "abstract").unwrap_or_default(),
                },
            ));
        }
    }
    matches.sort_by(|left, right| {
        right
            .0
            .cmp(&left.0)
            .then_with(|| left.1.title.cmp(&right.1.title))
    });
    matches
        .into_iter()
        .map(|(_, item)| item)
        .take(limit)
        .collect()
}

pub(crate) fn run_reference_check_queries(
    cache_db_path: &Path,
    app_runtime_root: &Path,
    app_data_dir: Option<&Path>,
    project_id: Option<&str>,
    queries: Vec<String>,
    limit: u32,
    project_root: Option<&Path>,
    unpaywall_contact_email: Option<&str>,
    deep: bool,
    allow_remote_metadata: bool,
    allow_verified_oa_download: bool,
) -> Result<ReferenceCheckResponse, String> {
    let limit = limit.clamp(1, 8) as usize;
    let queries = queries
        .into_iter()
        .map(|query| query.trim().to_string())
        .filter(|query| !query.is_empty())
        .take(16)
        .collect::<Vec<_>>();
    if queries.is_empty() {
        return Err("academic.query.missing".to_string());
    }
    let mut items = Vec::new();
    for query in queries {
        if query.chars().count() > QUERY_LIMIT {
            items.push(ReferenceCheckItem {
                query,
                query_snapshot_id: format!("query-snapshot-{}", uuid::Uuid::new_v4().simple()),
                stop_reason: "no_results".to_string(),
                ok: false,
                message: "academic.query.too_long".to_string(),
                results: Vec::new(),
                academic_results: Vec::new(),
                web_results: Vec::new(),
                provider_errors: Vec::new(),
                provider_health: Vec::new(),
                network_used: false,
            });
            continue;
        }
        let mut academic_lists = Vec::<Vec<ReferenceEvidence>>::new();
        let mut provider_health = Vec::<AcademicProviderHealth>::new();
        let local = local_bib_search(project_root, &query, limit);
        provider_health.push(AcademicProviderHealth {
            provider: "local_bib".to_string(),
            category: "local".to_string(),
            status: "live".to_string(),
            result_count: local.len(),
            cache_age_seconds: None,
            code: None,
            retryable: false,
        });
        if !local.is_empty() {
            academic_lists.push(local);
        }
        let remote = if allow_remote_metadata {
            run_remote_providers(cache_db_path, &query, limit, unpaywall_contact_email)
        } else {
            RemoteSearchBundle {
                academic_lists: Vec::new(),
                web_lists: Vec::new(),
                failures: Vec::new(),
                health: Vec::new(),
            }
        };
        academic_lists.extend(remote.academic_lists);
        provider_health.extend(remote.health);
        if deep && allow_remote_metadata {
            let preliminary = reciprocal_rank_merge(academic_lists.clone(), limit);
            academic_lists.extend(expand_semantic_scholar_related(&preliminary, limit));
        }
        let academic_results = reciprocal_rank_merge(academic_lists, limit);
        let academic_results = if deep && allow_verified_oa_download {
            let context = app_data_dir.zip(project_id).zip(project_root).map(
                |((app_data_dir, project_id), project_root)| FulltextRuntimeContext {
                    db_path: cache_db_path,
                    app_runtime_root,
                    app_data_dir,
                    project_id,
                    project_root,
                },
            );
            enrich_academic_fulltext(academic_results, context)
        } else {
            academic_results
        };
        let web_results = stable_web_merge(remote.web_lists, limit);
        let mut results = academic_results.clone();
        results.extend(web_results.clone());
        let provider_errors = remote.failures;
        let stop_reason = if !allow_remote_metadata {
            "network_disabled"
        } else if results.is_empty() {
            "no_results"
        } else if !provider_errors.is_empty() {
            "provider_degraded"
        } else if results.len() >= limit {
            "result_limit"
        } else {
            "providers_exhausted"
        };
        items.push(ReferenceCheckItem {
            query,
            query_snapshot_id: format!("query-snapshot-{}", uuid::Uuid::new_v4().simple()),
            stop_reason: stop_reason.to_string(),
            ok: !results.is_empty(),
            message: if results.is_empty() {
                "academic.search.no_results"
            } else if provider_errors.is_empty() {
                "academic.search.complete"
            } else {
                "academic.search.partial"
            }
            .to_string(),
            results,
            academic_results,
            web_results,
            provider_errors,
            provider_health,
            network_used: allow_remote_metadata,
        });
    }
    Ok(ReferenceCheckResponse { items })
}

#[cfg(test)]
mod tests {
    use super::{
        evidence_key, reciprocal_rank_merge, run_reference_check_queries, stable_web_merge,
    };
    use crate::commands::analysis::ReferenceEvidence;

    fn item(
        id: &str,
        doi: Option<&str>,
        arxiv_id: Option<&str>,
        source: &str,
    ) -> ReferenceEvidence {
        ReferenceEvidence {
            stable_id: id.to_string(),
            title: "Stable evidence title".to_string(),
            authors: vec!["Researcher".to_string()],
            year: Some(2026),
            venue: None,
            doi: doi.map(str::to_string),
            arxiv_id: arxiv_id.map(str::to_string),
            open_access: None,
            pdf_url: None,
            landing_url: "https://example.test/item".to_string(),
            citation_count: None,
            abstract_text: None,
            source: source.to_string(),
            evidence_level: "metadata".to_string(),
            provenance: vec![source.to_string()],
            original_source_url: "https://example.test/item".to_string(),
            fulltext_document_hash: None,
            fulltext_anchors: Vec::new(),
            retraction_status: "unknown".to_string(),
            correction_status: "unknown".to_string(),
            rrf_score: 0.0,
            url: "https://example.test/item".to_string(),
            snippet: String::new(),
        }
    }

    #[test]
    fn identifier_first_keys_merge_cross_provider_evidence() {
        assert_eq!(
            evidence_key(&item("a", Some("10.1000/Test"), None, "openalex")),
            "doi:10.1000/test"
        );
        let merged = reciprocal_rank_merge(
            vec![
                vec![item("a", Some("10.1000/test"), None, "openalex")],
                vec![item("b", Some("10.1000/TEST"), None, "crossref")],
            ],
            5,
        );
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].provenance, vec!["openalex", "crossref"]);
    }

    #[test]
    fn arxiv_identifier_precedes_title_fallback() {
        assert_eq!(
            evidence_key(&item("a", None, Some("2607.01234"), "arxiv")),
            "arxiv:2607.01234"
        );
    }

    #[test]
    fn reciprocal_rank_ties_have_stable_title_order() {
        let mut zeta = item("z", None, None, "openalex");
        zeta.title = "Zeta evidence".to_string();
        let mut alpha = item("a", None, None, "crossref");
        alpha.title = "Alpha evidence".to_string();
        let merged = reciprocal_rank_merge(vec![vec![zeta], vec![alpha]], 5);
        assert_eq!(
            merged
                .iter()
                .map(|evidence| evidence.title.as_str())
                .collect::<Vec<_>>(),
            vec!["Alpha evidence", "Zeta evidence"]
        );
    }

    #[test]
    fn web_results_keep_provider_order_without_academic_rrf() {
        let first = item("web-a", None, None, "duckduckgo");
        let mut duplicate = item("web-b", None, None, "wikipedia");
        duplicate.landing_url = first.landing_url.clone();
        let merged = stable_web_merge(vec![vec![first], vec![duplicate]], 5);
        assert_eq!(merged.len(), 1);
        assert_eq!(merged[0].source, "duckduckgo");
        assert_eq!(merged[0].rrf_score, 0.0);
    }

    #[test]
    fn disabled_network_policy_keeps_local_bib_search_offline() {
        let root = std::env::temp_dir().join(format!(
            "latotex-offline-reference-search-{}",
            uuid::Uuid::new_v4()
        ));
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(
            root.join("sources.bib"),
            "@article{local,\n title={Offline evidence result},\n author={Ada Researcher},\n year={2026}\n}\n",
        )
        .unwrap();
        let response = run_reference_check_queries(
            &root.join("cache.sqlite3"),
            &root,
            None,
            Some("project-offline"),
            vec!["offline evidence".to_string()],
            5,
            Some(&root),
            None,
            true,
            false,
            false,
        )
        .unwrap();
        assert_eq!(response.items.len(), 1);
        assert!(!response.items[0].network_used);
        assert_eq!(response.items[0].stop_reason, "network_disabled");
        assert!(response.items[0]
            .query_snapshot_id
            .starts_with("query-snapshot-"));
        assert_eq!(response.items[0].academic_results.len(), 1);
        assert_eq!(response.items[0].academic_results[0].source, "local_bib");
        let _ = std::fs::remove_dir_all(root);
    }
}
