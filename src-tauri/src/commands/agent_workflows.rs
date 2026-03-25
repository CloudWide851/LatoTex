use crate::commands::swarm::start_agent_execution;
use crate::models::{
    AgentExecuteRequest, AgentExecuteStartAccepted, ChatWorkflowStartInput,
    CompletionWorkflowStartInput, GitSummaryWorkflowStartInput, LatexEditStartInput,
    LatexPaperAnalyzeStartInput, LatexReferenceCheckStartInput, LatexReviewFixStartInput,
};
use crate::state::AppState;
use crate::storage;
use regex::Regex;
use std::collections::HashSet;
use std::sync::OnceLock;
use tauri::State;

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

fn start_workflow(
    state: &AppState,
    project_id: String,
    workflow_id: &str,
    callsite: &str,
    prompt: String,
    context_refs: Vec<String>,
    model_override: Option<String>,
    bypass_cache: bool,
) -> Result<AgentExecuteStartAccepted, String> {
    start_agent_execution(
        state,
        AgentExecuteRequest {
            project_id,
            workflow_id: workflow_id.to_string(),
            callsite: callsite.to_string(),
            prompt,
            context_refs,
            model_override,
            bypass_cache,
        },
    )
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

fn build_task_execution_prompt(
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
        "Return only IDE-style SEARCH/REPLACE edit blocks in ```edit fences.".to_string(),
        "Do not output full-file rewrites unless unavoidable.".to_string(),
        "For long files, generate minimal partial edits by exact matching.".to_string(),
        "If factual details are uncertain, rely on tool_search evidence and do not invent claims or references.".to_string(),
        "When evidence is insufficient, keep the original text for that uncertain part.".to_string(),
        "Each edit block must be:".to_string(),
        "path: <relative path>".to_string(),
        "<<<<<<< SEARCH".to_string(),
        "<exact text to find>".to_string(),
        "=======".to_string(),
        "<replacement text>".to_string(),
        ">>>>>>> REPLACE".to_string(),
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

fn build_paper_context_block(
    db_path: &std::path::Path,
    app_data_dir: &std::path::Path,
    project_id: &str,
    source_path: &str,
) -> Result<(String, String), String> {
    let context =
        storage::extract_library_paper_context(db_path, app_data_dir, project_id, source_path)?;
    let title = context.title.trim().to_string();
    if context.chunks.is_empty() {
        return Ok((
            [
                format!("Paper source: {}", context.source_path),
                format!("Title: {}", context.title),
                "Metadata:".to_string(),
                context.metadata_block,
                "Content: (No extractable text chunks were parsed.)".to_string(),
            ]
            .join("\n\n"),
            title,
        ));
    }
    let chunks = context
        .chunks
        .iter()
        .take(6)
        .map(|chunk| {
            [
                format!(
                    "[Chunk {}] pages {}-{}",
                    chunk.chunk_index + 1,
                    chunk.page_start,
                    chunk.page_end
                ),
                truncate_chars(&chunk.text, 1_600),
            ]
            .join("\n")
        })
        .collect::<Vec<_>>();
    Ok((
        [
            format!("Paper source: {}", context.source_path),
            format!("Title: {}", context.title),
            "Metadata:".to_string(),
            context.metadata_block,
            "Paper chunks:".to_string(),
            chunks.join("\n\n"),
        ]
        .join("\n\n"),
        title,
    ))
}

fn build_completion_prompt(
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
        truncate_chars(&full_text.chars().rev().take(720).collect::<String>().chars().rev().collect::<String>(), 720),
    ]
    .join("\n")
}

fn sanitize_git_files(files: &[String]) -> Vec<String> {
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

fn build_git_summary_prompt(files: &[String], joined_patch: &str) -> String {
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

#[tauri::command]
pub fn latex_edit_start(
    state: State<'_, AppState>,
    input: LatexEditStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let mut context_refs = vec![format!("file:{}", input.target_path.trim())];
    if let Some(selected_file) = input
        .selected_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        dedupe_push(&mut context_refs, format!("file:{selected_file}"));
    }
    let (paper_context, paper_title) = if let Some(source_path) = input
        .paper_context_source_path
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        dedupe_push(&mut context_refs, format!("paper:{source_path}"));
        let (context, title) = build_paper_context_block(
            &state.db_path,
            &state.app_data_dir,
            &input.project_id,
            source_path,
        )?;
        (Some(context), Some(title))
    } else {
        (None, None)
    };
    let prompt = build_task_execution_prompt(
        &input.user_prompt,
        &input.target_path,
        &input.file_content,
        paper_context.as_deref(),
        paper_title.as_deref(),
    );
    start_workflow(
        &state,
        input.project_id,
        "latex.edit",
        "latex.overlay",
        prompt,
        context_refs,
        input.model_override,
        false,
    )
}

#[tauri::command]
pub fn latex_review_fix_start(
    state: State<'_, AppState>,
    input: LatexReviewFixStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let extra_instruction = input
        .extra_instruction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(|value| format!("\nAdditional instruction: {value}"))
        .unwrap_or_default();
    let diagnostics = if input.diagnostics.is_empty() {
        "(none)".to_string()
    } else {
        input.diagnostics.join("\n")
    };
    let prompt = [
        "You are a LaTeX fixer.",
        "Apply minimal changes so the document compiles.",
        "Return IDE-style SEARCH/REPLACE edit blocks inside ```edit fences.",
        "Each edit block must include path, SEARCH, REPLACE.",
        "Only edit the requested target file.",
        "",
        &format!("Compile diagnostics:\n{diagnostics}"),
        &extra_instruction,
        "",
        "Current LaTeX content:",
        &input.working_content,
    ]
    .join("\n");
    start_workflow(
        &state,
        input.project_id,
        "latex.review_fix",
        "latex.overlay",
        prompt,
        vec![format!("file:{}", input.selected_file.trim())],
        input.model_override,
        false,
    )
}

#[tauri::command]
pub fn latex_reference_check_start(
    state: State<'_, AppState>,
    input: LatexReferenceCheckStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let queries = extract_reference_queries(
        &input.editor_content,
        input.user_hint.as_deref().unwrap_or_default(),
        12,
    );
    if queries.is_empty() {
        return Err("agent.reference_check.no_targets".to_string());
    }
    let query_lines = queries
        .iter()
        .map(|item| format!("- {item}"))
        .collect::<Vec<_>>()
        .join("\n");
    let query_block = build_tool_search_query_block(queries);
    let prompt = [
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
    .join("\n");
    let mut context_refs = Vec::<String>::new();
    if let Some(selected_file) = input
        .selected_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        context_refs.push(format!("file:{selected_file}"));
    }
    start_workflow(
        &state,
        input.project_id,
        "latex.reference_check",
        "latex.overlay",
        prompt,
        context_refs,
        input.model_override,
        false,
    )
}

#[tauri::command]
pub fn latex_paper_analyze_start(
    state: State<'_, AppState>,
    input: LatexPaperAnalyzeStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let (paper_context, _) = build_paper_context_block(
        &state.db_path,
        &state.app_data_dir,
        &input.project_id,
        &input.source_path,
    )?;
    let instruction = input
        .instruction
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let mut prompt_parts = vec![
        "You are a research-paper analyst.".to_string(),
        "Read the paper context and return a concise markdown report with sections:".to_string(),
        "1) Core Problem 2) Method 3) Evidence 4) Limitations 5) Actionable next steps."
            .to_string(),
        "If evidence is missing, state uncertainty explicitly.".to_string(),
    ];
    if let Some(value) = instruction {
        prompt_parts.push(format!("User focus: {value}"));
    }
    prompt_parts.push(String::new());
    prompt_parts.push(paper_context);
    let prompt = prompt_parts
        .into_iter()
        .filter(|item| !item.is_empty())
        .collect::<Vec<_>>()
        .join("\n");
    start_workflow(
        &state,
        input.project_id,
        "latex.paper_analyze",
        "latex.overlay",
        prompt,
        vec![format!("paper:{}", input.source_path.trim())],
        input.model_override,
        false,
    )
}

#[tauri::command]
pub fn chat_workflow_start(
    state: State<'_, AppState>,
    input: ChatWorkflowStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    start_workflow(
        &state,
        input.project_id,
        "chat.general",
        "chat.workspace",
        input.prompt,
        Vec::new(),
        input.model_override,
        false,
    )
}

#[tauri::command]
pub fn completion_latex_start(
    state: State<'_, AppState>,
    input: CompletionWorkflowStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let mut seen = HashSet::<String>::new();
    let project_symbols = input
        .project_symbols
        .into_iter()
        .map(|item| item.trim().to_string())
        .filter(|item| !item.is_empty())
        .filter(|item| seen.insert(item.clone()))
        .take(20)
        .collect::<Vec<_>>();
    let prompt = build_completion_prompt(&input.line_prefix, &input.full_text, &project_symbols);
    let mut context_refs = Vec::<String>::new();
    if let Some(selected_file) = input
        .selected_file
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        context_refs.push(format!("file:{selected_file}"));
    }
    start_workflow(
        &state,
        input.project_id,
        "completion.latex",
        "completion.inline",
        prompt,
        context_refs,
        input.model_override,
        false,
    )
}

#[tauri::command]
pub fn git_summary_workflow_start(
    state: State<'_, AppState>,
    input: GitSummaryWorkflowStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let files = sanitize_git_files(&input.files);
    let context_refs = files
        .iter()
        .map(|path| format!("file:{path}"))
        .collect::<Vec<_>>();
    let prompt = build_git_summary_prompt(&files, &input.joined_patch);
    start_workflow(
        &state,
        input.project_id,
        "git.summary",
        "git.summary",
        prompt,
        context_refs,
        None,
        true,
    )
}
