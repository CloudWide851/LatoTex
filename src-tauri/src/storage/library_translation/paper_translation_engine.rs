use super::{
    TranslationModelCandidate, library_root, library_translation_layout, library_translation_ocr_engine,
    library_translation_render, library_translation_translate, persist_project_translation_glossary,
    refresh_library_index, refresh_workspace_index, resolve_translation_model_candidates,
    resolve_translation_source_pdf_workspace, to_library_relative_from_workspace,
    to_library_workspace_relative, touch_project_updated_at,
};
use crate::secure;
use std::fs;
use std::path::Path;

pub(super) fn translate_library_document(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
) -> Result<crate::models::LibraryTranslateResponse, String> {
    translate_library_document_with_progress(
        db_path,
        runtime_root,
        project_id,
        relative_path,
        target_language,
        model_override,
        |_current, _total, _stage| {},
    )
}

pub(super) fn translate_library_document_with_progress<F>(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
    mut on_progress: F,
) -> Result<crate::models::LibraryTranslateResponse, String>
where
    F: FnMut(u32, u32, &str),
{
    let project_root = super::load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let source_pdf_workspace_relative =
        resolve_translation_source_pdf_workspace(db_path, project_id, relative_path)?;
    let source_pdf_relative = to_library_relative_from_workspace(&source_pdf_workspace_relative)?;

    on_progress(0, 0, "extracting");
    let extraction = library_translation_ocr_engine::extract_document(
        &project_root,
        &papers_root,
        &source_pdf_relative,
    )?;
    let layout_plan = library_translation_layout::build_layout_plan(&extraction);

    let target_lang = library_translation_ocr_engine::normalize_target_language(target_language);
    let model_candidates = resolve_translation_model_candidates(db_path, model_override)?;
    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    };

    let mut translated_result = None;
    let mut resolved_model: Option<TranslationModelCandidate> = None;
    let mut errors = Vec::<String>::new();

    for (index, candidate) in model_candidates.iter().enumerate() {
        on_progress(
            0,
            0,
            &format!(
                "model:{} ({}/{})",
                candidate.model_id,
                index + 1,
                model_candidates.len()
            ),
        );

        let api_key = match secure::get_model_api_key(&secure_context, &candidate.model_id) {
            Ok(value) => value.api_key.filter(|key| !key.trim().is_empty()),
            Err(error) => {
                errors.push(format!("{}: {}", candidate.model_id, error));
                None
            }
        };

        let Some(api_key) = api_key else {
            errors.push(format!("{}: translation.model_api_key_missing", candidate.model_id));
            continue;
        };

        match library_translation_translate::translate_layout_plan(
            db_path,
            project_id,
            &candidate.protocol_id,
            &candidate.base_url,
            &api_key,
            &candidate.model_name,
            &target_lang,
            &extraction,
            &layout_plan,
            |current, total, stage| on_progress(current, total, stage),
        ) {
            Ok(translated) => {
                translated_result = Some(translated);
                resolved_model = Some(candidate.clone());
                break;
            }
            Err(error) => {
                errors.push(format!("{}: {}", candidate.model_id, error));
            }
        }
    }

    let translated = translated_result.ok_or_else(|| {
        format!(
            "translation.failed_after_fallback: {}",
            if errors.is_empty() {
                "unknown".to_string()
            } else {
                errors.join(" | ")
            }
        )
    })?;

    on_progress(0, 0, "rendering");
    let persist = library_translation_render::persist_translation_result(
        &papers_root,
        &extraction,
        &layout_plan,
        &translated,
        &source_pdf_relative,
    )?;

    let _ = persist_project_translation_glossary(
        &project_root,
        &extraction.normalized_relative_path,
        &target_lang,
        &translated.glossary,
    );

    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;
    touch_project_updated_at(db_path, project_id)?;

    let translated_pdf_workspace_relative =
        to_library_workspace_relative(&persist.primary_relative_path);
    let model_tag = resolved_model
        .as_ref()
        .map(|item| item.model_id.clone())
        .unwrap_or_else(|| "unknown".to_string());

    on_progress(0, 0, "completed");
    Ok(crate::models::LibraryTranslateResponse {
        relative_path: translated_pdf_workspace_relative.clone(),
        source_kind: extraction.source_kind.clone(),
        engine: format!("latotex.local.translation.pipeline.v4.pdf+{model_tag}"),
        artifact_paths: Vec::new(),
        detected_language: extraction.detected_language.clone(),
        extraction_engine: extraction.extraction_engine.clone(),
        extraction_mode: extraction.extraction_mode.clone(),
        refined_by_search: translated.refined_by_search,
        glossary_count: translated.glossary.len() as u32,
        translated_pdf_relative_path: translated_pdf_workspace_relative,
        source_pdf_relative_path: source_pdf_workspace_relative,
        page_count: extraction.page_count,
        ocr_page_count: extraction.ocr_page_count,
        layout_mode: if extraction.source_kind == "pdf" {
            "near-original".to_string()
        } else {
            "reflow".to_string()
        },
    })
}
