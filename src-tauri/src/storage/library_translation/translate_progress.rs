use super::{
    TranslationExtraction, TranslationGlossaryEntry, TranslationLayoutPlan, TranslationSectionResult,
};
use std::collections::{HashMap, HashSet};

pub(super) fn section_page_number(title: &str) -> Option<u32> {
    let trimmed = title.trim();
    let rest = trimmed.strip_prefix("Page ")?;
    let digits: String = rest.chars().take_while(|ch| ch.is_ascii_digit()).collect();
    if digits.is_empty() {
        return None;
    }
    digits.parse::<u32>().ok()
}

pub(super) fn split_layout_by_page(layout: &TranslationLayoutPlan) -> Vec<(u32, TranslationLayoutPlan)> {
    let mut order = Vec::<u32>::new();
    let mut grouped = HashMap::<u32, Vec<_>>::new();

    for section in &layout.sections {
        let page = section_page_number(&section.title).unwrap_or(0);
        if !grouped.contains_key(&page) {
            order.push(page);
        }
        grouped.entry(page).or_default().push(section.clone());
    }

    order
        .into_iter()
        .filter_map(|page| {
            grouped.remove(&page).map(|sections| {
                (
                    page,
                    TranslationLayoutPlan {
                        source_kind: layout.source_kind.clone(),
                        sections,
                    },
                )
            })
        })
        .collect()
}

pub(super) fn translate_sections_by_page(
    db_path: &std::path::Path,
    protocol_id: &str,
    base_url: &str,
    api_key: &str,
    model_name: &str,
    target_lang: &str,
    extraction: &TranslationExtraction,
    layout: &TranslationLayoutPlan,
    block_by_id: &HashMap<&str, &str>,
    memory_block: &str,
    on_progress: &mut dyn FnMut(u32, u32, &str),
) -> Result<(super::ParsedPayload, String), String> {
    let grouped_layouts = split_layout_by_page(layout);
    let total_page_count = layout
        .sections
        .iter()
        .filter_map(|section| section_page_number(&section.title))
        .collect::<HashSet<_>>()
        .len();
    let total_pages = if total_page_count > 0 {
        total_page_count as u32
    } else {
        grouped_layouts.len().max(1) as u32
    };
    on_progress(0, total_pages, "preparing");

    let mut raw_outputs = Vec::<String>::new();
    let mut section_by_id = HashMap::<String, TranslationSectionResult>::new();
    let mut glossary_acc = Vec::<TranslationGlossaryEntry>::new();
    let mut glossary_seen = HashSet::<String>::new();
    let mut uncertain_acc = Vec::<String>::new();
    let mut uncertain_seen = HashSet::<String>::new();
    let mut translated_pages = HashSet::<u32>::new();

    for (index, (page, page_layout)) in grouped_layouts.iter().enumerate() {
        let payload = serde_json::to_string_pretty(&super::sections_payload(extraction, page_layout, block_by_id))
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
            format!("Batch: {} / {}", index + 1, grouped_layouts.len()),
        ];
        prompt_lines.extend(super::language_strategy_lines(target_lang));
        if !memory_block.is_empty() {
            prompt_lines.push(memory_block.to_string());
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
        raw_outputs.push(raw_output.clone());

        let chunk = super::fill_missing_sections(
            super::parse_or_fallback(&raw_output, extraction, page_layout),
            extraction,
            page_layout,
        );

        for section in chunk.sections {
            section_by_id.insert(section.id.clone(), section);
        }
        for item in chunk.glossary {
            let key = format!("{}=>{}", item.source_term.to_lowercase(), item.target_term.to_lowercase());
            if glossary_seen.insert(key) {
                glossary_acc.push(item);
            }
        }
        for term in chunk.uncertain_terms {
            let normalized = term.to_lowercase();
            if uncertain_seen.insert(normalized) && uncertain_acc.len() < 16 {
                uncertain_acc.push(term);
            }
        }

        let current_page = if *page > 0 {
            translated_pages.insert(*page);
            translated_pages.len() as u32
        } else {
            (index as u32 + 1).min(total_pages)
        };
        on_progress(current_page, total_pages, "translating");
    }

    on_progress(total_pages, total_pages, "translated");

    let parsed = super::fill_missing_sections(
        super::ParsedPayload {
            sections: layout
                .sections
                .iter()
                .filter_map(|section| section_by_id.get(&section.id).cloned())
                .collect(),
            glossary: glossary_acc,
            uncertain_terms: uncertain_acc,
        },
        extraction,
        layout,
    );

    Ok((parsed, raw_outputs.join("\n\n---\n\n")))
}

