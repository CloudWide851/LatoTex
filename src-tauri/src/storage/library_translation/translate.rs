use super::library_translation_memory::{
    load_translation_memory_hits, memory_hits_to_prompt_block, persist_translation_glossary,
};
use super::library_translation_types::{
    TranslationExtraction, TranslationGlossaryEntry, TranslationLayoutPlan, TranslationLayoutResult,
    TranslationSectionResult,
};
use serde_json::Value;
use std::collections::{HashMap, HashSet};

struct ParsedPayload {
    sections: Vec<TranslationSectionResult>,
    glossary: Vec<TranslationGlossaryEntry>,
    uncertain_terms: Vec<String>,
}

fn parse_json_candidates(raw: &str) -> Vec<String> {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return Vec::new();
    }
    let mut candidates = vec![trimmed.to_string()];
    let mut rest = trimmed;
    while let Some(start) = rest.find("```") {
        let after = &rest[start + 3..];
        let Some(end) = after.find("```") else {
            break;
        };
        let block = after[..end]
            .trim()
            .trim_start_matches("json")
            .trim()
            .to_string();
        if !block.is_empty() {
            candidates.push(block);
        }
        rest = &after[end + 3..];
    }
    candidates
}

fn normalize_term(candidate: &str) -> Option<String> {
    let trimmed = candidate.trim();
    if trimmed.len() < 2 || trimmed.len() > 80 {
        return None;
    }
    let mut out = String::new();
    for ch in trimmed.chars() {
        if ch.is_alphanumeric()
            || ch == '_'
            || ch == '-'
            || ('\u{4E00}'..='\u{9FFF}').contains(&ch)
            || ch == ' '
        {
            out.push(ch);
        }
    }
    let value = out.trim();
    if value.len() < 2 {
        None
    } else {
        Some(value.to_string())
    }
}

fn is_chinese_target(target_lang: &str) -> bool {
    let lower = target_lang.to_lowercase();
    lower.contains("zh") || lower.contains("chinese") || target_lang.contains('中')
}

fn language_strategy_lines(target_lang: &str) -> Vec<String> {
    if is_chinese_target(target_lang) {
        vec![
            "Output language must be modern technical Simplified Chinese.".to_string(),
            "Do not keep long English sentences untranslated; keep acronyms/symbols, but translate their meaning around them.".to_string(),
            "On first occurrence of technical acronyms, prefer Chinese explanation with acronym in parentheses, e.g.\n“卷积神经网络 (CNN)”.".to_string(),
            "Use Chinese punctuation in narrative prose while preserving formulas, references, and citation syntax.".to_string(),
        ]
    } else {
        vec![
            format!("Output language must be {target_lang} with academic technical style."),
            "Keep scientific notation, variables, and citation/reference markers unchanged.".to_string(),
        ]
    }
}

fn parse_sections(list: &[Value]) -> Vec<TranslationSectionResult> {
    let mut sections = Vec::new();
    for item in list {
        let id = item
            .get("id")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let text = item
            .get("translatedText")
            .or_else(|| item.get("translated_text"))
            .or_else(|| item.get("text"))
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let title = item
            .get("title")
            .and_then(|value| value.as_str())
            .unwrap_or_default()
            .trim()
            .to_string();
        let confidence = item
            .get("confidence")
            .and_then(|value| value.as_f64())
            .map(|value| value.clamp(0.0, 1.0) as f32);
        if id.is_empty() || text.is_empty() {
            continue;
        }
        sections.push(TranslationSectionResult {
            id,
            title,
            translated_text: text,
            confidence,
        });
    }
    sections
}

fn parse_glossary(list: &[Value]) -> Vec<TranslationGlossaryEntry> {
    let mut entries = Vec::new();
    let mut seen = HashSet::<String>::new();
    for item in list {
        let source = item
            .get("sourceTerm")
            .or_else(|| item.get("source_term"))
            .or_else(|| item.get("source"))
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let target = item
            .get("targetTerm")
            .or_else(|| item.get("target_term"))
            .or_else(|| item.get("target"))
            .and_then(|value| value.as_str())
            .unwrap_or_default();
        let Some(source_term) = normalize_term(source) else {
            continue;
        };
        let Some(target_term) = normalize_term(target) else {
            continue;
        };
        let key = format!("{}=>{}", source_term.to_lowercase(), target_term.to_lowercase());
        if !seen.insert(key) {
            continue;
        }
        let confidence = item
            .get("confidence")
            .and_then(|value| value.as_f64())
            .map(|value| value.clamp(0.0, 1.0) as f32);
        entries.push(TranslationGlossaryEntry {
            source_term,
            target_term,
            confidence,
        });
    }
    entries
}

