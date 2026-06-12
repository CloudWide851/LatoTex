use regex::Regex;
use std::sync::OnceLock;

const AGENT_TASK_FILE_CONTEXT_MAX_CHARS: usize = 24_000;
const REMOTE_COMPLETION_MAX: usize = 6;

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn dedupe_push(values: &mut Vec<String>, next: impl Into<String>) {
    let candidate = next.into();
    if !values.iter().any(|item| item == &candidate) {
        values.push(candidate);
    }
}

fn normalize_query(value: &str) -> Option<String> {
    let trimmed = value.trim();
    if trimmed.len() < 3 || trimmed.len() > 180 {
        return None;
    }
    if trimmed.starts_with('[') || trimmed.starts_with('{') {
        return None;
    }
    Some(trimmed.to_string())
}

fn build_tool_search_query_block(queries: Vec<String>) -> String {
    let mut unique = Vec::<String>::new();
    for item in queries {
        let Some(normalized) = normalize_query(&item) else {
            continue;
        };
        if unique.iter().any(|value| value == &normalized) {
            continue;
        }
        unique.push(normalized);
        if unique.len() >= 10 {
            break;
        }
    }
    if unique.is_empty() {
        unique.push("latex citation verification".to_string());
    }
    let mut lines = vec!["[tool_search.queries.v1]".to_string()];
    lines.extend(unique.into_iter().map(|item| format!("- {item}")));
    lines.join("\n")
}

fn doi_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\b10\.\d{4,9}/[-._;()/:A-Za-z0-9]+\b").expect("doi regex"))
}

fn url_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\bhttps?://[^\s)]+\b").expect("url regex"))
}

fn arxiv_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| {
        Regex::new(r"\barXiv:\s*\d{4}\.\d{4,5}(v\d+)?\b|\b\d{4}\.\d{4,5}(v\d+)?\b")
            .expect("arxiv regex")
    })
}

fn cite_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\\cite[a-zA-Z*]*\{([^}]+)\}").expect("cite regex"))
}

fn latex_command_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\\[a-zA-Z]{3,}").expect("latex command regex"))
}

fn acronym_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\b[A-Z][A-Z0-9_-]{2,}\b").expect("acronym regex"))
}

fn english_word_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"\b[a-zA-Z][a-zA-Z_-]{4,}\b").expect("english word regex"))
}

fn han_phrase_regex() -> &'static Regex {
    static REGEX: OnceLock<Regex> = OnceLock::new();
    REGEX.get_or_init(|| Regex::new(r"[\u4e00-\u9fff]{2,12}").expect("han phrase regex"))
}

fn extract_reference_queries(content: &str, user_hint: &str, max: usize) -> Vec<String> {
    let mut values = Vec::<String>::new();
    for regex in [doi_regex(), arxiv_regex(), url_regex()] {
        for capture in regex.find_iter(content) {
            let value = capture.as_str().trim();
            if !value.is_empty() {
                dedupe_push(&mut values, value.to_string());
            }
            if values.len() >= max {
                return values;
            }
        }
    }
    for capture in cite_regex().captures_iter(content) {
        let Some(body) = capture.get(1) else {
            continue;
        };
        for item in body.as_str().split(',') {
            let normalized = item.trim();
            if normalized.is_empty() {
                continue;
            }
            dedupe_push(&mut values, normalized.to_string());
            if values.len() >= max {
                return values;
            }
        }
    }
    for item in user_hint.split([',', '\n']) {
        let normalized = item.trim();
        if normalized.is_empty() {
            continue;
        }
        dedupe_push(&mut values, normalized.to_string());
        if values.len() >= max {
            break;
        }
    }
    values
}

fn is_translation_request(prompt: &str) -> bool {
    let normalized = prompt.to_lowercase();
    let has_han = prompt
        .chars()
        .any(|ch| ('\u{4e00}'..='\u{9fff}').contains(&ch));
    normalized.contains("translate")
        || normalized.contains("translation")
        || normalized.contains("bilingual")
        || normalized.contains("localization")
        || prompt.contains("术语")
        || prompt.contains("翻译")
        || (has_han
            && (normalized.contains("中英")
                || normalized.contains("英文")
                || normalized.contains("中文")))
}

