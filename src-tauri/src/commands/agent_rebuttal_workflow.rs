use crate::commands::swarm::start_agent_execution;
use crate::models::{AgentExecuteRequest, AgentExecuteStartAccepted, LatexRebuttalReplyStartInput};
use crate::state::AppState;
use crate::storage;
use latotex_agent::build_rebuttal_reply_prompt;
use std::fs;
use std::path::Path;
use tauri::State;

fn dedupe_push(values: &mut Vec<String>, next: impl Into<String>) {
    let candidate = next.into();
    if !values.iter().any(|item| item == &candidate) {
        values.push(candidate);
    }
}

fn is_tex_path(path: &str) -> bool {
    Path::new(path)
        .extension()
        .and_then(|value| value.to_str())
        .map(|value| value.eq_ignore_ascii_case("tex"))
        .unwrap_or(false)
}

fn clean_context_path(raw: &str) -> String {
    raw.trim()
        .trim_start_matches('@')
        .trim_matches('"')
        .trim_matches('\'')
        .replace('\\', "/")
}

fn resolve_context_refs(db_path: &Path, project_id: &str, context_paths: &[String]) -> Vec<String> {
    let mut resolved = Vec::new();
    for raw in context_paths {
        let relative_path = clean_context_path(raw);
        if relative_path.is_empty() {
            continue;
        }
        let Ok(target) = storage::resolve_project_relative_path(db_path, project_id, &relative_path)
        else {
            continue;
        };
        let Ok(metadata) = fs::metadata(&target) else {
            continue;
        };
        if !metadata.is_file() {
            continue;
        }
        let prefix = if target
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case("pdf"))
            .unwrap_or(false)
        {
            "paper:"
        } else {
            "file:"
        };
        dedupe_push(&mut resolved, format!("{prefix}{relative_path}"));
    }
    resolved
}

fn start_rebuttal_workflow(
    state: &AppState,
    input: LatexRebuttalReplyStartInput,
    prompt: String,
    context_refs: Vec<String>,
) -> Result<AgentExecuteStartAccepted, String> {
    let runtime_prompt = [
        "[LatoTex Agent Runtime]",
        "Act like a senior research IDE agent. Keep reasoning compact and return auditable manuscript-facing output.",
        "When reviewer claims need evidence, rely on the supplied manuscript/context and mark uncertainty instead of guessing.",
        "Callsite: latex.overlay",
        &format!("Context refs: {}", if context_refs.is_empty() { "(none)".to_string() } else { context_refs.join(", ") }),
        "",
        &prompt,
    ]
    .join("\n");
    start_agent_execution(
        state,
        AgentExecuteRequest {
            project_id: input.project_id,
            workflow_id: "latex.rebuttal_reply".to_string(),
            callsite: "latex.overlay".to_string(),
            prompt: runtime_prompt,
            context_refs,
            model_override: input.model_override,
            bypass_cache: false,
            team_mode: input.team_mode,
            harness_profile_id: None,
        },
    )
}

#[tauri::command]
pub fn latex_rebuttal_reply_start(
    state: State<'_, AppState>,
    input: LatexRebuttalReplyStartInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let selected_file = input.selected_file.trim();
    if selected_file.is_empty() || !is_tex_path(selected_file) {
        return Err("agent.command.requiresFile".to_string());
    }
    if input.review_comments.trim().is_empty() {
        return Err("agent.command.rebuttal.requiresComments".to_string());
    }
    storage::resolve_project_relative_path(&state.db_path, &input.project_id, selected_file)?;
    let mut context_refs = vec![format!("file:{selected_file}")];
    for reference in resolve_context_refs(&state.db_path, &input.project_id, &input.context_paths) {
        dedupe_push(&mut context_refs, reference);
    }
    let prompt = build_rebuttal_reply_prompt(
        selected_file,
        &input.editor_content,
        &input.review_comments,
    );
    start_rebuttal_workflow(&state, input, prompt, context_refs)
}
