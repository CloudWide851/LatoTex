use super::library_translation_types::{
    TranslationBlock, TranslationExtraction, TranslationLayoutPlan, TranslationLayoutSection,
};

const MAX_BLOCKS_PER_SECTION: usize = 5;
const MAX_CHARS_PER_SECTION: usize = 2200;

fn detect_semantic_role(block: &TranslationBlock) -> &'static str {
    let role = block.role.to_lowercase();
    let text = block.text.trim();
    let lower = text.to_lowercase();

    if role.contains("metadata") {
        return "Metadata";
    }
    if lower.contains("\\begin{equation}")
        || lower.contains("\\end{equation}")
        || lower.contains("\\[")
        || lower.contains("\\]")
        || lower.contains('$')
    {
        return "Formula";
    }
    if lower.contains("\\cite")
        || lower.contains("reference")
        || lower.contains("references")
        || lower.contains("bibliography")
        || lower.contains("et al.")
        || lower.contains("doi")
        || lower.contains("arxiv")
        || text.contains('[')
            && text.contains(']')
            && text.chars().filter(|ch| ch.is_ascii_digit()).count() >= 2
    {
        return "Citation";
    }
    let has_table_markers = text.matches('|').count() >= 3
        || text.contains('\t')
        || lower.contains("\\begin{table}")
        || lower.contains("table ");
    if has_table_markers {
        return "Table";
    }
    if lower.contains("figure")
        || lower.contains("fig.")
        || lower.contains("\\begin{figure}")
        || text.contains("图")
        || text.contains("图表")
    {
        return "Figure";
    }
    if role.contains("title") {
        return "Title";
    }
    "Body"
}

fn section_title(page: Option<u32>, semantic_role: &str) -> String {
    match page {
        Some(value) => format!("Page {value} · {semantic_role}"),
        None => semantic_role.to_string(),
    }
}

pub(super) fn build_layout_plan(extraction: &TranslationExtraction) -> TranslationLayoutPlan {
    if extraction.source_kind == "pdf" {
        let sections = extraction
            .blocks
            .iter()
            .enumerate()
            .map(|(index, block)| TranslationLayoutSection {
                id: format!("s-{}", index + 1),
                title: section_title(block.page, detect_semantic_role(block)),
                block_ids: vec![block.id.clone()],
            })
            .collect();
        return TranslationLayoutPlan {
            source_kind: extraction.source_kind.clone(),
            sections,
        };
    }

    let mut sections: Vec<TranslationLayoutSection> = Vec::new();
    let mut current_ids: Vec<String> = Vec::new();
    let mut current_page: Option<u32> = None;
    let mut current_semantic = "Body";
    let mut current_chars: usize = 0;

    let flush_current = |sections: &mut Vec<TranslationLayoutSection>,
                         ids: &mut Vec<String>,
                         page: Option<u32>,
                         semantic: &str| {
        if ids.is_empty() {
            return;
        }
        sections.push(TranslationLayoutSection {
            id: format!("s-{}", sections.len() + 1),
            title: section_title(page, semantic),
            block_ids: std::mem::take(ids),
        });
    };

    for block in &extraction.blocks {
        let semantic = detect_semantic_role(block);
        let can_merge = !current_ids.is_empty()
            && current_page == block.page
            && current_semantic == semantic
            && current_ids.len() < MAX_BLOCKS_PER_SECTION
            && current_chars + block.text.len() <= MAX_CHARS_PER_SECTION;

        if !can_merge {
            flush_current(
                &mut sections,
                &mut current_ids,
                current_page,
                current_semantic,
            );
            current_page = block.page;
            current_semantic = semantic;
            current_chars = 0;
        }

        current_ids.push(block.id.clone());
        current_chars = current_chars.saturating_add(block.text.len());
    }

    flush_current(
        &mut sections,
        &mut current_ids,
        current_page,
        current_semantic,
    );

    TranslationLayoutPlan {
        source_kind: extraction.source_kind.clone(),
        sections,
    }
}
