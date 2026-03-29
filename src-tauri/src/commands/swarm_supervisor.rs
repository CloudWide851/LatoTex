use serde_json::Value;

use super::swarm_workflows::WorkflowDefinition;

#[derive(Debug, Clone)]
pub(super) struct SupervisorEvaluation {
    pub decision: String,
    pub summary: String,
    pub feedback: String,
    pub risk_level: String,
    pub requires_approval: bool,
}

fn default_risk_level(workflow: &WorkflowDefinition) -> String {
    if workflow
        .constraints
        .writable_scopes
        .iter()
        .any(|scope| scope == "latex" || scope == "data" || scope == "drawings")
    {
        return "medium".to_string();
    }
    "low".to_string()
}

fn extract_json_block(raw: &str) -> &str {
    let trimmed = raw.trim();
    if let Some(start) = trimmed.find("```") {
        let tail = &trimmed[start + 3..];
        let tail = tail.strip_prefix("json").unwrap_or(tail).trim_start();
        if let Some(end) = tail.find("```") {
            return tail[..end].trim();
        }
    }
    trimmed
}

pub(super) fn build_supervisor_plan(
    workflow: &WorkflowDefinition,
    callsite: &str,
    context_refs: &[String],
) -> String {
    let mut lines = vec![
        format!("workflow={} callsite={}", workflow.id, callsite),
        format!("execution_mode={}", execution_mode_label(workflow, callsite)),
        format!("steps={}", workflow.steps.len()),
    ];
    if !context_refs.is_empty() {
        lines.push("context_refs:".to_string());
        lines.extend(context_refs.iter().take(8).map(|item| format!("- {item}")));
    }
    if !workflow.constraints.writable_scopes.is_empty() {
        lines.push(format!(
            "writable_scopes={} ",
            workflow.constraints.writable_scopes.join(", ")
        ));
    }
    if let Some(policy) = workflow.constraints.approval_policy.as_deref() {
        lines.push(format!("approval_policy={policy}"));
    }
    lines.join("\n")
}

pub(super) fn build_context_summary(context_refs: &[String]) -> String {
    if context_refs.is_empty() {
        return "No explicit context refs were attached to this run.".to_string();
    }
    let mut lines = vec![format!("resolved_context_count={}", context_refs.len())];
    lines.extend(context_refs.iter().take(10).map(|item| format!("- {item}")));
    lines.join("\n")
}

pub(super) fn build_evaluator_prompt(
    workflow: &WorkflowDefinition,
    original_prompt: &str,
    candidate_output: &str,
) -> String {
    [
        "You are an evaluator for a desktop IDE agent.",
        "Review the candidate output and decide if it should be accepted, revised, or blocked.",
        "Return strict JSON only.",
        r#"Schema: {"decision":"accept|revise|block","summary":"...","feedback":"...","riskLevel":"low|medium|high","requiresApproval":true|false}"#,
        "Prefer revise over block when the output is salvageable.",
        "Set requiresApproval=true whenever the workflow can lead to file writes or other side effects.",
        "",
        &format!("Workflow: {}", workflow.id),
        "",
        "[original_request]",
        original_prompt,
        "",
        "[candidate_output]",
        candidate_output,
    ]
    .join("\n")
}

pub(super) fn parse_supervisor_evaluation(
    raw: &str,
    workflow: &WorkflowDefinition,
) -> SupervisorEvaluation {
    let default_requires_approval = requires_write_checkpoint(workflow);
    let default_risk = if default_requires_approval {
        "high".to_string()
    } else {
        default_risk_level(workflow)
    };

    let candidate = extract_json_block(raw);
    let parsed = serde_json::from_str::<Value>(candidate).ok();
    let decision = parsed
        .as_ref()
        .and_then(|value| value.get("decision"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| *value == "accept" || *value == "revise" || *value == "block")
        .unwrap_or("accept")
        .to_string();
    let summary = parsed
        .as_ref()
        .and_then(|value| value.get("summary"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Evaluator accepted the current output.")
        .to_string();
    let feedback = parsed
        .as_ref()
        .and_then(|value| value.get("feedback"))
        .and_then(Value::as_str)
        .map(str::trim)
        .unwrap_or("")
        .to_string();
    let risk_level = parsed
        .as_ref()
        .and_then(|value| value.get("riskLevel"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| *value == "low" || *value == "medium" || *value == "high")
        .unwrap_or(default_risk.as_str())
        .to_string();
    let requires_approval = parsed
        .as_ref()
        .and_then(|value| value.get("requiresApproval"))
        .and_then(Value::as_bool)
        .unwrap_or(default_requires_approval);

    SupervisorEvaluation {
        decision,
        summary,
        feedback,
        risk_level,
        requires_approval,
    }
}

pub(super) fn build_revision_prompt(
    original_prompt: &str,
    evaluation: &SupervisorEvaluation,
    iteration: usize,
) -> String {
    [
        original_prompt.trim(),
        "",
        "[supervisor_feedback]",
        &format!("iteration={} decision={}", iteration, evaluation.decision),
        evaluation.summary.trim(),
        evaluation.feedback.trim(),
        "Revise the output to address the feedback while preserving correct parts.",
    ]
    .join("\n")
}

pub(super) fn requires_write_checkpoint(workflow: &WorkflowDefinition) -> bool {
    workflow
        .constraints
        .writable_scopes
        .iter()
        .any(|scope| scope == "latex" || scope == "data" || scope == "drawings")
}

pub(super) fn execution_mode_label(workflow: &WorkflowDefinition, callsite: &str) -> String {
    workflow
        .execution_mode
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .unwrap_or_else(|| {
            if callsite == "completion.inline" {
                "single".to_string()
            } else {
                "supervisor".to_string()
            }
        })
}

#[cfg(test)]
mod tests {
    use super::{parse_supervisor_evaluation, requires_write_checkpoint};
    use super::super::swarm_workflows::{WorkflowConstraints, WorkflowDefinition};

    fn sample_workflow() -> WorkflowDefinition {
        WorkflowDefinition {
            id: "latex.edit".to_string(),
            title: "LaTeX Edit".to_string(),
            callsites: vec!["latex.overlay".to_string()],
            model_id: None,
            execution_mode: Some("supervisor".to_string()),
            steps: vec![],
            constraints: WorkflowConstraints {
                writable_scopes: vec!["latex".to_string()],
                ..WorkflowConstraints::default()
            },
        }
    }

    #[test]
    fn parse_supervisor_evaluation_falls_back_when_json_is_invalid() {
        let workflow = sample_workflow();
        let result = parse_supervisor_evaluation("not json", &workflow);
        assert_eq!(result.decision, "accept");
        assert!(result.requires_approval);
        assert_eq!(result.risk_level, "high");
    }

    #[test]
    fn requires_write_checkpoint_detects_mutating_workflows() {
        assert!(requires_write_checkpoint(&sample_workflow()));
    }
}

