use crate::storage;
use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowRegistry {
    pub version: u32,
    #[serde(default)]
    pub workflows: Vec<WorkflowDefinition>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowDefinition {
    pub id: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub callsites: Vec<String>,
    #[serde(default)]
    pub model_id: Option<String>,
    #[serde(default)]
    pub execution_mode: Option<String>,
    #[serde(default)]
    pub steps: Vec<WorkflowStep>,
    #[serde(default)]
    pub constraints: WorkflowConstraints,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStep {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub title: String,
    #[serde(default)]
    pub source: String,
    #[serde(default)]
    pub retryable: Option<bool>,
    #[serde(default)]
    pub approval_required: Option<bool>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowConstraints {
    #[serde(default)]
    pub allowed_context_prefixes: Vec<String>,
    #[serde(default)]
    pub allowed_tools: Vec<String>,
    #[serde(default)]
    pub writable_scopes: Vec<String>,
    pub max_steps: Option<u32>,
    pub timeout_ms: Option<u64>,
    #[serde(default)]
    pub max_iterations: Option<u32>,
    #[serde(default)]
    pub approval_policy: Option<String>,
    #[serde(default)]
    pub trace_visibility: Option<String>,
    #[serde(default)]
    pub parallelism: Option<u32>,
}

const DEFAULT_TIMEOUT_MS: u64 = 45 * 60 * 1000;
const DEFAULT_MAX_ITERATIONS: usize = 2;

fn workflow_file_path(project_root: &Path) -> PathBuf {
    project_root
        .join(".latotex")
        .join("agent")
        .join("workflows.json")
}

fn latex_extensions() -> &'static [&'static str] {
    &[
        "tex", "bib", "sty", "cls", "bst", "tikz", "pgf", "bbl", "bbx", "cbx", "lbx", "md",
    ]
}

fn is_latex_related_path(path: &str) -> bool {
    let normalized = path.trim().replace('\\', "/").to_ascii_lowercase();
    if normalized.ends_with('/') || normalized.is_empty() {
        return false;
    }
    let ext = normalized.rsplit('.').next().unwrap_or("");
    latex_extensions().iter().any(|value| *value == ext)
}

fn provider(
    id: &str,
    title: &str,
    callsites: &[&str],
    writable_scopes: &[&str],
    execution_mode: &str,
) -> WorkflowDefinition {
    WorkflowDefinition {
        id: id.to_string(),
        title: title.to_string(),
        callsites: callsites.iter().map(|value| value.to_string()).collect(),
        model_id: None,
        execution_mode: Some(execution_mode.to_string()),
        steps: vec![WorkflowStep {
            id: "main".to_string(),
            kind: "provider.generate".to_string(),
            title: title.to_string(),
            source: "workflow".to_string(),
            retryable: Some(true),
            approval_required: None,
        }],
        constraints: WorkflowConstraints {
            allowed_context_prefixes: vec![
                "file:".to_string(),
                "paper:".to_string(),
                "folder:".to_string(),
            ],
            allowed_tools: vec!["provider_generate".to_string()],
            writable_scopes: writable_scopes.iter().map(|value| value.to_string()).collect(),
            max_steps: Some(4),
            timeout_ms: Some(DEFAULT_TIMEOUT_MS),
            max_iterations: Some(DEFAULT_MAX_ITERATIONS as u32),
            approval_policy: Some(if writable_scopes.iter().any(|value| *value != "readonly") {
                "checkpoint_on_write".to_string()
            } else {
                "readonly".to_string()
            }),
            trace_visibility: Some("full".to_string()),
            parallelism: Some(1),
        },
    }
}

fn default_workflow_registry() -> WorkflowRegistry {
    WorkflowRegistry {
        version: 2,
        workflows: vec![
            provider("latex.edit", "LaTeX Edit", &["latex.overlay"], &["latex"], "supervisor"),
            provider(
                "latex.review_fix",
                "LaTeX Review Fix",
                &["latex.overlay"],
                &["latex"],
                "supervisor",
            ),
            WorkflowDefinition {
                id: "latex.reference_check".to_string(),
                title: "Reference Check".to_string(),
                callsites: vec!["latex.overlay".to_string()],
                model_id: None,
                execution_mode: Some("supervisor".to_string()),
                steps: vec![WorkflowStep {
                    id: "search".to_string(),
                    kind: "tool.search".to_string(),
                    title: "Tool Search".to_string(),
                    source: "workflow".to_string(),
                    retryable: Some(true),
                    approval_required: Some(false),
                }],
                constraints: WorkflowConstraints {
                    allowed_context_prefixes: vec![
                        "file:".to_string(),
                        "paper:".to_string(),
                        "folder:".to_string(),
                    ],
                    allowed_tools: vec!["tool_search".to_string()],
                    writable_scopes: vec!["readonly".to_string()],
                    max_steps: Some(2),
                    timeout_ms: Some(DEFAULT_TIMEOUT_MS),
                    max_iterations: Some(1),
                    approval_policy: Some("readonly".to_string()),
                    trace_visibility: Some("full".to_string()),
                    parallelism: Some(1),
                },
            },
            provider(
                "latex.paper_analyze",
                "Paper Analyze",
                &["latex.overlay"],
                &["readonly"],
                "supervisor",
            ),
            provider(
                "analysis.explore_chunk",
                "Analysis Explore",
                &["analysis.workspace"],
                &["data"],
                "supervisor",
            ),
            provider(
                "analysis.synthesize",
                "Analysis Synthesize",
                &["analysis.workspace"],
                &["data"],
                "supervisor",
            ),
            provider(
                "chat.general",
                "Chat General",
                &["chat.workspace"],
                &["latex", "drawings", "data"],
                "supervisor",
            ),
            provider(
                "completion.latex",
                "Completion",
                &["completion.inline"],
                &["readonly"],
                "single",
            ),
            provider(
                "git.summary",
                "Git Summary",
                &["git.summary"],
                &["readonly"],
                "single",
            ),
        ],
    }
}

fn ensure_registry_file(project_root: &Path) -> Result<PathBuf, String> {
    let file_path = workflow_file_path(project_root);
    if file_path.exists() {
        return Ok(file_path);
    }
    let parent = file_path
        .parent()
        .ok_or_else(|| "workflow.config.path.invalid".to_string())?;
    fs::create_dir_all(parent).map_err(|error| format!("workflow.config.mkdir_failed:{error}"))?;
    let payload = serde_json::to_string_pretty(&default_workflow_registry())
        .map_err(|error| format!("workflow.config.serialize_failed:{error}"))?;
    fs::write(&file_path, format!("{payload}\n"))
        .map_err(|error| format!("workflow.config.write_failed:{error}"))?;
    Ok(file_path)
}

pub(super) fn load_registry_for_project(
    db_path: &Path,
    project_id: &str,
) -> Result<WorkflowRegistry, String> {
    let project_root = storage::load_project_root(db_path, project_id)?;
    let file_path = ensure_registry_file(&project_root)?;
    let raw = fs::read_to_string(&file_path)
        .map_err(|error| format!("workflow.config.read_failed:{error}"))?;
    serde_json::from_str::<WorkflowRegistry>(&raw)
        .map_err(|error| format!("workflow.config.invalid_json:{error}"))
}

pub(super) fn resolve_workflow<'a>(
    registry: &'a WorkflowRegistry,
    workflow_id: &str,
) -> Result<&'a WorkflowDefinition, String> {
    let trimmed = workflow_id.trim();
    if trimmed.is_empty() {
        return Err("workflow.id.empty".to_string());
    }
    registry
        .workflows
        .iter()
        .find(|workflow| workflow.id == trimmed)
        .ok_or_else(|| format!("workflow.not_found:{trimmed}"))
}

