use crate::models::{AgentAppCommand, ResearchCapabilityDescriptor, ResearchPlanStep};
use serde_json::{Map, Value};
use std::collections::{HashMap, HashSet};

const CAPABILITIES: &[(&str, &str, &str, bool, Option<&str>, bool)] = &[
    ("project.overview", "read", "backend", true, None, false),
    ("ui.navigate", "read", "frontend", true, None, false),
    ("literature.search", "read", "backend", true, None, true),
    (
        "literature.import",
        "write",
        "frontend",
        true,
        Some("write"),
        true,
    ),
    (
        "literature.open",
        "read",
        "frontend",
        true,
        Some("read"),
        false,
    ),
    (
        "literature.citation_trace",
        "read",
        "frontend",
        true,
        None,
        true,
    ),
    (
        "workspace.read",
        "read",
        "backend",
        true,
        Some("read"),
        false,
    ),
    (
        "workspace.propose_latex",
        "write",
        "frontend",
        true,
        Some("write"),
        false,
    ),
    (
        "workspace.apply_latex",
        "write",
        "frontend",
        true,
        Some("write"),
        false,
    ),
    (
        "workspace.write_non_latex",
        "high",
        "frontend",
        false,
        Some("write"),
        false,
    ),
    (
        "workspace.compile",
        "read",
        "frontend",
        true,
        Some("read"),
        false,
    ),
    (
        "analysis.run",
        "read",
        "frontend",
        true,
        Some("read"),
        false,
    ),
    ("report.generate", "read", "frontend", true, None, false),
    (
        "report.export",
        "write",
        "frontend",
        true,
        Some("write"),
        false,
    ),
    (
        "draw.create",
        "write",
        "frontend",
        true,
        Some("write"),
        false,
    ),
    ("draw.open", "read", "frontend", true, Some("read"), false),
    (
        "draw.export",
        "write",
        "frontend",
        true,
        Some("write"),
        false,
    ),
    (
        "submission.check",
        "read",
        "backend",
        true,
        Some("read"),
        false,
    ),
    (
        "submission.build",
        "high",
        "frontend",
        false,
        Some("write"),
        false,
    ),
    ("submission.send", "high", "frontend", false, None, true),
    ("git.status", "read", "frontend", true, None, false),
    ("git.diff", "read", "frontend", true, Some("read"), false),
    (
        "git.commit",
        "high",
        "frontend",
        false,
        Some("write"),
        false,
    ),
    ("runtime.status", "read", "backend", true, None, false),
    ("runtime.update", "high", "frontend", false, None, true),
    ("plugin.status", "read", "frontend", true, None, false),
    ("plugin.update", "high", "frontend", false, None, true),
    ("settings.change", "high", "frontend", false, None, false),
];

pub fn capability_registry() -> Vec<ResearchCapabilityDescriptor> {
    CAPABILITIES
        .iter()
        .map(
            |(id, risk, target, auto, resource_mode, requires_network)| {
                ResearchCapabilityDescriptor {
                    id: (*id).to_string(),
                    risk_level: (*risk).to_string(),
                    execution_target: (*target).to_string(),
                    auto_after_plan_approval: *auto,
                    resource_mode: resource_mode.map(str::to_string),
                    requires_network: *requires_network,
                }
            },
        )
        .collect()
}

pub fn capability_descriptor(id: &str) -> Result<ResearchCapabilityDescriptor, String> {
    capability_registry()
        .into_iter()
        .find(|descriptor| descriptor.id == id)
        .ok_or_else(|| "research.capability.unknown".to_string())
}

pub fn parse_app_command(capability: &str, input: &Value) -> Result<AgentAppCommand, String> {
    capability_descriptor(capability)?;
    let object = input
        .as_object()
        .cloned()
        .unwrap_or_else(Map::<String, Value>::new);
    let mut envelope = object;
    envelope.insert("command".to_string(), Value::String(capability.to_string()));
    serde_json::from_value(Value::Object(envelope))
        .map_err(|_| "research.capability.input_invalid".to_string())
}

fn visit_step(
    id: &str,
    dependencies: &HashMap<&str, &[String]>,
    visiting: &mut HashSet<String>,
    visited: &mut HashSet<String>,
) -> Result<(), String> {
    if visited.contains(id) {
        return Ok(());
    }
    if !visiting.insert(id.to_string()) {
        return Err("research.plan.dependency_cycle".to_string());
    }
    for dependency in dependencies.get(id).copied().unwrap_or_default() {
        if !dependencies.contains_key(dependency.as_str()) {
            return Err("research.plan.dependency_missing".to_string());
        }
        visit_step(dependency, dependencies, visiting, visited)?;
    }
    visiting.remove(id);
    visited.insert(id.to_string());
    Ok(())
}

pub fn validate_plan_steps(steps: &[ResearchPlanStep]) -> Result<(), String> {
    let mut dependencies = HashMap::<&str, &[String]>::new();
    let mut enabled_by_id = HashMap::<&str, bool>::new();
    for step in steps {
        if dependencies
            .insert(step.id.as_str(), &step.dependencies)
            .is_some()
        {
            return Err("research.plan.step_duplicate".to_string());
        }
        enabled_by_id.insert(step.id.as_str(), step.enabled);
        let descriptor = capability_descriptor(&step.capability)?;
        if descriptor.risk_level != step.risk_level {
            return Err("research.plan.risk_mismatch".to_string());
        }
        parse_app_command(&step.capability, &step.input)?;
    }
    for step in steps.iter().filter(|step| step.enabled) {
        if step
            .dependencies
            .iter()
            .any(|dependency| enabled_by_id.get(dependency.as_str()) == Some(&false))
        {
            return Err("research.plan.dependency_disabled".to_string());
        }
    }
    let mut visiting = HashSet::new();
    let mut visited = HashSet::new();
    for step in steps {
        visit_step(&step.id, &dependencies, &mut visiting, &mut visited)?;
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn registry_rejects_arbitrary_commands_and_understated_risk() {
        assert_eq!(
            parse_app_command("shell.exec", &serde_json::json!({"command":"rm"})).unwrap_err(),
            "research.capability.unknown"
        );
        let command = parse_app_command(
            "git.commit",
            &serde_json::json!({"message":"checkpoint","paths":["main.tex"]}),
        )
        .unwrap();
        assert!(matches!(command, AgentAppCommand::GitCommit { .. }));
        assert_eq!(
            capability_descriptor("git.commit").unwrap().risk_level,
            "high"
        );
    }

    #[test]
    fn plan_validation_rejects_cycles_and_missing_dependencies() {
        let step = |id: &str, dependencies: Vec<String>| ResearchPlanStep {
            id: id.to_string(),
            order: 0,
            enabled: true,
            dependencies,
            capability: "project.overview".to_string(),
            input: serde_json::json!({}),
            risk_level: "read".to_string(),
            status: "pending".to_string(),
            run_id: None,
        };
        assert_eq!(
            validate_plan_steps(&[step("a", vec!["missing".to_string()])]).unwrap_err(),
            "research.plan.dependency_missing"
        );
        assert_eq!(
            validate_plan_steps(&[
                step("a", vec!["b".to_string()]),
                step("b", vec!["a".to_string()]),
            ])
            .unwrap_err(),
            "research.plan.dependency_cycle"
        );
        assert_eq!(
            validate_plan_steps(&[
                step("enabled", vec!["disabled".to_string()]),
                ResearchPlanStep {
                    enabled: false,
                    ..step("disabled", Vec::new())
                },
            ])
            .unwrap_err(),
            "research.plan.dependency_disabled"
        );
    }
}
