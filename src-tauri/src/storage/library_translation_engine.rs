#[path = "library_translation/types.rs"]
mod library_translation_types;
#[path = "library_translation/ocr.rs"]
mod library_translation_ocr;
#[path = "library_translation/memory.rs"]
mod library_translation_memory;
#[path = "library_translation/extract.rs"]
mod library_translation_extract;
#[path = "library_translation/layout.rs"]
mod library_translation_layout;
#[path = "library_translation/translate.rs"]
mod library_translation_translate;
#[path = "library_translation/render.rs"]
mod library_translation_render;

fn persist_project_translation_glossary(
    project_root: &Path,
    source_relative_path: &str,
    target_lang: &str,
    glossary: &[library_translation_types::TranslationGlossaryEntry],
) -> Result<(), String> {
    if glossary.is_empty() {
        return Ok(());
    }

    let glossary_path = project_root
        .join(".latotex")
        .join("memory")
        .join("translation-glossary.md");
    if let Some(parent) = glossary_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }

    let mut existing = fs::read_to_string(&glossary_path).unwrap_or_default();
    if existing.trim().is_empty() {
        existing = "# Translation Glossary\n\n".to_string();
    }

    let mut lines = Vec::new();
    lines.push(format!(
        "## {} · {} · {}",
        chrono::Utc::now().to_rfc3339(),
        source_relative_path,
        target_lang
    ));
    for item in glossary.iter().take(80) {
        lines.push(format!("- {} => {}", item.source_term, item.target_term));
    }
    lines.push(String::new());

    existing.push_str(&lines.join("\n"));

    // Bound file size to avoid long-session memory growth.
    let max_chars = 120_000;
    if existing.chars().count() > max_chars {
        let tail: String = existing
            .chars()
            .rev()
            .take(max_chars)
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        existing = format!("# Translation Glossary\n\n...[truncated]...\n\n{}", tail);
    }

    fs::write(glossary_path, existing).map_err(|e| e.to_string())
}

pub fn translate_library_document(
    db_path: &Path,
    runtime_root: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
) -> Result<crate::models::LibraryTranslateResponse, String> {
    let project_root = load_project_root(db_path, project_id)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root).map_err(|e| e.to_string())?;

    let extraction = library_translation_extract::extract_translation_source(
        &project_root,
        &papers_root,
        relative_path,
    )?;
    let layout_plan = library_translation_layout::build_layout_plan(&extraction);

    let (protocol_id, base_url, model_name, model_id) =
        resolve_agent_model(db_path, "task", model_override)?;
    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: runtime_root.to_path_buf(),
    };
    let api_key = secure::get_model_api_key(&secure_context, &model_id)?
        .api_key
        .filter(|value| !value.trim().is_empty())
        .ok_or_else(|| "translation.model_api_key_missing".to_string())?;
    let target_lang = library_translation_extract::normalize_target_language(target_language);

    let translated = library_translation_translate::translate_layout_plan(
        db_path,
        project_id,
        &protocol_id,
        &base_url,
        &api_key,
        &model_name,
        &target_lang,
        &extraction,
        &layout_plan,
    )?;

    let persist = library_translation_render::persist_translation_result(
        &papers_root,
        &extraction,
        &layout_plan,
        &translated,
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

    Ok(crate::models::LibraryTranslateResponse {
        relative_path: persist.primary_relative_path,
        source_kind: extraction.source_kind,
        engine: "latotex.local.translation.pipeline.v3".to_string(),
        artifact_paths: persist.artifact_paths,
        detected_language: extraction.detected_language,
        extraction_engine: extraction.extraction_engine,
        refined_by_search: translated.refined_by_search,
        glossary_count: translated.glossary.len() as u32,
    })
}
