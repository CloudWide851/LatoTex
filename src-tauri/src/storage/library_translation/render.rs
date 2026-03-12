use super::library_translation_types::{
    TranslationExtraction, TranslationLayoutPlan, TranslationLayoutResult, TranslationPersistResult,
};
use serde_json::json;
use std::fs;
use std::path::{Path, PathBuf};

fn escape_html(input: &str) -> String {
    input
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn render_markdown_output(
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
) -> String {
    let mut lines = vec![format!("# {}", extraction.title_hint)];
    for section in &layout.sections {
        let translated_section = translated.sections.iter().find(|item| item.id == section.id);
        let title = translated_section
            .map(|item| item.title.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(section.title.as_str());
        let text = translated_section
            .map(|item| item.translated_text.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        lines.push(format!("\n## {title}\n"));
        lines.push(text.to_string());
    }
    if !translated.glossary.is_empty() {
        lines.push("\n## Glossary\n".to_string());
        for item in translated.glossary.iter().take(60) {
            lines.push(format!("- {} => {}", item.source_term, item.target_term));
        }
    }
    lines.join("\n")
}

fn render_html_output(
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
) -> String {
    let mut sections_html = String::new();
    for section in &layout.sections {
        let translated_section = translated.sections.iter().find(|item| item.id == section.id);
        let title = translated_section
            .map(|item| item.title.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or(section.title.as_str());
        let text = translated_section
            .map(|item| item.translated_text.trim())
            .filter(|value| !value.is_empty())
            .unwrap_or("");
        let confidence = translated_section
            .and_then(|item| item.confidence)
            .map(|value| format!("{value:.2}"))
            .unwrap_or_else(|| "-".to_string());
        sections_html.push_str(&format!(
            "<section class=\"section\" data-id=\"{}\">\n<h2>{}</h2>\n<div class=\"meta\">confidence: {}</div>\n<article>{}</article>\n</section>\n",
            escape_html(&section.id),
            escape_html(title),
            confidence,
            escape_html(text).replace('\n', "<br/>")
        ));
    }

    let glossary_html = if translated.glossary.is_empty() {
        String::new()
    } else {
        let mut lines = String::new();
        for item in translated.glossary.iter().take(120) {
            lines.push_str(&format!(
                "<li><code>{}</code> → <code>{}</code></li>",
                escape_html(&item.source_term),
                escape_html(&item.target_term)
            ));
        }
        format!("<section class=\"glossary\"><h2>Glossary</h2><ul>{lines}</ul></section>")
    };

    format!(
        "<!doctype html>
<html>
<head>
<meta charset=\"utf-8\" />
<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\" />
<title>{}</title>
<style>
body {{ font-family: 'Segoe UI', system-ui, sans-serif; margin: 0; background: #f4f8fb; color: #1f2d3d; }}
main {{ max-width: 980px; margin: 20px auto; background: #fff; border: 1px solid #d9e3f0; border-radius: 12px; padding: 20px; }}
h1 {{ margin-top: 0; }}
.section {{ border-top: 1px solid #e7edf6; padding-top: 14px; margin-top: 14px; }}
.meta {{ color: #60758f; font-size: 12px; margin-bottom: 8px; }}
article {{ line-height: 1.68; white-space: normal; }}
.glossary ul {{ margin: 8px 0 0 18px; }}
.glossary li {{ line-height: 1.5; }}
code {{ background: #eef4ff; padding: 1px 4px; border-radius: 4px; }}
</style>
</head>
<body>
<main>
<h1>{}</h1>
<div class=\"meta\">sourceKind={} · extractionEngine={} · detectedLanguage={}</div>
{}
{}
</main>
</body>
</html>",
        escape_html(&extraction.title_hint),
        escape_html(&extraction.title_hint),
        escape_html(&extraction.source_kind),
        escape_html(extraction.extraction_engine.as_deref().unwrap_or("unknown")),
        escape_html(extraction.detected_language.as_deref().unwrap_or("unknown")),
        sections_html,
        glossary_html,
    )
}

fn write_artifact(path: &Path, content: &str) -> Result<String, String> {
    fs::write(path, content).map_err(|e| e.to_string())?;
    Ok(path.to_string_lossy().replace('\\', "/"))
}

fn to_relative(papers_root: &Path, path: &PathBuf) -> Result<String, String> {
    path
        .strip_prefix(papers_root)
        .map_err(|_| "translation.output_path_failed".to_string())
        .map(|value| value.to_string_lossy().replace('\\', "/"))
}

pub(super) fn persist_translation_result(
    papers_root: &Path,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    translated: &TranslationLayoutResult,
) -> Result<TranslationPersistResult, String> {
    let source_stem = Path::new(&extraction.normalized_relative_path)
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("paper");
    let target_stem = format!(
        "{}.translated",
        super::slugify_name(source_stem, "paper-translated")
    );

    let markdown_output = render_markdown_output(extraction, layout, translated);
    if markdown_output.trim().is_empty() {
        return Err("translation.empty_output".to_string());
    }

    let md_path = super::unique_path_with_extension(papers_root, &target_stem, "md");
    write_artifact(&md_path, &markdown_output)?;

    let html_path = md_path.with_extension("html");
    let html_output = render_html_output(extraction, layout, translated);
    write_artifact(&html_path, &html_output)?;

    let sidecar = md_path.with_extension("layout.json");
    let sidecar_payload = json!({
      "sourcePath": extraction.normalized_relative_path,
      "sourceKind": extraction.source_kind,
      "detectedLanguage": extraction.detected_language,
      "extractionEngine": extraction.extraction_engine,
      "layout": layout,
      "resultSections": translated.sections,
      "glossary": translated.glossary,
      "uncertainTerms": translated.uncertain_terms,
      "memoryHits": translated.memory_hits,
      "refinedBySearch": translated.refined_by_search,
    });
    let serialized = serde_json::to_string_pretty(&sidecar_payload).map_err(|e| e.to_string())?;
    fs::write(&sidecar, serialized).map_err(|e| e.to_string())?;

    let primary_relative = to_relative(papers_root, &md_path)?;
    let html_relative = to_relative(papers_root, &html_path)?;
    let sidecar_relative = to_relative(papers_root, &sidecar)?;

    Ok(TranslationPersistResult {
        primary_relative_path: primary_relative,
        artifact_paths: vec![html_relative, sidecar_relative],
    })
}
