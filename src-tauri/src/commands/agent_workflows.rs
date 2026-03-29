use crate::commands::swarm::start_agent_execution;
use crate::models::{
    AgentExecuteRequest, AgentExecuteStartAccepted, ChatWorkflowStartInput,
    CompletionWorkflowStartInput, GitSummaryWorkflowStartInput, LatexEditStartInput,
    LatexPaperAnalyzeStartInput, LatexReferenceCheckStartInput, LatexReviewFixStartInput,
};
use crate::state::AppState;
use crate::storage;
use latotex_agent::{
    build_completion_prompt, build_git_summary_prompt, build_reference_check_prompt,
    build_task_execution_prompt, sanitize_git_files,
};
use std::collections::HashSet;
use tauri::State;

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

fn build_paper_context_block(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    project_id: &str,
    source_path: &str,
) -> Result<(String, String), String> {
    let context = storage::extract_library_paper_context(
        db_path,
        runtime_root,
        app_data_dir,
        project_id,
        source_path,
    )?;
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
            &state.runtime_root,
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
    let prompt = build_reference_check_prompt(
        &input.editor_content,
        input.user_hint.as_deref().unwrap_or_default(),
    )
    .ok_or_else(|| "agent.reference_check.no_targets".to_string())?;
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
        &state.runtime_root,
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
