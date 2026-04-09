use super::{
    LibraryTranslateFailure, TranslationModelCandidate, library_root, refresh_library_index,
    refresh_workspace_index, resolve_translation_model_candidates,
    resolve_translation_source_pdf_workspace, to_library_relative_from_workspace,
    to_library_workspace_relative, touch_project_updated_at, translation_pdf_relative_path,
};
use crate::commands::native_runtime::{
    configure_hidden_process, ensure_analysis_env_blocking, resolve_analysis_runtime_root,
};
use crate::secure;
use serde::Deserialize;
use serde_json::{Value, json};
use std::fs;
use std::io::{BufRead, BufReader, Read};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::{Arc, Mutex, mpsc};
use std::thread;
use std::time::Duration;
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
struct PaperRuntimeErrorPayload {
    code: String,
    message: String,
    #[serde(default)]
    diagnostics: Vec<String>,
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

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct PaperRuntimeProgressPayload {
    stage: String,
    current_page: Option<u32>,
    total_pages: Option<u32>,
    message: Option<String>,
}

const PAPER_RUNTIME_PROGRESS_PREFIX: &str = "LATOTEX_PROGRESS ";

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

fn summarize_output(label: &str, bytes: &[u8]) -> Option<String> {
    let text = String::from_utf8_lossy(bytes).trim().to_string();
    if text.is_empty() {
        return None;
    }
    let compact = text.replace('\r', " ").replace('\n', " | ");
    let tail = if compact.len() > 600 {
        compact[compact.len() - 600..].to_string()
    } else {
        compact
    };
    Some(format!("{label}={tail}"))
}

fn normalize_runtime_path_text(path: &Path) -> String {
    let text = path.to_string_lossy();
    #[cfg(target_os = "windows")]
    {
        if let Some(stripped) = text.strip_prefix("\\\\?\\UNC\\") {
            return format!("\\\\{}", stripped);
        }
        if let Some(stripped) = text.strip_prefix("\\\\?\\") {
            return stripped.to_string();
        }
    }
    text.to_string()
}

fn resolve_service_configs(
    db_path: &Path,
    app_runtime_root: &Path,
    model_override: Option<&str>,
) -> Result<Vec<PdfMathTranslateServiceConfig>, LibraryTranslateFailure> {
    let secure_context = secure::SecureStorageContext {
        db_path: db_path.to_path_buf(),
        runtime_root: app_runtime_root.to_path_buf(),
    };
    let candidates = resolve_translation_model_candidates(db_path, model_override)?;
    let mut configs = Vec::<PdfMathTranslateServiceConfig>::new();
    let mut diagnostics = Vec::<String>::new();

    for candidate in candidates {
        let model_label = format!("{} ({})", candidate.model_name, candidate.model_id);
        let api_key = secure::get_model_api_key(&secure_context, &candidate.model_id)
            .ok()
            .and_then(|value| value.api_key)
            .filter(|value| !value.trim().is_empty());
        if api_key.is_none() {
            diagnostics.push(format!("skip model={model_label}: api_key_missing"));
            continue;
        }
        if is_anthropic_candidate(&candidate) {
            diagnostics.push(format!("skip model={model_label}: unsupported_provider=anthropic"));
            continue;
        }
        if is_gemini_candidate(&candidate) {
            diagnostics.push(format!("use model={model_label}: provider=gemini"));
            configs.push(PdfMathTranslateServiceConfig {
                kind: "gemini".to_string(),
                base_url: None,
                api_key,
                model: Some(candidate.model_name.clone()),
            });
            continue;
        }
        diagnostics.push(format!(
            "use model={model_label}: provider=openai-compatible base_url={}",
            candidate.base_url
        ));
        configs.push(PdfMathTranslateServiceConfig {
            kind: "openai".to_string(),
            base_url: Some(candidate.base_url.clone()),
            api_key,
            model: Some(candidate.model_name.clone()),
        });
    }

    if configs.is_empty() {
        return Err(LibraryTranslateFailure::new(
            "translation.provider.unconfigured",
            "No compatible translation model with configured API key was found for paper translation.",
            diagnostics,
        ));
    }

    Ok(configs)
}

fn copy_generated_pdf(source: &Path, target: &Path) -> Result<(), LibraryTranslateFailure> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent)
            .map_err(|error| LibraryTranslateFailure::new("translation.fs.create_dir_failed", error.to_string(), Vec::new()))?;
    }
    fs::copy(source, target)
        .map_err(|error| LibraryTranslateFailure::new("translation.fs.copy_failed", error.to_string(), Vec::new()))?;
    Ok(())
}

