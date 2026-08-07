use super::ResearchExecutionContext;
use crate::models::{ResearchCapabilityDescriptor, ResearchPlanStep};
use crate::storage;
use serde_json::{json, Value};

pub(super) fn record_capability_audit(
    context: &ResearchExecutionContext,
    run_id: &str,
    step: &ResearchPlanStep,
    descriptor: &ResearchCapabilityDescriptor,
    stage: &str,
    input_summary: &Value,
    duration_ms: Option<i64>,
    diagnostic_code: Option<&str>,
) -> Result<(), String> {
    let result_summary =
        matches!(stage, "completed" | "failed").then(|| json!({ "status": stage }));
    storage::append_research_capability_audit(
        &context.db_path,
        &context.runtime_root,
        &context.project_id,
        run_id,
        &step.id,
        stage,
        &descriptor.risk_level,
        input_summary,
        result_summary.as_ref(),
        duration_ms,
        diagnostic_code,
    )
}