pub(super) fn timeout_for_workflow(workflow: &WorkflowDefinition) -> u64 {
    workflow
        .constraints
        .timeout_ms
        .filter(|value| *value >= 1_000)
        .unwrap_or(DEFAULT_TIMEOUT_MS)
}

pub(super) fn max_steps_for_workflow(workflow: &WorkflowDefinition) -> usize {
    workflow
        .constraints
        .max_steps
        .map(|value| value.clamp(1, 12) as usize)
        .unwrap_or(4)
}

pub(super) fn max_iterations_for_workflow(workflow: &WorkflowDefinition) -> usize {
    workflow
        .constraints
        .max_iterations
        .map(|value| value.clamp(1, 4) as usize)
        .unwrap_or(DEFAULT_MAX_ITERATIONS)
}

pub(super) fn execution_mode_for_workflow(workflow: &WorkflowDefinition, callsite: &str) -> &'static str {
    match workflow.execution_mode.as_deref().map(str::trim) {
        Some("single") => "single",
        Some("supervisor") => "supervisor",
        _ if callsite == "completion.inline" => "single",
        _ => "supervisor",
    }
}

pub(super) fn normalize_tool_name(step_kind: &str) -> String {
    match step_kind {
        "provider.generate" => "provider_generate".to_string(),
        "tool.search" => "tool_search".to_string(),
        other => other.replace('.', "_"),
    }
}