fn dual_pdf_relative_path(source_pdf_relative: &str) -> String {
    translation_pdf_relative_path(source_pdf_relative).replace(".translated.pdf", ".dual.pdf")
}

fn parse_runtime_failure(
    output_json: Option<&str>,
    stdout: &[u8],
    stderr: &[u8],
) -> Option<LibraryTranslateFailure> {
    let raw = output_json?.trim();
    if raw.is_empty() {
        return None;
    }
    let value = serde_json::from_str::<Value>(raw).ok()?;
    if value.get("status").and_then(|item| item.as_str()) != Some("failed") {
        return None;
    }
    let error = serde_json::from_value::<PaperRuntimeErrorPayload>(value.get("error")?.clone()).ok()?;
    let mut diagnostics = error.diagnostics;
    if let Some(item) = summarize_output("stdout", stdout) {
        diagnostics.push(item);
    }
    if let Some(item) = summarize_output("stderr", stderr) {
        diagnostics.push(item);
    }
    Some(LibraryTranslateFailure::new(error.code, error.message, diagnostics))
}

fn run_pdfmathtranslate_bridge<F>(
    python_path: &Path,
    runtime_root: &Path,
    run_root: &Path,
    source_pdf_path: &Path,
    target_language: &str,
    service: &PdfMathTranslateServiceConfig,
    mut on_progress: F,
) -> Result<PaperRuntimeTranslateResult, LibraryTranslateFailure>
where
    F: FnMut(u32, u32, &str),
{
    let input_path = run_root.join("paper-runtime-input.json");
    let output_path = run_root.join("paper-runtime-output.json");
    let generated_dir = run_root.join("generated");
    fs::create_dir_all(&generated_dir).map_err(|error| {
        LibraryTranslateFailure::new("translation.fs.create_dir_failed", error.to_string(), Vec::new())
    })?;

    let payload = json!({
        "operation": "translate",
        "pdfPath": normalize_runtime_path_text(source_pdf_path),
        "outputDir": normalize_runtime_path_text(&generated_dir),
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
        serde_json::to_string_pretty(&payload).map_err(|error| {
            LibraryTranslateFailure::new("translation.payload.serialize_failed", error.to_string(), Vec::new())
        })?,
    )
    .map_err(|error| LibraryTranslateFailure::new("translation.fs.write_failed", error.to_string(), Vec::new()))?;

    let mut command = Command::new(python_path);
    configure_hidden_process(&mut command);
    let mut child = command
        .arg(runtime_root.join("paper_runtime.py"))
        .arg("--input")
        .arg(&input_path)
        .arg("--output")
        .arg(&output_path)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            LibraryTranslateFailure::new(
                "translation.python.spawn_failed",
                error.to_string(),
                vec![
                    format!("python={}", python_path.to_string_lossy()),
                    format!("runtime_root={}", runtime_root.to_string_lossy()),
                ],
            )
        })?;

    let stdout = child.stdout.take().ok_or_else(|| {
        LibraryTranslateFailure::new(
            "translation.python.stdout_unavailable",
            "paper_runtime.py stdout stream was unavailable.",
            Vec::new(),
        )
    })?;
    let stderr = child.stderr.take().ok_or_else(|| {
        LibraryTranslateFailure::new(
            "translation.python.stderr_unavailable",
            "paper_runtime.py stderr stream was unavailable.",
            Vec::new(),
        )
    })?;
    let stdout_buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
    let stderr_buffer = Arc::new(Mutex::new(Vec::<u8>::new()));
    let (progress_tx, progress_rx) = mpsc::channel::<(u32, u32, String)>();
    let stdout_handle =
        spawn_runtime_output_reader(stdout, stdout_buffer.clone(), progress_tx.clone());
    let stderr_handle =
        spawn_runtime_output_reader(stderr, stderr_buffer.clone(), progress_tx.clone());
    drop(progress_tx);

    let status = loop {
        while let Ok((current, total, stage)) = progress_rx.try_recv() {
            on_progress(current, total, &stage);
        }
        match child.try_wait().map_err(|error| {
            LibraryTranslateFailure::new(
                "translation.python.wait_failed",
                error.to_string(),
                Vec::new(),
            )
        })? {
            Some(status) => break status,
            None => thread::sleep(Duration::from_millis(60)),
        }
    };

    while let Ok((current, total, stage)) = progress_rx.try_recv() {
        on_progress(current, total, &stage);
    }
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    let stdout = stdout_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();
    let stderr = stderr_buffer
        .lock()
        .map(|value| value.clone())
        .unwrap_or_default();

    let output_json = fs::read_to_string(&output_path).ok();
    if !status.success() {
        if let Some(failure) = parse_runtime_failure(output_json.as_deref(), &stdout, &stderr) {
            return Err(failure);
        }
        let mut diagnostics = Vec::new();
        diagnostics.push(format!("exit_code={}", status.code().unwrap_or(-1)));
        if let Some(item) = summarize_output("stdout", &stdout) {
            diagnostics.push(item);
        }
        if let Some(item) = summarize_output("stderr", &stderr) {
            diagnostics.push(item);
        }
        return Err(LibraryTranslateFailure::new(
            "translation.pdfmathtranslate.failed",
            "pdf2zh exited with a non-zero status.",
            diagnostics,
        ));
    }

    let output_json = output_json.ok_or_else(|| {
        LibraryTranslateFailure::new(
            "translation.pdfmathtranslate.output_missing",
            "paper_runtime.py did not produce an output payload.",
            Vec::new(),
        )
    })?;
    if let Some(failure) = parse_runtime_failure(Some(&output_json), &stdout, &stderr) {
        return Err(failure);
    }
    serde_json::from_str(&output_json).map_err(|error| {
        let mut diagnostics = Vec::new();
        if let Some(item) = summarize_output("stdout", &stdout) {
            diagnostics.push(item);
        }
        if let Some(item) = summarize_output("stderr", &stderr) {
            diagnostics.push(item);
        }
        LibraryTranslateFailure::new(
            "translation.pdfmathtranslate.invalid_json",
            error.to_string(),
            diagnostics,
        )
    })
}

