use crate::commands::swarm::start_agent_execution;
use crate::commands::agent_workflows_context::context_path_candidates;
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
use std::fs;
use std::collections::HashSet;
use std::path::{Path, PathBuf};
use tauri::State;

const MAX_CONTEXT_FILE_CHARS: usize = 4_000;
const MAX_CONTEXT_TOTAL_CHARS: usize = 14_000;
const MAX_CONTEXT_FOLDER_FILES: usize = 8;

fn truncate_chars(value: &str, limit: usize) -> String {
    value.chars().take(limit).collect()
}

fn dedupe_push(values: &mut Vec<String>, next: impl Into<String>) {
    let candidate = next.into();
    if !values.iter().any(|item| item == &candidate) {
        values.push(candidate);
    }
}

fn supported_context_extension(path: &Path) -> bool {
    matches!(
        path.extension()
            .and_then(|value| value.to_str())
            .map(|value| value.to_ascii_lowercase()),
        Some(ext)
            if matches!(
                ext.as_str(),
                "tex" | "bib" | "cls" | "sty" | "md" | "txt" | "json" | "yaml" | "yml" | "csv"
            )
    )
}

fn to_relative_display(root: &Path, path: &Path) -> String {
    path.strip_prefix(root)
        .ok()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| path.to_string_lossy().replace('\\', "/"))
}

fn resolve_context_refs(
    db_path: &Path,
    project_id: &str,
    context_paths: &[String],
) -> Vec<String> {
    let mut resolved = Vec::new();
    for raw in context_paths {
        for relative_path in context_path_candidates(raw) {
            let Ok(target) = storage::resolve_project_relative_path(db_path, project_id, &relative_path) else {
                continue;
            };
            let Ok(metadata) = fs::metadata(&target) else {
                continue;
            };
            if metadata.is_dir() {
                dedupe_push(&mut resolved, format!("folder:{relative_path}"));
            } else if target
                .extension()
                .and_then(|value| value.to_str())
                .map(|value| value.eq_ignore_ascii_case("pdf"))
                .unwrap_or(false)
            {
                dedupe_push(&mut resolved, format!("paper:{relative_path}"));
            } else {
                dedupe_push(&mut resolved, format!("file:{relative_path}"));
            }
            break;
        }
    }
    resolved
}

fn collect_folder_context_files(
    root: &Path,
    current: &Path,
    files: &mut Vec<PathBuf>,
) -> Result<(), String> {
    let mut entries = fs::read_dir(current)
        .map_err(|e| e.to_string())?
        .collect::<Result<Vec<_>, _>>()
        .map_err(|e| e.to_string())?;
    entries.sort_by_key(|entry| entry.path());
    for entry in entries {
        if files.len() >= MAX_CONTEXT_FOLDER_FILES {
            break;
        }
        let path = entry.path();
        let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
            continue;
        };
        if name.starts_with(".git") || name == "node_modules" || name == "target" {
            continue;
        }
        let metadata = entry.metadata().map_err(|e| e.to_string())?;
        if metadata.is_dir() {
            collect_folder_context_files(root, &path, files)?;
            continue;
        }
        if path.starts_with(root) && supported_context_extension(&path) {
            files.push(path);
        }
    }
    Ok(())
}

fn read_context_file_block(root: &Path, file_path: &Path) -> Option<String> {
    if !supported_context_extension(file_path) {
        return None;
    }
    let content = fs::read_to_string(file_path).ok()?;
    let relative_path = to_relative_display(root, file_path);
    Some(
        [
            format!("File: {relative_path}"),
            truncate_chars(content.trim(), MAX_CONTEXT_FILE_CHARS),
        ]
        .join("\n"),
    )
}

