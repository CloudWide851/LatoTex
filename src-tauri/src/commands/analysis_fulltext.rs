use super::ReferenceEvidence;
use crate::outbound_http::{build_public_blocking_client, OutboundProxyMode};
use std::io::Read;
use std::path::Path;
use std::time::Duration;

const FULLTEXT_RESULT_LIMIT: usize = 8;
const FULLTEXT_PARALLELISM: usize = 3;
const FULLTEXT_PDF_BODY_LIMIT: u64 = 64 * 1024 * 1024;
const FULLTEXT_EXCERPT_LIMIT: usize = 16_000;

pub(super) struct FulltextRuntimeContext<'a> {
    pub db_path: &'a Path,
    pub app_runtime_root: &'a Path,
    pub app_data_dir: &'a Path,
    pub project_id: &'a str,
    pub project_root: &'a Path,
}

fn has_pdf_magic(bytes: &[u8]) -> bool {
    bytes.starts_with(b"%PDF-")
}

fn verified_oa_pdf_candidate(evidence: &ReferenceEvidence) -> Option<&str> {
    (evidence.open_access == Some(true))
        .then(|| evidence.pdf_url.as_deref())
        .flatten()
        .map(str::trim)
        .filter(|value| value.starts_with("https://"))
}

fn fetch_fulltext(
    candidate: &str,
    pdf_runtime: Option<&crate::storage::ReadyPaperExtractRuntime>,
) -> Option<(String, String)> {
    let pdf_runtime = pdf_runtime?;
    let Ok((client, url, _)) = build_public_blocking_client(
        candidate,
        &OutboundProxyMode::System,
        Duration::from_secs(12),
    ) else {
        return None;
    };
    let Ok(response) = client
        .get(url.as_str())
        .header("Accept", "application/pdf")
        .header("User-Agent", "LatoTex/0.1 (research fulltext)")
        .send()
    else {
        return None;
    };
    if !response.status().is_success() {
        return None;
    }
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !content_type.starts_with("application/pdf") {
        return None;
    }
    if response
        .content_length()
        .is_some_and(|size| size > FULLTEXT_PDF_BODY_LIMIT)
    {
        return None;
    }
    let mut body = Vec::new();
    if response
        .take(FULLTEXT_PDF_BODY_LIMIT + 1)
        .read_to_end(&mut body)
        .is_err()
        || body.len() as u64 > FULLTEXT_PDF_BODY_LIMIT
        || !has_pdf_magic(&body)
    {
        return None;
    }
    let text = crate::storage::extract_downloaded_pdf_text(pdf_runtime, &body)
        .ok()
        .flatten()?;
    let normalized = text.to_ascii_lowercase();
    if text.chars().count() < 600
        || (normalized.contains("sign in") && normalized.contains("subscribe"))
    {
        return None;
    }
    Some((text, url.to_string()))
}

fn enrich_one(
    mut evidence: ReferenceEvidence,
    pdf_runtime: Option<&crate::storage::ReadyPaperExtractRuntime>,
) -> ReferenceEvidence {
    let Some(candidate) = verified_oa_pdf_candidate(&evidence) else {
        return evidence;
    };
    let Some((text, source_url)) = fetch_fulltext(candidate, pdf_runtime) else {
        return evidence;
    };
    let excerpt = text
        .chars()
        .take(FULLTEXT_EXCERPT_LIMIT)
        .collect::<String>();
    evidence.abstract_text = Some(excerpt.clone());
    evidence.snippet = excerpt.chars().take(1_200).collect();
    evidence.evidence_level = "fulltext".to_string();
    evidence.original_source_url = source_url;
    evidence
}

pub(super) fn enrich_academic_fulltext(
    mut evidence: Vec<ReferenceEvidence>,
    context: Option<FulltextRuntimeContext<'_>>,
) -> Vec<ReferenceEvidence> {
    let pdf_runtime = context.and_then(|context| {
        crate::storage::resolve_ready_paper_extract_runtime(
            context.db_path,
            context.app_runtime_root,
            context.app_data_dir,
            context.project_id,
            context.project_root,
        )
    });
    let count = evidence.len().min(FULLTEXT_RESULT_LIMIT);
    for start in (0..count).step_by(FULLTEXT_PARALLELISM) {
        let end = (start + FULLTEXT_PARALLELISM).min(count);
        let enriched = std::thread::scope(|scope| {
            evidence[start..end]
                .iter()
                .cloned()
                .map(|item| {
                    let pdf_runtime = pdf_runtime.as_ref();
                    scope.spawn(move || enrich_one(item, pdf_runtime))
                })
                .collect::<Vec<_>>()
                .into_iter()
                .map(|handle| handle.join().ok())
                .collect::<Vec<_>>()
        });
        for (offset, item) in enriched.into_iter().enumerate() {
            if let Some(item) = item {
                evidence[start + offset] = item;
            }
        }
    }
    evidence
}

#[cfg(test)]
mod tests {
    use super::{has_pdf_magic, verified_oa_pdf_candidate};
    use crate::commands::analysis::ReferenceEvidence;

    fn evidence(open_access: Option<bool>, pdf_url: Option<&str>) -> ReferenceEvidence {
        ReferenceEvidence {
            stable_id: "paper".to_string(),
            title: "Paper".to_string(),
            authors: Vec::new(),
            year: None,
            venue: None,
            doi: None,
            arxiv_id: None,
            open_access,
            pdf_url: pdf_url.map(str::to_string),
            landing_url: "https://publisher.example/paywalled".to_string(),
            citation_count: None,
            abstract_text: None,
            source: "fixture".to_string(),
            evidence_level: "metadata".to_string(),
            provenance: vec!["fixture".to_string()],
            original_source_url: "https://publisher.example/paywalled".to_string(),
            rrf_score: 0.0,
            url: "https://publisher.example/paywalled".to_string(),
            snippet: String::new(),
        }
    }

    #[test]
    fn fulltext_requires_pdf_magic() {
        assert!(has_pdf_magic(b"%PDF-1.7\n"));
        assert!(!has_pdf_magic(b"<html>not a paper</html>"));
    }

    #[test]
    fn fulltext_candidate_requires_explicit_open_access_https_pdf() {
        assert!(verified_oa_pdf_candidate(&evidence(
            Some(true),
            Some("https://repository.example/paper.pdf"),
        ))
        .is_some());
        assert!(verified_oa_pdf_candidate(&evidence(
            None,
            Some("https://repository.example/paper.pdf"),
        ))
        .is_none());
        assert!(verified_oa_pdf_candidate(&evidence(
            Some(true),
            Some("http://repository.example/paper.pdf"),
        ))
        .is_none());
    }
}
