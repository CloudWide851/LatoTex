use crate::models::SubmissionPackIssue;
use std::collections::BTreeMap;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum PackProfile {
    Generic,
    Arxiv,
    Conference,
    Journal,
    IeeeLike,
    Acm,
    Springer,
    Elsevier,
}

pub(super) fn parse_profile(profile_id: &str) -> PackProfile {
    match profile_id.trim().to_ascii_lowercase().as_str() {
        "arxiv" => PackProfile::Arxiv,
        "conference" => PackProfile::Conference,
        "journal" => PackProfile::Journal,
        "ieee" | "ieee-like" | "ieee_like" => PackProfile::IeeeLike,
        "acm" => PackProfile::Acm,
        "springer" => PackProfile::Springer,
        "elsevier" => PackProfile::Elsevier,
        _ => PackProfile::Generic,
    }
}

pub(super) fn canonical_profile_id(profile: PackProfile) -> &'static str {
    match profile {
        PackProfile::Generic => "generic",
        PackProfile::Arxiv => "arxiv",
        PackProfile::Conference => "conference",
        PackProfile::Journal => "journal",
        PackProfile::IeeeLike => "ieee-like",
        PackProfile::Acm => "acm",
        PackProfile::Springer => "springer",
        PackProfile::Elsevier => "elsevier",
    }
}

pub(super) fn collect_profile_warnings(
    profile: PackProfile,
    tex_sources: &BTreeMap<String, String>,
) -> Vec<SubmissionPackIssue> {
    let mut warnings = Vec::new();
    let combined = tex_sources.values().cloned().collect::<Vec<_>>().join("\n");
    let combined_lower = combined.to_ascii_lowercase();
    if should_expect_abstract(profile) && !has_abstract(&combined_lower) {
        warnings.push(warning("submissionPack.abstractHint"));
    }
    if profile == PackProfile::IeeeLike {
        if !combined_lower.contains("ieeetran") {
            warnings.push(warning("submissionPack.ieeeClassHint"));
        }
        if !combined.contains("\\bibliographystyle") {
            warnings.push(warning("submissionPack.ieeeBibliographyStyleHint"));
        }
    }
    if profile == PackProfile::Acm {
        if !has_document_class(&combined_lower, "acmart") {
            warnings.push(warning("submissionPack.acmClassHint"));
        }
        if !contains_any(
            &combined,
            &[
                "\\acmConference",
                "\\setcopyright",
                "\\copyrightyear",
                "\\acmYear",
                "\\acmDOI",
            ],
        ) {
            warnings.push(warning("submissionPack.acmMetadataHint"));
        }
    }
    if profile == PackProfile::Springer {
        if !contains_any(
            &combined_lower,
            &[
                "{llncs}",
                "{sn-jnl}",
                "{svjour",
                "{svmult}",
                "{svmono}",
                "{spbasic}",
            ],
        ) {
            warnings.push(warning("submissionPack.springerClassHint"));
        }
        if !has_keywords(&combined_lower) {
            warnings.push(warning("submissionPack.springerKeywordsHint"));
        }
    }
    if profile == PackProfile::Elsevier {
        if !has_document_class(&combined_lower, "elsarticle") {
            warnings.push(warning("submissionPack.elsevierClassHint"));
        }
        if !has_keywords(&combined_lower) {
            warnings.push(warning("submissionPack.elsevierKeywordsHint"));
        }
    }
    if profile == PackProfile::Arxiv {
        warnings.push(warning("submissionPack.arxivSourceHint"));
    }
    warnings
}

fn warning(id: &str) -> SubmissionPackIssue {
    SubmissionPackIssue {
        id: id.to_string(),
        severity: "warning".to_string(),
        count: None,
        detail: None,
    }
}

fn should_expect_abstract(profile: PackProfile) -> bool {
    matches!(
        profile,
        PackProfile::Conference
            | PackProfile::Journal
            | PackProfile::IeeeLike
            | PackProfile::Acm
            | PackProfile::Springer
            | PackProfile::Elsevier
    )
}

fn contains_any(source: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| source.contains(needle))
}

fn has_document_class(source_lower: &str, class_name: &str) -> bool {
    source_lower.contains(&format!("{{{}}}", class_name.to_ascii_lowercase()))
}

fn has_abstract(source_lower: &str) -> bool {
    source_lower.contains("\\begin{abstract}") && source_lower.contains("\\end{abstract}")
}

fn has_keywords(source_lower: &str) -> bool {
    source_lower.contains("\\keywords{")
        || source_lower.contains("\\begin{keywords}")
        || source_lower.contains("\\begin{keyword}")
}
