use crate::models::{ResearchPlanStep, ResearchPlanVersion};
use std::collections::HashSet;

pub(super) fn ordered_execution_steps(
    plan: &ResearchPlanVersion,
) -> Result<Vec<&ResearchPlanStep>, String> {
    let mut remaining = plan
        .steps
        .iter()
        .filter(|step| step.enabled)
        .collect::<Vec<_>>();
    let mut scheduled = HashSet::<&str>::new();
    let mut ordered = Vec::with_capacity(remaining.len());
    while !remaining.is_empty() {
        let Some(index) = remaining.iter().position(|step| {
            step.dependencies
                .iter()
                .all(|dependency| scheduled.contains(dependency.as_str()))
        }) else {
            return Err("research.plan.dependency_incomplete".to_string());
        };
        let step = remaining.remove(index);
        scheduled.insert(step.id.as_str());
        ordered.push(step);
    }
    Ok(ordered)
}
