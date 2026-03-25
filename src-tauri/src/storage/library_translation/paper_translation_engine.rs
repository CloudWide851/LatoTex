use super::{
    TranslationModelCandidate, library_root, refresh_library_index, refresh_workspace_index,
    resolve_translation_model_candidates, resolve_translation_source_pdf_workspace,
    to_library_relative_from_workspace, to_library_workspace_relative, touch_project_updated_at,
    translation_pdf_relative_path,
};
use crate::commands::native_runtime::{
    configure_hidden_process, ensure_analysis_env_blocking, resolve_analysis_runtime_root,
};
use crate::secure;
use serde::Deserialize;
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use uuid::Uuid;

#[derive(Clone)]
struct PdfMathTranslateServiceConfig {
    kind: String,
    base_url: Option<String>,
    api_key: Option<String>,
    model: Option<String>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperRuntimeTranslateResult {
    engine: String,
    page_count: u32,
    ocr_page_count: u32,
    detected_language: Option<String>,
    extraction_engine: Option<String>,
    extraction_mode: Option<String>,
    layout_mode: Option<String>,
    refined_by_search: Option<bool>,
    glossary_count: Option<u32>,
    mono_pdf: Option<String>,
    dual_pdf: Option<String>,
    #[serde(rename = "artifactPaths")]
    _artifact_paths: Option<Vec<String>>,
}

fn preferred_target_language(target_language: Option<&str>) -> String {
    let value = target_language.unwrap_or("").trim();
    if value.is_empty() {
        "Chinese (Simplified)".to_string()
    } else {
        value.to_string()
    }
}

fn is_gemini_candidate(candidate: &TranslationModelCandidate) -> bool {
    let base_url = candidate.base_url.to_lowercase();
    let model_name = candidate.model_name.to_lowercase();
    base_url.contains("googleapis.com")
        || base_url.contains("generativelanguage")
        || model_name.contains("gemini")
}

fn is_anthropic_candidate(candidate: &TranslationModelCandidate) -> bool {
    let base_url = candidate.base_url.to_lowercase();
    let model_name = candidate.model_name.to_lowercase();
    base_url.contains("anthropic") || model_name.contains("claude")
}

fn resolve_service_configs(
    db_path: &Path,
    app_runtime_root: &Path,
    model_override: Option<&str>,
) -> Vec<PdfMathTranslateServiceConfig> {
    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: app_runtime_root.to_path_buf(),
    };
    let mut configs = Vec::<PdfMathTranslateServiceConfig>::new();

    if let Ok(candidates) = resolve_translation_model_candidates(db_path, model_override) {
        for candidate in candidates {
            let api_key = secure::get_model_api_key(&secure_context, &candidate.model_id)
                .ok()
                .and_then(|value| value.api_key)
                .filter(|value| !value.trim().is_empty());
            if api_key.is_none() {
                continue;
            }
            if is_anthropic_candidate(&candidate) {
                continue;
            }
            if is_gemini_candidate(&candidate) {
                configs.push(PdfMathTranslateServiceConfig {
                    kind: "gemini".to_string(),
                    base_url: None,
                    api_key,
                    model: Some(candidate.model_name.clone()),
                });
                continue;
            }
            configs.push(PdfMathTranslateServiceConfig {
                kind: "openai".to_string(),
                base_url: Some(candidate.base_url.clone()),
                api_key,
                model: Some(candidate.model_name.clone()),
            });
        }
    }

    configs.push(PdfMathTranslateServiceConfig {
        kind: "google".to_string(),
        base_url: None,
        api_key: None,
        model: None,
    });
    configs
}

fn copy_generated_pdf(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    fs::copy(source, target).map_err(|error| error.to_string())?;
    Ok(())
}

fn dual_pdf_relative_path(source_pdf_relative: &str) -> String {
    translation_pdf_relative_path(source_pdf_relative).replace(".translated.pdf", ".dual.pdf")
}

fn run_pdfmathtranslate_bridge(
    python_path: &Path,
    runtime_root: &Path,
    run_root: &Path,
    source_pdf_path: &Path,
    target_language: &str,
    service: &PdfMathTranslateServiceConfig,
) -> Result<PaperRuntimeTranslateResult, String> {
    let input_path = run_root.join("paper-runtime-input.json");
    let output_path = run_root.join("paper-runtime-output.json");
    let generated_dir = run_root.join("generated");
    fs::create_dir_all(&generated_dir).map_err(|error| error.to_string())?;

    let payload = json!({
        "operation": "translate",
        "pdfPath": source_pdf_path,
        "outputDir": generated_dir,
        "targetLanguage": target_language,
        "service": {
            "kind": service.kind,
            "baseUrl": service.base_url,
            "apiKey": service.api_key,
            "model": service.model,
        }
    });
    fs::write(
        &input_path,
        serde_json::to_string_pretty(&payload).map_err(|error| error.to_string())?,
    )
    .map_err(|error| error.to_string())?;

    let mut command = Command::new(python_path);
    configure_hidden_process(&mut command);
    let output = command
        .arg(runtime_root.join("paper_runtime.py"))
        .arg("--input")
        .arg(&input_path)
        .arg("--output")
        .arg(&output_path)
        .output()
        .map_err(|error| format!("translation.python.spawn_failed: {error}"))?;
    if !output.status.success() {
        let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
        let stdout = String::from_utf8_lossy(&output.stdout).trim().to_string();
        let detail = if !stderr.is_empty() { stderr } else { stdout };
        return Err(format!("translation.pdfmathtranslate.failed: {detail}"));
    }

    let output_json = fs::read_to_string(&output_path).map_err(|error| error.to_string())?;
    serde_json::from_str(&output_json)
        .map_err(|error| format!("translation.pdfmathtranslate.invalid_json: {error}"))
}

