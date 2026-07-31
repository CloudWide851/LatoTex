use super::{
    dual_pdf_relative_path, is_anthropic_candidate, is_gemini_candidate,
    normalize_runtime_path_text, parse_runtime_progress_line, preferred_target_language,
};
use crate::storage::TranslationModelCandidate;
use std::path::Path;

fn candidate(base_url: &str, model_name: &str) -> TranslationModelCandidate {
    TranslationModelCandidate {
        model_id: "model-1".to_string(),
        base_url: base_url.to_string(),
        model_name: model_name.to_string(),
    }
}

#[test]
fn defaults_target_language_to_simplified_chinese() {
    assert_eq!(preferred_target_language(None), "Chinese (Simplified)");
    assert_eq!(
        preferred_target_language(Some("  ")),
        "Chinese (Simplified)"
    );
}

#[test]
fn detects_gemini_candidates_by_url_or_model_name() {
    assert!(is_gemini_candidate(&candidate(
        "https://generativelanguage.googleapis.com/v1beta",
        "custom-model"
    )));
    assert!(is_gemini_candidate(&candidate(
        "https://example.invalid/v1",
        "gemini-2.5-pro"
    )));
}

#[test]
fn detects_anthropic_candidates_by_url_or_model_name() {
    assert!(is_anthropic_candidate(&candidate(
        "https://api.anthropic.com/v1",
        "custom-model"
    )));
    assert!(is_anthropic_candidate(&candidate(
        "https://example.invalid/v1",
        "claude-3-7-sonnet"
    )));
}

#[test]
fn keeps_dual_pdf_path_aligned_with_translated_path() {
    let dual = dual_pdf_relative_path("library/papers/example.pdf");
    assert!(dual.ends_with(".dual.pdf"));
    assert!(!dual.contains(".translated.pdf"));
}

#[test]
fn strips_windows_verbatim_prefix_from_runtime_paths() {
    let normalized = normalize_runtime_path_text(Path::new("\\\\?\\C:\\papers\\demo.pdf"));
    assert_eq!(normalized, "C:\\papers\\demo.pdf");
}

#[test]
fn parses_runtime_progress_lines() {
    let parsed = parse_runtime_progress_line(
        "LATOTEX_PROGRESS {\"stage\":\"translating\",\"currentPage\":3,\"totalPages\":12,\"message\":null}",
    )
    .expect("progress payload");
    assert_eq!(parsed.0, 3);
    assert_eq!(parsed.1, 12);
    assert_eq!(parsed.2, "translating");
}