fn parse_uncertain_terms(value: Option<&Value>) -> Vec<String> {
    let Some(array) = value.and_then(|item| item.as_array()) else {
        return Vec::new();
    };
    let mut terms = Vec::new();
    let mut seen = HashSet::<String>::new();
    for item in array {
        let Some(raw) = item.as_str() else {
            continue;
        };
        let Some(term) = normalize_term(raw) else {
            continue;
        };
        if seen.insert(term.to_lowercase()) {
            terms.push(term);
        }
        if terms.len() >= 16 {
            break;
        }
    }
    terms
}

fn parse_payload(raw: &str) -> Option<ParsedPayload> {
    for candidate in parse_json_candidates(raw) {
        let parsed: Value = match serde_json::from_str(&candidate) {
            Ok(value) => value,
            Err(_) => continue,
        };
        let sections_list = if let Some(array) = parsed.as_array() {
            array.clone()
        } else if let Some(array) = parsed.get("sections").and_then(|value| value.as_array()) {
            array.clone()
        } else {
            Vec::new()
        };

        let sections = parse_sections(&sections_list);
        if sections.is_empty() {
            continue;
        }

        let glossary_values = parsed
            .get("glossary")
            .and_then(|value| value.as_array())
            .cloned()
            .unwrap_or_default();
        let glossary = parse_glossary(&glossary_values);
        let uncertain_terms = parse_uncertain_terms(parsed.get("uncertainTerms"));

        return Some(ParsedPayload {
            sections,
            glossary,
            uncertain_terms,
        });
    }
    None
}

fn build_source_for_section(
    section_id: &str,
    layout: &TranslationLayoutPlan,
    block_by_id: &HashMap<&str, &str>,
) -> String {
    let mut text_parts = Vec::<String>::new();
    if let Some((index, section)) = layout
        .sections
        .iter()
        .enumerate()
        .find(|(_, item)| item.id == section_id)
    {
        for block_id in &section.block_ids {
            if let Some(text) = block_by_id.get(block_id.as_str()) {
                text_parts.push((*text).to_string());
            }
        }
        if index > 0 {
            let prev = &layout.sections[index - 1];
            for block_id in &prev.block_ids {
                if let Some(text) = block_by_id.get(block_id.as_str()) {
                    text_parts.push(format!("[prev-context] {}", text));
                    break;
                }
            }
        }
        if index + 1 < layout.sections.len() {
            let next = &layout.sections[index + 1];
            for block_id in &next.block_ids {
                if let Some(text) = block_by_id.get(block_id.as_str()) {
                    text_parts.push(format!("[next-context] {}", text));
                    break;
                }
            }
        }
    }
    text_parts.join("\n\n")
}

fn sections_payload(
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    block_by_id: &HashMap<&str, &str>,
) -> Vec<Value> {
    let mut payload = Vec::new();
    for section in &layout.sections {
        payload.push(serde_json::json!({
            "id": section.id,
            "title": section.title,
            "sourceText": build_source_for_section(&section.id, layout, block_by_id),
            "sourceKind": extraction.source_kind,
            "detectedLanguage": extraction.detected_language,
        }));
    }
    payload
}