pub(super) fn translate_library_document(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    relative_path: &str,
    target_language: Option<&str>,
    model_override: Option<&str>,
) -> Result<crate::models::LibraryTranslateResponse, LibraryTranslateFailure> {
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
) -> Result<crate::models::LibraryTranslateResponse, LibraryTranslateFailure>
where
    F: FnMut(u32, u32, &str),
{
    let project_root = super::load_project_root(db_path, project_id)
        .map_err(LibraryTranslateFailure::from_message)?;
    let papers_root = library_root(&project_root);
    fs::create_dir_all(&papers_root)
        .map_err(|error| LibraryTranslateFailure::new("translation.fs.create_dir_failed", error.to_string(), Vec::new()))?;

    let source_pdf_workspace_relative =
        resolve_translation_source_pdf_workspace(db_path, project_id, relative_path)?;
    let source_pdf_relative = to_library_relative_from_workspace(&source_pdf_workspace_relative)?;
    let source_pdf_path = papers_root.join(Path::new(&source_pdf_relative));
    if !source_pdf_path.exists() || !source_pdf_path.is_file() {
        return Err(LibraryTranslateFailure::from_message(
            "translation.source_pdf_not_found",
        ));
    }

    on_progress(0, 0, "preparing");
    let env_status = ensure_analysis_env_blocking(
        db_path,
        app_runtime_root,
        app_data_dir,
        project_id,
        &project_root,
    )
    .map_err(LibraryTranslateFailure::from_message)?;
    let python_path = PathBuf::from(env_status.python_path.clone().ok_or_else(|| {
        LibraryTranslateFailure::from_message("python.env.python_missing")
    })?);
    let analysis_runtime_root = resolve_analysis_runtime_root().ok_or_else(|| {
        LibraryTranslateFailure::new(
            "translation.python.runtime_root_missing",
            "Python analysis runtime resources were not found.",
            Vec::new(),
        )
    })?;
    let target_language = preferred_target_language(target_language);
    let service_configs = resolve_service_configs(db_path, app_runtime_root, model_override)?;
    let run_root = project_root
        .join(".latotex")
        .join("paper-runtime")
        .join(Uuid::new_v4().to_string());
    fs::create_dir_all(&run_root)
        .map_err(|error| LibraryTranslateFailure::new("translation.fs.create_dir_failed", error.to_string(), Vec::new()))?;

    let mut last_error = None;
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
            |current, total, stage| on_progress(current, total, stage),
        ) {
            Ok(translated) => {
                let mono_pdf = PathBuf::from(translated.mono_pdf.clone().ok_or_else(|| {
                    LibraryTranslateFailure::from_message("translation.pdfmathtranslate.mono_missing")
                })?);
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

                refresh_workspace_index(&project_root).map_err(LibraryTranslateFailure::from_message)?;
                refresh_library_index(&project_root).map_err(LibraryTranslateFailure::from_message)?;
                touch_project_updated_at(db_path, project_id).map_err(LibraryTranslateFailure::from_message)?;

                let translated_pdf_workspace_relative =
                    to_library_workspace_relative(&translated_relative);

                on_progress(translated.page_count, translated.page_count.max(1), "completed");
                return Ok(crate::models::LibraryTranslateResponse {
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
                });
            }
            Err(error) => {
                last_error = Some(error);
            }
        }
    }

    Err(last_error.unwrap_or_else(|| {
        LibraryTranslateFailure::new(
            "translation.provider.unconfigured",
            "No translation provider attempt succeeded.",
            Vec::new(),
        )
    }))
}