fn build_folder_context_block(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<Option<String>, String> {
    let project_root = storage::load_project_root(db_path, project_id)?;
    let folder = storage::resolve_project_relative_path(db_path, project_id, relative_path)?;
    let metadata = fs::metadata(&folder).map_err(|e| e.to_string())?;
    if !metadata.is_dir() {
        return Ok(None);
    }
    let mut files = Vec::new();
    collect_folder_context_files(&project_root, &folder, &mut files)?;
    if files.is_empty() {
        return Ok(Some(format!(
            "Folder: {relative_path}\nNo supported text files were found under this folder."
        )));
    }
    let listed = files
        .iter()
        .map(|path| format!("- {}", to_relative_display(&project_root, path)))
        .collect::<Vec<_>>();
    let mut blocks = vec![
        format!("Folder: {relative_path}"),
        "Recursive text files:".to_string(),
        listed.join("\n"),
    ];
    for file_path in files {
        if let Some(block) = read_context_file_block(&project_root, &file_path) {
            blocks.push(block);
        }
    }
    Ok(Some(blocks.join("\n\n")))
}

fn build_file_context_block(
    db_path: &Path,
    project_id: &str,
    relative_path: &str,
) -> Result<Option<String>, String> {
    let project_root = storage::load_project_root(db_path, project_id)?;
    let path = storage::resolve_project_relative_path(db_path, project_id, relative_path)?;
    let metadata = fs::metadata(&path).map_err(|e| e.to_string())?;
    if !metadata.is_file() {
        return Ok(None);
    }
    Ok(read_context_file_block(&project_root, &path))
}

fn materialize_context_blocks(
    state: &AppState,
    project_id: &str,
    context_refs: &[String],
) -> Result<Vec<String>, String> {
    let mut blocks = Vec::new();
    let mut total_chars = 0_usize;
    for reference in context_refs {
        let block = if let Some(relative_path) = reference.strip_prefix("file:") {
            build_file_context_block(&state.db_path, project_id, relative_path)?
        } else if let Some(relative_path) = reference.strip_prefix("folder:") {
            build_folder_context_block(&state.db_path, project_id, relative_path)?
        } else if let Some(relative_path) = reference.strip_prefix("paper:") {
            let (context, _) = build_paper_context_block(
                &state.db_path,
                &state.runtime_root,
                &state.app_data_dir,
                project_id,
                relative_path,
            )?;
            Some(context)
        } else {
            None
        };
        let Some(block) = block else {
            continue;
        };
        let remaining = MAX_CONTEXT_TOTAL_CHARS.saturating_sub(total_chars);
        if remaining == 0 {
            break;
        }
        let truncated = truncate_chars(block.trim(), remaining);
        total_chars += truncated.chars().count();
        if !truncated.trim().is_empty() {
            blocks.push(truncated);
        }
    }
    Ok(blocks)
}

fn append_materialized_context(prompt: String, context_blocks: &[String]) -> String {
    if context_blocks.is_empty() {
        return prompt;
    }
    [
        prompt,
        "[Attached Context]".to_string(),
        context_blocks.join("\n\n---\n\n"),
    ]
    .join("\n\n")
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
    team_mode: Option<String>,
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
            team_mode,
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
    let explicit_context_refs = resolve_context_refs(&state.db_path, &input.project_id, &input.context_paths);
    for reference in &explicit_context_refs {
        dedupe_push(&mut context_refs, reference.clone());
    }
    let prompt = build_task_execution_prompt(
        &input.user_prompt,
        &input.target_path,
        &input.file_content,
        paper_context.as_deref(),
        paper_title.as_deref(),
    );
    let extra_context_blocks = materialize_context_blocks(&state, &input.project_id, &explicit_context_refs)?;
    start_workflow(
        &state,
        input.project_id,
        "latex.edit",
        "latex.overlay",
        append_materialized_context(prompt, &extra_context_blocks),
        context_refs,
        input.model_override,
        false,
        input.team_mode,
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
        input.team_mode,
    )
}

#[tauri::command]
pub fn latex_reference_check_start(
    state: State<'_, AppState>,
    input: LatexReferenceCheckStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let explicit_context_refs = resolve_context_refs(&state.db_path, &input.project_id, &input.context_paths);
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
    for reference in &explicit_context_refs {
        dedupe_push(&mut context_refs, reference.clone());
    }
    let extra_context_blocks = materialize_context_blocks(&state, &input.project_id, &explicit_context_refs)?;
    start_workflow(
        &state,
        input.project_id,
        "latex.reference_check",
        "latex.overlay",
        append_materialized_context(prompt, &extra_context_blocks),
        context_refs,
        input.model_override,
        false,
        input.team_mode,
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
        input.team_mode,
    )
}

#[tauri::command]
pub fn chat_workflow_start(
    state: State<'_, AppState>,
    input: ChatWorkflowStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let context_refs = resolve_context_refs(&state.db_path, &input.project_id, &input.context_paths);
    let prompt = append_materialized_context(
        input.prompt,
        &materialize_context_blocks(&state, &input.project_id, &context_refs)?,
    );
    start_workflow(
        &state,
        input.project_id,
        "chat.general",
        "chat.workspace",
        prompt,
        context_refs,
        input.model_override,
        false,
        input.team_mode,
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
        None,
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
        None,
    )
}