pub(super) fn translate_library_document(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
) -> Result<crate::models::LibraryTranslateResponse, String> {
    translate_library_document_with_progress(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        relative_path,
        target_language,
        model_override,
        |_current, _total, _stage| {},
    )
}

pub(super) fn translate_library_document_with_progress<F>(
    db_path: &Path,
    app_runtime_root: &Path,
    app_data_dir: &Path,
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
    fs::create_dir_all(&papers_root).map_err(|error| error.to_string())?;

    let source_pdf_workspace_relative =
        resolve_translation_source_pdf_workspace(db_path, project_id, relative_path)?;
    let source_pdf_relative = to_library_relative_from_workspace(&source_pdf_workspace_relative)?;
    let source_pdf_path = papers_root.join(Path::new(&source_pdf_relative));
    if !source_pdf_path.exists() || !source_pdf_path.is_file() {
        return Err("translation.source_pdf_not_found".to_string());
    }

    on_progress(0, 0, "preparing");
    let env_status = ensure_analysis_env_blocking(app_data_dir, &project_root)?;
    let python_path = PathBuf::from(
        env_status
            .python_path
            .clone()
            .ok_or_else(|| "python.env.python_missing".to_string())?,
    );
    let analysis_runtime_root = resolve_analysis_runtime_root()
        .ok_or_else(|| "Python analysis runtime resources were not found".to_string())?;
    let target_language = preferred_target_language(target_language);
    let service_configs = resolve_service_configs(db_path, app_runtime_root, model_override);
    let run_root = project_root
        .join(".latotex")
        .join("paper-runtime")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&run_root).map_err(|error| error.to_string())?;

    let mut last_error = None;
    let mut translated = None;
    for service in service_configs {
        if let Some(model_name) = &service.model {
            on_progress(0, 0, &format!("model:{model_name}"));
        }
        on_progress(0, 0, "translating");
        match run_pdfmathtranslate_bridge(
            &python_path,
            &analysis_runtime_root,
            &run_root,
            &source_pdf_path,
            &target_language,
            &service,
        ) {
            Ok(result) => {
                translated = Some(result);
                break;
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    let translated = translated.ok_or_else(|| {
        last_error.unwrap_or_else(|| "translation.pdfmathtranslate.unavailable".to_string())
    })?;

    let mono_pdf = PathBuf::from(
        translated
            .mono_pdf
            .clone()
            .ok_or_else(|| "translation.pdfmathtranslate.mono_missing".to_string())?,
    );
    let translated_relative = translation_pdf_relative_path(&source_pdf_relative);
    let translated_abs = papers_root.join(Path::new(&translated_relative));

    on_progress(0, translated.page_count.max(1), "rendering");
    copy_generated_pdf(&mono_pdf, &translated_abs)?;

    let mut artifact_paths = Vec::<String>::new();
    if let Some(dual_pdf) = translated.dual_pdf.as_ref() {
        let dual_abs = PathBuf::from(dual_pdf);
        if dual_abs.exists() {
            let dual_relative = dual_pdf_relative_path(&source_pdf_relative);
            let dual_target = papers_root.join(Path::new(&dual_relative));
            copy_generated_pdf(&dual_abs, &dual_target)?;
            artifact_paths.push(to_library_workspace_relative(&dual_relative));
        }
    }


    refresh_workspace_index(&project_root)?;
    refresh_library_index(&project_root)?;
    touch_project_updated_at(db_path, project_id)?;

    let translated_pdf_workspace_relative = to_library_workspace_relative(&translated_relative);

    on_progress(translated.page_count, translated.page_count.max(1), "completed");
    Ok(crate::models::LibraryTranslateResponse {
        relative_path: translated_pdf_workspace_relative.clone(),
        source_kind: "pdf".to_string(),
        engine: translated.engine,
        artifact_paths,
        detected_language: translated.detected_language,
        extraction_engine: translated.extraction_engine,
        extraction_mode: translated.extraction_mode,
        refined_by_search: translated.refined_by_search.unwrap_or(false),
        glossary_count: translated.glossary_count.unwrap_or(0),
        translated_pdf_relative_path: translated_pdf_workspace_relative,
        source_pdf_relative_path: source_pdf_workspace_relative,
        page_count: translated.page_count,
        ocr_page_count: translated.ocr_page_count,
        layout_mode: translated.layout_mode.unwrap_or_else(|| "near-original".to_string()),
    })
}

#[cfg(test)]
mod tests {
    use super::{
        dual_pdf_relative_path, is_anthropic_candidate, is_gemini_candidate,
        preferred_target_language,
    };
    use crate::storage::TranslationModelCandidate;

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
        assert_eq!(preferred_target_language(Some("  ")), "Chinese (Simplified)");
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
}