fn extract_term_hints(file_content: &str, max_items: usize) -> Vec<String> {
    let mut out = Vec::<String>::new();
    for regex in [
        latex_command_regex(),
        acronym_regex(),
        english_word_regex(),
        han_phrase_regex(),
    ] {
        for capture in regex.find_iter(file_content) {
            let value = capture.as_str().trim();
            if value.is_empty() {
                continue;
            }
            dedupe_push(&mut out, value.to_string());
            if out.len() >= max_items {
                return out;
            }
        }
    }
    out
}

fn build_translation_strategy_block(user_prompt: &str, file_content: &str) -> Option<String> {
    if !is_translation_request(user_prompt) {
        return None;
    }
    let term_hints = extract_term_hints(file_content, 18);
    let mut lines = vec![
        "[translation.strategy.v2]".to_string(),
        "- Preserve formula tokens, citations, labels, and code-like identifiers.".to_string(),
        "- Reuse glossary/memory terms whenever available for consistent translation.".to_string(),
        "- Keep context coherence across sections (do not translate identical terms inconsistently).".to_string(),
        "- If uncertain, keep source token and annotate uncertainty in output comments.".to_string(),
        "- For ambiguous domain terms, call tool_search first and then update translation based on evidence.".to_string(),
    ];
    if !term_hints.is_empty() {
        lines.push("- Candidate glossary hints:".to_string());
        lines.extend(term_hints.into_iter().map(|item| format!("  - {item}")));
    }
    Some(lines.join("\n"))
}

fn detect_citation_command(user_prompt: &str, file_content: &str) -> &'static str {
    let lower_prompt = user_prompt.to_lowercase();
    if lower_prompt.contains("textcite") || file_content.contains("\\textcite{") {
        return "\\textcite";
    }
    if lower_prompt.contains("parencite") || file_content.contains("\\parencite{") {
        return "\\parencite";
    }
    if lower_prompt.contains("autocite") || file_content.contains("\\autocite{") {
        return "\\autocite";
    }
    if lower_prompt.contains("citep") || file_content.contains("\\citep{") {
        return "\\citep";
    }
    if lower_prompt.contains("citet") || file_content.contains("\\citet{") {
        return "\\citet";
    }
    if file_content.contains("\\usepackage{biblatex}") || file_content.contains("\\addbibresource") {
        return "\\autocite";
    }
    if file_content.contains("\\usepackage{natbib}") {
        return "\\citep";
    }
    "\\cite"
}

fn is_citation_insertion_request(user_prompt: &str) -> bool {
    let lower = user_prompt.to_lowercase();
    lower.contains("citation")
        || lower.contains("insert cite")
        || lower.contains("cite ")
        || user_prompt.contains("引用")
        || user_prompt.contains("引文")
        || user_prompt.contains("插入参考文献")
}

fn derive_task_search_queries(
    user_prompt: &str,
    paper_context_title: Option<&str>,
    file_content: &str,
) -> Vec<String> {
    let mut candidates = user_prompt
        .split(['\r', '\n', ',', '，', ';', '；', '。', '!', '?', '！', '？'])
        .map(str::trim)
        .filter(|item| item.len() >= 3)
        .take(6)
        .map(ToOwned::to_owned)
        .collect::<Vec<_>>();

    if let Some(title) = paper_context_title
        .map(str::trim)
        .filter(|value| value.len() >= 3)
    {
        candidates.insert(0, title.to_string());
    }

    if is_translation_request(user_prompt) {
        for term in extract_term_hints(file_content, 14) {
            if term.len() < 3 {
                continue;
            }
            candidates.push(format!("term meaning {term}"));
            candidates.push(format!("translate technical term {term}"));
        }
    }

    let mut unique = Vec::<String>::new();
    for item in candidates {
        dedupe_push(&mut unique, item);
        if unique.len() >= 12 {
            break;
        }
    }
    unique
}

