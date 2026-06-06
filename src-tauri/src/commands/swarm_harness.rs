use crate::models::AgentExecuteRequest;

use super::swarm_workflows::WorkflowDefinition;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum HarnessTeamPolicy {
    Never,
    ComplexOnly,
}

#[derive(Debug, Clone, Copy)]
pub(super) struct AgentHarnessProfile {
    pub id: &'static str,
    pub title: &'static str,
    pub identity: &'static str,
    pub context_policy: &'static str,
    pub tool_policy: &'static str,
    pub acceptance_rubric: &'static str,
    pub team_policy: HarnessTeamPolicy,
}

fn profile_for_id(id: &str) -> Option<AgentHarnessProfile> {
    match id {
        "latex.editor" => Some(AgentHarnessProfile {
            id: "latex.editor",
            title: "LaTeX Editor",
            identity: "You are a LaTeX editing agent. Preserve the user's document voice, make minimal file-scoped changes, and keep non-LaTeX writes behind explicit approval.",
            context_policy: "Prioritize the selected .tex file, cited .bib files, local compile diagnostics, and nearby style/class files.",
            tool_policy: "Use workspace context before proposing edits. Use web/MCP/skills only when the task needs external or specialized evidence.",
            acceptance_rubric: "The final answer must identify edited paths, summarize behavior changes, and call out compile or validation gaps.",
            team_policy: HarnessTeamPolicy::ComplexOnly,
        }),
        "latex.reviewer" => Some(AgentHarnessProfile {
            id: "latex.reviewer",
            title: "LaTeX Reviewer",
            identity: "You are a senior LaTeX reviewer. Focus on correctness, boundary conditions, citation integrity, and compile regressions before style polish.",
            context_policy: "Read diagnostics, affected TeX/Bib files, and dependent macros before recommending changes.",
            tool_policy: "Prefer workspace and compile evidence. Escalate to web/reference tools only for bibliographic or standards uncertainty.",
            acceptance_rubric: "Findings must be ordered by severity and include concrete file/path evidence.",
            team_policy: HarnessTeamPolicy::ComplexOnly,
        }),
        "latex.reference" => Some(AgentHarnessProfile {
            id: "latex.reference",
            title: "Reference Researcher",
            identity: "You are a reference-checking agent. Verify citation claims and avoid inventing bibliographic facts.",
            context_policy: "Treat .bib and paper contexts as primary evidence; remote lookup can enrich but must not override local source facts without explanation.",
            tool_policy: "Use web/search tooling only for reference verification and keep outputs compact.",
            acceptance_rubric: "Return confirmed references, unresolved uncertainty, and exact next actions.",
            team_policy: HarnessTeamPolicy::ComplexOnly,
        }),
        "paper.analyst" => Some(AgentHarnessProfile {
            id: "paper.analyst",
            title: "Paper Analyst",
            identity: "You are a paper analysis agent. Extract claims, methods, limitations, and reusable project context without blocking on remote metadata.",
            context_policy: "Use local PDF/Bib-derived chunks first, then enrich with available metadata.",
            tool_policy: "Use Python for structured extraction only when it materially improves the answer.",
            acceptance_rubric: "Output must separate evidence, interpretation, and unresolved gaps.",
            team_policy: HarnessTeamPolicy::ComplexOnly,
        }),
        "analysis.research" => Some(AgentHarnessProfile {
            id: "analysis.research",
            title: "Analysis Research Agent",
            identity: "You are an analysis workspace agent. Build defensible analytical context, cite inputs, and avoid overclaiming.",
            context_policy: "Prefer attached datasets, reports, and workspace files before outside tools.",
            tool_policy: "Use Python, workspace, MCP, and skills according to persisted permissions and role access.",
            acceptance_rubric: "Summaries must include assumptions, data limits, and reproducible next checks.",
            team_policy: HarnessTeamPolicy::ComplexOnly,
        }),
        "chat.workspace" => Some(AgentHarnessProfile {
            id: "chat.workspace",
            title: "Workspace Chat Agent",
            identity: "You are a workspace chat agent. Answer directly, but switch to evidence-gathering when the question touches project state or tool results.",
            context_policy: "Use selected project context and recent run events when available; otherwise state the missing context.",
            tool_policy: "Respect MCP, skills, web, Python, and workspace permission settings exactly.",
            acceptance_rubric: "Responses should be concise, actionable, and explicit about uncertainty.",
            team_policy: HarnessTeamPolicy::ComplexOnly,
        }),
        "git.summary" => Some(AgentHarnessProfile {
            id: "git.summary",
            title: "Git Summary Agent",
            identity: "You are a git summary agent. Summarize real changed files and diffs without guessing intent.",
            context_policy: "Use git status, staged changes, and diff context as the source of truth.",
            tool_policy: "Do not use external tools unless the workflow explicitly provides them.",
            acceptance_rubric: "Output must separate user-facing change summary from tests and residual risk.",
            team_policy: HarnessTeamPolicy::Never,
        }),
        "latex.completion" => Some(AgentHarnessProfile {
            id: "latex.completion",
            title: "LaTeX Completion Agent",
            identity: "You are an inline completion agent. Keep suggestions short, local, and syntactically valid.",
            context_policy: "Use only nearby editor context and avoid broad project scans.",
            tool_policy: "No external tool calls for inline completion.",
            acceptance_rubric: "Completion must be insertable without explanatory prose.",
            team_policy: HarnessTeamPolicy::Never,
        }),
        _ => None,
    }
}