pub(super) fn validate_invocation(
    workflow: &WorkflowDefinition,
    callsite: &str,
    context_refs: &[String],
) -> Result<(), String> {
    let trimmed_callsite = callsite.trim();
    if trimmed_callsite.is_empty() {
        return Err("constraint.callsite.empty".to_string());
    }
    if !workflow.callsites.is_empty()
        && !workflow
            .callsites
            .iter()
            .any(|value| value.as_str() == trimmed_callsite)
    {
        return Err(format!(
            "constraint.callsite.denied:{}:{}",
            workflow.id, trimmed_callsite
        ));
    }

    if !workflow.constraints.allowed_context_prefixes.is_empty() {
        for reference in context_refs {
            let allowed = workflow
                .constraints
                .allowed_context_prefixes
                .iter()
                .any(|prefix| reference.starts_with(prefix));
            if !allowed {
                return Err(format!("constraint.context_ref.denied:{reference}"));
            }
        }
    }

    let latex_only = workflow
        .constraints
        .writable_scopes
        .iter()
        .any(|scope| scope == "latex");
    if latex_only {
        for reference in context_refs.iter().filter(|value| value.starts_with("file:")) {
            let relative = reference.trim_start_matches("file:");
            if !is_latex_related_path(relative) {
                return Err(format!("constraint.write_scope.denied:{reference}"));
            }
        }
    }

    Ok(())
}

pub(super) fn validate_step_tools(workflow: &WorkflowDefinition) -> Result<(), String> {
    if workflow.steps.is_empty() {
        return Err(format!("workflow.steps.empty:{}", workflow.id));
    }
    if workflow.constraints.allowed_tools.is_empty() {
        return Ok(());
    }
    for step in &workflow.steps {
        let tool_name = normalize_tool_name(&step.kind);
        let allowed = workflow
            .constraints
            .allowed_tools
            .iter()
            .any(|item| item == &tool_name);
        if !allowed {
            return Err(format!(
                "constraint.tool.denied:{}:{}",
                workflow.id, tool_name
            ));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::{execution_mode_for_workflow, max_iterations_for_workflow, WorkflowDefinition, WorkflowRegistry};

    #[test]
    fn parses_legacy_registry_without_new_fields() {
        let raw = r#"{
          "version": 1,
          "workflows": [{
            "id": "latex.edit",
            "title": "LaTeX Edit",
            "callsites": ["latex.overlay"],
            "steps": [{"id": "main", "kind": "provider.generate"}],
            "constraints": {"writableScopes": ["latex"], "maxSteps": 4}
          }]
        }"#;
        let registry: WorkflowRegistry = serde_json::from_str(raw).expect("legacy registry parses");
        let workflow = registry.workflows.first().expect("workflow exists");
        assert_eq!(execution_mode_for_workflow(workflow, "latex.overlay"), "supervisor");
        assert_eq!(max_iterations_for_workflow(workflow), 2);
    }

    #[test]
    fn completion_defaults_to_single_mode_when_execution_mode_is_missing() {
        let workflow = WorkflowDefinition {
            id: "completion.latex".to_string(),
            title: "Completion".to_string(),
            callsites: vec!["completion.inline".to_string()],
            model_id: None,
            execution_mode: None,
            steps: vec![],
            constraints: Default::default(),
        };
        assert_eq!(execution_mode_for_workflow(&workflow, "completion.inline"), "single");
    }
}