pub fn build_task_execution_prompt(
    user_prompt: &str,
    target_path: &str,
    file_content: &str,
    paper_context: Option<&str>,
    paper_context_title: Option<&str>,
) -> String {
    let normalized = file_content.replace("\r\n", "\n");
    let truncated = if normalized.chars().count() > AGENT_TASK_FILE_CONTEXT_MAX_CHARS {
        format!(
            "{}\n\n...[TRUNCATED FOR CONTEXT]...",
            truncate_chars(&normalized, AGENT_TASK_FILE_CONTEXT_MAX_CHARS)
        )
    } else {
        normalized.clone()
    };
    let query_block = build_tool_search_query_block(derive_task_search_queries(
        user_prompt,
        paper_context_title,
        &normalized,
    ));
    let translation_strategy = build_translation_strategy_block(user_prompt, &normalized);

    let mut sections = vec![
        "You are editing files in an IDE.".to_string(),
        "Return only YAML edit actions in ```yaml fences.".to_string(),
        "Do not output full-file rewrites unless unavoidable.".to_string(),
        "For long files, generate minimal partial edits by exact matching.".to_string(),
        "If factual details are uncertain, rely on tool_search evidence and do not invent claims or references.".to_string(),
        "When evidence is insufficient, keep the original text for that uncertain part.".to_string(),
        "Use this schema:".to_string(),
        "actions:".to_string(),
        "  - type: replace".to_string(),
        "    path: <relative path>".to_string(),
        "    search: |".to_string(),
        "      <exact text to find>".to_string(),
        "    replace: |".to_string(),
        "      <replacement text>".to_string(),
        String::new(),
        format!("Target path: {target_path}"),
        String::new(),
        "User request:".to_string(),
        user_prompt.to_string(),
        String::new(),
    ];
    if let Some(strategy) = translation_strategy {
        sections.push(strategy);
        sections.push(String::new());
    }
    if is_citation_insertion_request(user_prompt) {
        sections.push("[citation.insertion.v1]".to_string());
        sections.push(format!(
            "- Preferred citation command for this target: {}{{key}}.",
            detect_citation_command(user_prompt, &normalized)
        ));
        sections.push("- Use BibTeX keys from attached .bib context when available.".to_string());
        sections.push("- If you cite a key from an attached .bib file, ensure the target .tex has a matching bibliography resource: use \\addbibresource{<attached .bib path>} for biblatex, or add/extend \\bibliography{<attached .bib path without .bib>} for BibTeX.".to_string());
        sections.push("- Insert citations into the target .tex content, not into the .bib file, unless the user explicitly asks to edit bibliography entries.".to_string());
        sections.push(String::new());
    }
    sections.push(query_block);
    sections.push(String::new());
    if let Some(context) = paper_context.filter(|value| !value.trim().is_empty()) {
        sections.push("Paper context:".to_string());
        sections.push(context.to_string());
        sections.push(String::new());
    }
    sections.push("Current file content:".to_string());
    sections.push(truncated);
    sections.join("\n")
}

pub fn build_reference_check_prompt(editor_content: &str, user_hint: &str) -> Option<String> {
    let queries = extract_reference_queries(editor_content, user_hint, 12);
    if queries.is_empty() {
        return None;
    }
    let query_lines = queries
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let query_block = build_tool_search_query_block(queries);
    Some(
        [
            "You are a citation verifier with an internal programmatic tool runtime.",
            "The runtime will execute tool_search in a provider-agnostic way.",
            "Assess if each reference appears real and linked to evidence.",
            "Return concise sections: PASS, WARNING, ACTION, SOURCES.",
            "",
            "Reference queries:",
            &query_lines,
            "",
            &query_block,
        ]
        .join("\n"),
    )
}

