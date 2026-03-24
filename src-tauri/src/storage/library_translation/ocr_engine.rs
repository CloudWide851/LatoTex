use super::library_translation_extract;
use super::library_translation_types::TranslationExtraction;
use std::path::Path;

pub(super) fn extract_document(
    project_root: &Path,
    papers_root: &Path,
    relative_path: &str,
) -> Result<TranslationExtraction, String> {
    library_translation_extract::extract_translation_source(project_root, papers_root, relative_path)
}

pub(super) fn normalize_target_language(target_language: Option<&str>) -> String {
    library_translation_extract::normalize_target_language(target_language)
}