fn collect_source_text(extraction: &TranslationExtraction) -> String {
    extraction
        .blocks
        .iter()
        .map(|item| item.text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}

fn parse_or_fallback(
    raw_output: &str,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
) -> ParsedPayload {
    if let Some(parsed) = parse_payload(raw_output) {
        return parsed;
    }
    ParsedPayload {
        sections: vec![TranslationSectionResult {
            id: layout
                .sections
                .first()
                .map(|item| item.id.clone())
                .unwrap_or_else(|| "s-1".to_string()),
            title: extraction.title_hint.clone(),
            translated_text: raw_output.trim().to_string(),
            confidence: Some(0.35),
        }],
        glossary: Vec::new(),
        uncertain_terms: Vec::new(),
    }
}

fn fill_missing_sections(
    parsed: ParsedPayload,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
) -> ParsedPayload {
    let mut by_id = HashMap::<String, TranslationSectionResult>::new();
    for section in parsed.sections {
        by_id.insert(section.id.clone(), section);
    }

    let mut sections = Vec::new();
    for layout_section in &layout.sections {
        if let Some(existing) = by_id.get(&layout_section.id) {
            sections.push(existing.clone());
        } else {
            sections.push(TranslationSectionResult {
                id: layout_section.id.clone(),
                title: layout_section.title.clone(),
                translated_text: format!(
                    "[untranslated]\n{}",
                    extraction
                        .blocks
                        .iter()
                        .find(|block| block.id == layout_section.block_ids[0])
                        .map(|block| block.text.as_str())
                        .unwrap_or("")
                ),
                confidence: Some(0.1),
            });
        }
    }

    ParsedPayload {
        sections,
        glossary: parsed.glossary,
        uncertain_terms: parsed.uncertain_terms,
    }
}

fn collect_auto_uncertain_terms(
    source_text: &str,
    translated_sections: &[TranslationSectionResult],
    glossary: &[TranslationGlossaryEntry],
    target_lang: &str,
    max_items: usize,
) -> Vec<String> {
    if max_items == 0 {
        return Vec::new();
    }

    let translated_join = translated_sections
        .iter()
        .map(|item| item.translated_text.as_str())
        .collect::<Vec<_>>()
        .join("\n")
        .to_lowercase();

    let mut glossary_source = HashSet::<String>::new();
    for item in glossary {
        glossary_source.insert(item.source_term.to_lowercase());
    }

    let mut freq = HashMap::<String, usize>::new();
    let mut token = String::new();
    for ch in source_text.chars() {
        if ch.is_ascii_alphanumeric() || ch == '_' || ch == '-' {
            token.push(ch.to_ascii_lowercase());
            continue;
        }
        if token.len() >= 4 {
            *freq.entry(token.clone()).or_insert(0) += 1;
        }
        token.clear();
    }
    if token.len() >= 4 {
        *freq.entry(token).or_insert(0) += 1;
    }

    const STOPWORDS: [&str; 24] = [
        "that", "this", "with", "from", "into", "through", "about", "under", "between", "where",
        "their", "there", "which", "would", "could", "should", "while", "using", "based", "model",
        "paper", "study", "results", "method",
    ];

    let mut candidates = freq
        .into_iter()
        .filter(|(term, count)| {
            if term.len() > 34 {
                return false;
            }
            if STOPWORDS.contains(&term.as_str()) {
                return false;
            }
            if term.chars().all(|ch| ch.is_ascii_digit()) {
                return false;
            }
            if glossary_source.contains(term) {
                return false;
            }
            let is_symbol_like = term.chars().all(|ch| ch == '_' || ch == '-');
            if is_symbol_like {
                return false;
            }
            translated_join.contains(term) && (*count >= 2 || is_chinese_target(target_lang))
        })
        .collect::<Vec<_>>();

    candidates.sort_by(|a, b| b.1.cmp(&a.1));
    candidates
        .into_iter()
        .take(max_items)
        .map(|(term, _)| term)
        .collect()
}

fn merge_uncertain_terms(
    parsed: &mut ParsedPayload,
    source_text: &str,
    target_lang: &str,
) {
    let available = 16usize.saturating_sub(parsed.uncertain_terms.len());
    if available == 0 {
        return;
    }

    let mut seen = HashSet::<String>::new();
    for item in &parsed.uncertain_terms {
        seen.insert(item.to_lowercase());
    }

    for term in collect_auto_uncertain_terms(
        source_text,
        &parsed.sections,
        &parsed.glossary,
        target_lang,
        available,
    ) {
        if seen.insert(term.to_lowercase()) {
            parsed.uncertain_terms.push(term);
        }
        if parsed.uncertain_terms.len() >= 16 {
            break;
        }
    }
}

fn build_refine_prompt(
    target_lang: &str,
    uncertain_terms: &[String],
    references: &crate::commands::analysis::ReferenceCheckResponse,
    current_output: &str,
) -> String {
    let mut evidence_lines = Vec::new();
    for item in references.items.iter().take(8) {
        evidence_lines.push(format!("- {} => {}", item.query, item.message));
        for result in item.results.iter().take(3) {
            evidence_lines.push(format!("  - {} ({})", result.title, result.url));
        }
    }
    let mut lines = vec![
        format!(
            "Refine the translation into {target_lang} for uncertain terms only, keep section ids unchanged."
        ),
        "Keep JSON schema unchanged and return strict JSON only: {\"sections\":[...],\"glossary\":[...],\"uncertainTerms\":[...]}.".to_string(),
        "Do not drop sections. Do not hallucinate references beyond provided evidence.".to_string(),
        format!("Uncertain terms: {}", uncertain_terms.join(", ")),
        "Reference evidence:".to_string(),
        evidence_lines.join("\n"),
        "Current translation JSON:".to_string(),
        current_output.to_string(),
    ];
    if is_chinese_target(target_lang) {
        lines.push("For Chinese output, enforce Simplified Chinese technical phrasing and keep acronyms intact.".to_string());
    }
    lines.join("\n\n")
}

pub(super) fn translate_layout_plan(
    db_path: &std::path::Path,
    project_id: &str,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    target_lang: &str,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
) -> Result<TranslationLayoutResult, String> {
    let block_by_id: HashMap<&str, &str> = extraction
        .blocks
        .iter()
        .map(|block| (block.id.as_str(), block.text.as_str()))
        .collect();

    let source_text = collect_source_text(extraction);
    let memory_hits = load_translation_memory_hits(db_path, project_id, target_lang, &source_text, 36)
        .unwrap_or_default();
    let memory_block = memory_hits_to_prompt_block(&memory_hits);

    let payload = serde_json::to_string_pretty(&sections_payload(extraction, layout, &block_by_id))
        .map_err(|e| e.to_string())?;

    let mut prompt_lines = vec![
        format!("Translate each section into {target_lang}."),
        "Preserve formulas, citations, code-like tokens, and references.".to_string(),
        "Use consistent terminology across all sections and keep section ids unchanged.".to_string(),
        "When uncertain, keep the source token and list it in uncertainTerms.".to_string(),
        "Return strict JSON only with schema: {\"sections\":[{\"id\":\"s-1\",\"title\":\"...\",\"translatedText\":\"...\",\"confidence\":0.0}],\"glossary\":[{\"sourceTerm\":\"...\",\"targetTerm\":\"...\",\"confidence\":0.0}],\"uncertainTerms\":[\"...\"]}".to_string(),
        format!("Source kind: {}", extraction.source_kind),
        format!(
            "Detected source language: {}",
            extraction
                .detected_language
                .clone()
                .unwrap_or_else(|| "unknown".to_string())
        ),
    ];
    prompt_lines.extend(language_strategy_lines(target_lang));
    if !memory_block.is_empty() {
        prompt_lines.push(memory_block);
    }
    prompt_lines.push(String::new());
    prompt_lines.push(payload);
    let prompt = prompt_lines.join("\n");

    let raw_output = crate::commands::swarm::call_provider_with_retry(
        Some(db_path),
        protocol_id,
        base_url,
        api_key,
        model_name,
        &prompt,
        false,
    )?;

    let mut parsed = fill_missing_sections(parse_or_fallback(&raw_output, extraction, layout), extraction, layout);
    merge_uncertain_terms(&mut parsed, &source_text, target_lang);
    let mut refined_by_search = false;

    if !parsed.uncertain_terms.is_empty() {
        let refs = crate::commands::analysis::run_reference_check_queries(parsed.uncertain_terms.clone(), 5)
            .unwrap_or(crate::commands::analysis::ReferenceCheckResponse { items: Vec::new() });
        let has_any_evidence = refs.items.iter().any(|item| item.ok && !item.results.is_empty());
        if has_any_evidence {
            let refine_prompt = build_refine_prompt(target_lang, &parsed.uncertain_terms, &refs, &raw_output);
            let refined_output = crate::commands::swarm::call_provider_with_retry(
                Some(db_path),
                protocol_id,
                base_url,
                api_key,
                model_name,
                &refine_prompt,
                true,
            )?;
            let mut refined_payload = fill_missing_sections(
                parse_or_fallback(&refined_output, extraction, layout),
                extraction,
                layout,
            );
            merge_uncertain_terms(&mut refined_payload, &source_text, target_lang);
            if !refined_payload.sections.is_empty() {
                parsed = refined_payload;
                refined_by_search = true;
            }
        }
    }

    let _ = persist_translation_glossary(db_path, project_id, target_lang, &parsed.glossary);

    Ok(TranslationLayoutResult {
        source_kind: extraction.source_kind.clone(),
        sections: parsed.sections,
        raw_output,
        glossary: parsed.glossary,
        uncertain_terms: parsed.uncertain_terms,
        memory_hits,
        refined_by_search,
    })
}