#[cfg(test)]
mod tests {
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
}

fn parse_runtime_progress_line(line: &str) -> Option<(u32, u32, String)> {
    let payload = line.strip_prefix(PAPER_RUNTIME_PROGRESS_PREFIX)?.trim();
    let parsed = serde_json::from_str::<PaperRuntimeProgressPayload>(payload).ok()?;
    let stage = parsed
        .message
        .filter(|value| !value.trim().is_empty())
        .unwrap_or(parsed.stage);
    Some((
        parsed.current_page.unwrap_or(0),
        parsed.total_pages.unwrap_or(0),
        stage,
    ))
}

fn spawn_runtime_output_reader<R: Read + Send + 'static>(
    reader: R,
    sink: Arc<Mutex<Vec<u8>>>,
    progress_tx: mpsc::Sender<(u32, u32, String)>,
) -> thread::JoinHandle<()> {
    thread::spawn(move || {
        let buffered = BufReader::new(reader);
        for line_result in buffered.lines() {
            let line = match line_result {
                Ok(value) => value,
                Err(_) => break,
            };
            if let Some(progress) = parse_runtime_progress_line(&line) {
                let _ = progress_tx.send(progress);
                continue;
            }
            if let Ok(mut bytes) = sink.lock() {
                bytes.extend_from_slice(line.as_bytes());
                bytes.push(b'\n');
            }
        }
    })
}