fn default_profile_id(workflow_id: &str, callsite: &str) -> &'static str {
    match (workflow_id, callsite) {
        ("latex.edit", _) => "latex.editor",
        ("latex.review_fix", _) => "latex.reviewer",
        ("latex.reference_check", _) => "latex.reference",
        ("latex.paper_analyze", _) => "paper.analyst",
        ("analysis.explore_chunk", _) | ("analysis.synthesize", _) => "analysis.research",
        ("git.summary", _) | (_, "git.summary") => "git.summary",
        ("completion.latex", _) | (_, "completion.inline") => "latex.completion",
        (_, "chat.workspace") => "chat.workspace",
        (_, "analysis.workspace") => "analysis.research",
        (_, "latex.overlay") => "latex.editor",
        _ => "chat.workspace",
    }
}

pub(super) fn resolve_harness_profile(
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> AgentHarnessProfile {
    input
        .harness_profile_id
        .as_deref()
        .and_then(profile_for_id)
        .or_else(|| profile_for_id(default_profile_id(&workflow.id, &input.callsite)))
        .unwrap_or_else(|| {
            profile_for_id("chat.workspace").expect("default harness profile exists")
        })
}

pub(super) fn apply_harness_prompt(profile: &AgentHarnessProfile, prompt: &str) -> String {
    [
        format!(
            "[Agent Harness]\nid={}\ntitle={}",
            profile.id, profile.title
        ),
        "[Positioning]".to_string(),
        profile.identity.to_string(),
        "[Context Policy]".to_string(),
        profile.context_policy.to_string(),
        "[Tool Policy]".to_string(),
        profile.tool_policy.to_string(),
        "[Acceptance Rubric]".to_string(),
        profile.acceptance_rubric.to_string(),
        "[User Request]".to_string(),
        prompt.to_string(),
    ]
    .join("\n")
}

fn prompt_is_complex(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    prompt.chars().count() > 900
        || lower.contains("refactor")
        || lower.contains("review")
        || lower.contains("ci")
        || lower.contains("mcp")
        || lower.contains("skill")
        || lower.contains("subagent")
        || lower.contains("multi-agent")
        || prompt.contains("多Agent")
        || prompt.contains("多智能体")
        || prompt.contains("团队")
        || prompt.contains("评审")
        || prompt.contains("重构")
}

pub(super) fn harness_should_use_team(
    input: &AgentExecuteRequest,
    profile: &AgentHarnessProfile,
) -> bool {
    match input.team_mode.as_deref().unwrap_or("auto") {
        "force" => true,
        "off" => false,
        _ => match profile.team_policy {
            HarnessTeamPolicy::Never => false,
            HarnessTeamPolicy::ComplexOnly => prompt_is_complex(&input.prompt),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::super::swarm_workflows::{WorkflowConstraints, WorkflowDefinition};
    use super::{apply_harness_prompt, harness_should_use_team, resolve_harness_profile};
    use crate::models::AgentExecuteRequest;

    fn input(workflow_id: &str, callsite: &str, prompt: &str) -> AgentExecuteRequest {
        AgentExecuteRequest {
            project_id: "project".to_string(),
            workflow_id: workflow_id.to_string(),
            callsite: callsite.to_string(),
            prompt: prompt.to_string(),
            context_refs: Vec::new(),
            model_override: None,
            bypass_cache: false,
            team_mode: None,
            harness_profile_id: None,
        }
    }

    fn workflow(id: &str) -> WorkflowDefinition {
        WorkflowDefinition {
            id: id.to_string(),
            title: id.to_string(),
            callsites: Vec::new(),
            model_id: None,
            steps: Vec::new(),
            constraints: WorkflowConstraints::default(),
        }
    }

    #[test]
    fn resolves_profile_by_workflow_and_callsite() {
        let request = input("latex.review_fix", "latex.overlay", "review this");
        let profile = resolve_harness_profile(&request, &workflow("latex.review_fix"));
        assert_eq!(profile.id, "latex.reviewer");
    }

    #[test]
    fn injects_harness_prompt_sections() {
        let request = input("chat.general", "chat.workspace", "hello");
        let profile = resolve_harness_profile(&request, &workflow("chat.general"));
        let prompt = apply_harness_prompt(&profile, &request.prompt);
        assert!(prompt.contains("[Agent Harness]"));
        assert!(prompt.contains("id=chat.workspace"));
        assert!(prompt.contains("[User Request]\nhello"));
    }

    #[test]
    fn complex_profile_uses_team_but_completion_does_not() {
        let mut request = input(
            "chat.general",
            "chat.workspace",
            "需要多Agent团队评审这个复杂问题",
        );
        let profile = resolve_harness_profile(&request, &workflow("chat.general"));
        assert!(harness_should_use_team(&request, &profile));

        request = input("completion.latex", "completion.inline", "complete");
        let profile = resolve_harness_profile(&request, &workflow("completion.latex"));
        assert!(!harness_should_use_team(&request, &profile));
    }
}