pub fn build_rebuttal_reply_prompt(
    selected_file: &str,
    editor_content: &str,
    review_comments: &str,
) -> String {
    let normalized = editor_content.replace("\r\n", "\n");
    let manuscript = if normalized.chars().count() > AGENT_TASK_FILE_CONTEXT_MAX_CHARS {
        format!(
            "{}\n\n...[TRUNCATED FOR CONTEXT]...",
            truncate_chars(&normalized, AGENT_TASK_FILE_CONTEXT_MAX_CHARS)
        )
    } else {
        normalized
    };
    [
        "You are a senior research response-letter editor.".to_string(),
        "Draft a concise, evidence-aware reviewer response in Markdown.".to_string(),
        "Use sections: Summary, Reviewer-by-reviewer response, Manuscript changes, Residual risks.".to_string(),
        "For each reviewer point, quote or paraphrase the concern briefly, then answer with manuscript-grounded evidence.".to_string(),
        "If the manuscript should change, return minimal YAML edit actions in ```yaml fences after the response letter.".to_string(),
        "Do not invent new experiments, citations, results, or page numbers. Mark any missing evidence as a risk or requested follow-up.".to_string(),
        "Use this optional edit schema only when edits are justified:".to_string(),
        "actions:".to_string(),
        "  - type: replace".to_string(),
        "    path: <relative path>".to_string(),
        "    search: |".to_string(),
        "      <exact text to find>".to_string(),
        "    replace: |".to_string(),
        "      <replacement text>".to_string(),
        String::new(),
        format!("Target manuscript path: {}", selected_file.trim()),
        String::new(),
        "Reviewer comments:".to_string(),
        review_comments.trim().to_string(),
        String::new(),
        "Current manuscript content:".to_string(),
        manuscript,
    ]
    .join("\n")
}

pub fn build_completion_prompt(
    line_prefix: &str,
    full_text: &str,
    project_symbols: &[String],
) -> String {
    [
        "You are a LaTeX autocomplete engine.".to_string(),
        "Return strict JSON only.".to_string(),
        "Schema:".to_string(),
        "{\"suggestions\":[{\"label\":\"\\\\command\",\"insertText\":\"\\\\command{${1}}\",\"kind\":\"snippet|text\"}]}".to_string(),
        format!("Maximum {REMOTE_COMPLETION_MAX} suggestions."),
        "Only include suggestions that start with '\\\\' and match the current prefix.".to_string(),
        String::new(),
        "Current line prefix:".to_string(),
        line_prefix.trim().to_string(),
        String::new(),
        "Known project symbols (high confidence):".to_string(),
        project_symbols.join(", "),
        String::new(),
        "Current document context (tail):".to_string(),
        truncate_chars(
            &full_text
                .chars()
                .rev()
                .take(720)
                .collect::<String>()
                .chars()
                .rev()
                .collect::<String>(),
            720,
        ),
    ]
    .join("\n")
}

pub fn sanitize_git_files(files: &[String]) -> Vec<String> {
    let mut unique = Vec::<String>::new();
    for item in files {
        let normalized = item.trim();
        if normalized.is_empty() {
            continue;
        }
        dedupe_push(&mut unique, normalized.to_string());
        if unique.len() >= 24 {
            break;
        }
    }
    unique
}

pub fn build_git_summary_prompt(files: &[String], joined_patch: &str) -> String {
    [
        "Summarize the staged Git changes and return a commit message proposal.".to_string(),
        "Output format:".to_string(),
        "TITLE: <single line, <=72 chars>".to_string(),
        "BODY:".to_string(),
        "- <bullet 1>".to_string(),
        "- <bullet 2>".to_string(),
        "Use concise, technical wording.".to_string(),
        String::new(),
        format!("Files: {}", files.join(", ")),
        String::new(),
        "Patch:".to_string(),
        if joined_patch.trim().is_empty() {
            "(empty patch text)".to_string()
        } else {
            truncate_chars(joined_patch, 48_000)
        },
    ]
    .join("\n")
}

#[cfg(test)]
mod tests {
    use super::{build_rebuttal_reply_prompt, build_reference_check_prompt, sanitize_git_files};

    #[test]
    fn reference_check_prompt_requires_targets() {
        assert!(build_reference_check_prompt("plain text", "").is_none());
    }

    #[test]
    fn sanitize_git_files_deduplicates() {
        let files = vec!["a.tex".to_string(), "a.tex".to_string(), " b.tex ".to_string()];
        assert_eq!(sanitize_git_files(&files), vec!["a.tex", "b.tex"]);
    }

    #[test]
    fn rebuttal_prompt_includes_response_and_edit_contract() {
        let prompt = build_rebuttal_reply_prompt(
            "main.tex",
            "\\begin{document}Draft\\end{document}",
            "Reviewer 1 asks for limitations.",
        );
        assert!(prompt.contains("Reviewer-by-reviewer response"));
        assert!(prompt.contains("actions:"));
        assert!(prompt.contains("main.tex"));
        assert!(prompt.contains("Reviewer 1 asks for limitations."));
    }
}
