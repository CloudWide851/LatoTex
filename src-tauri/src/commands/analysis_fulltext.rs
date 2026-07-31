use super::ReferenceEvidence;
use crate::outbound_http::{build_public_blocking_client, OutboundProxyMode};
use regex::Regex;
use std::io::Read;
use std::path::Path;
use std::sync::OnceLock;
use std::time::Duration;

const FULLTEXT_RESULT_LIMIT: usize = 8;
const FULLTEXT_PARALLELISM: usize = 3;
const FULLTEXT_HTML_BODY_LIMIT: u64 = 8 * 1024 * 1024;
const FULLTEXT_PDF_BODY_LIMIT: u64 = 64 * 1024 * 1024;
const FULLTEXT_EXCERPT_LIMIT: usize = 16_000;

pub(super) struct FulltextRuntimeContext<'a> {
    pub db_path: &'a Path,
    pub app_runtime_root: &'a Path,
    pub app_data_dir: &'a Path,
    pub project_id: &'a str,
    pub project_root: &'a Path,
}

fn html_text(raw: &str) -> String {
    static SCRIPT_STYLE: OnceLock<Regex> = OnceLock::new();
    static TAGS: OnceLock<Regex> = OnceLock::new();
    let without_scripts = SCRIPT_STYLE
        .get_or_init(|| {
            Regex::new(r"(?is)<(?:script|style|noscript)[^>]*>.*?</(?:script|style|noscript)>")
                .unwrap()
        })
        .replace_all(raw, " ");
    let without_tags = TAGS
        .get_or_init(|| Regex::new(r"(?is)<[^>]+>").unwrap())
        .replace_all(&without_scripts, " ");
    without_tags
        .replace("&nbsp;", " ")
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
}

fn fetch_fulltext(
    candidate: &str,
    pdf_runtime: Option<&crate::storage::ReadyPaperExtractRuntime>,
) -> Option<(String, String)> {
    let Ok((client, url, _)) = build_public_blocking_client(
        candidate,
        &OutboundProxyMode::System,
        Duration::from_secs(12),
    ) else {
        return None;
    };
    let Ok(response) = client
        .get(url.as_str())
        .header(
            "Accept",
            "text/html, application/xhtml+xml, application/pdf",
        )
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
    let is_pdf = content_type.starts_with("application/pdf");
    let is_html =
        content_type.starts_with("text/html") || content_type.starts_with("application/xhtml+xml");
    let body_limit = if is_pdf {
        if pdf_runtime.is_none() {
            return None;
        }
        FULLTEXT_PDF_BODY_LIMIT
    } else if is_html {
        FULLTEXT_HTML_BODY_LIMIT
    } else {
        return None;
    };
    if response
        .content_length()
        .is_some_and(|size| size > body_limit)
    {
        return None;
    }
    let mut body = Vec::new();
    if response
        .take(body_limit + 1)
        .read_to_end(&mut body)
        .is_err()
        || body.len() as u64 > body_limit
    {
        return None;
    }
    let text = if is_pdf {
        crate::storage::extract_downloaded_pdf_text(pdf_runtime?, &body)
            .ok()
            .flatten()?
    } else {
        html_text(&String::from_utf8_lossy(&body))
    };
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
    let mut candidates = Vec::<String>::new();
    if evidence.open_access != Some(false) {
        if let Some(pdf_url) = evidence
            .pdf_url
            .as_deref()
            .map(str::trim)
            .filter(|value| value.starts_with("https://"))
        {
            candidates.push(pdf_url.to_string());
        }
    }
    let landing = evidence.landing_url.trim();
    if landing.starts_with("https://") && !candidates.iter().any(|item| item == landing) {
        candidates.push(landing.to_string());
    }
    let Some((text, source_url)) = candidates
        .iter()
        .find_map(|candidate| fetch_fulltext(candidate, pdf_runtime))
    else {
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
    use super::html_text;

    #[test]
    fn html_extraction_drops_scripts_and_keeps_visible_text() {
        let text = html_text(
            "<html><style>.hidden{}</style><script>secret()</script><body>Evidence &amp; result</body></html>",
        );
        assert_eq!(text, "Evidence & result");
        assert!(!text.contains("secret"));
    }
}
