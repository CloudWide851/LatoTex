use serde_json::json;

use super::swarm_events::{run_envelope, EventMetadata};

pub(super) fn build_slot_failure_payload(
    run_id: &str,
    workflow_id: &str,
    callsite: &str,
    context_refs: &[String],
    message: &str,
) -> serde_json::Value {
    run_envelope(
        run_id,
        "error",
        "Run Failed",
        message,
        &format!("{run_id}:run:failed"),
        EventMetadata {
            phase: Some("run"),
            node_id: Some("run:failed"),
            parent_node_id: None,
            artifact_refs: Some(context_refs),
            ..EventMetadata::base(workflow_id, "run", callsite)
        },
    )
}

pub(super) fn build_run_terminal_payload(
    run_id: &str,
    workflow_id: &str,
    callsite: &str,
    kind: &str,
    content: &str,
) -> serde_json::Value {
    let (status, title, node_id) = match kind {
        "agent.run.completed" => ("success", "Run Completed", "run:completed"),
        "agent.run.cancelled" => ("cancelled", "Run Cancelled", "run:cancelled"),
        _ => ("error", "Run Failed", "run:failed"),
    };
    let mut payload = run_envelope(
        run_id,
        status,
        title,
        content,
        &format!("{run_id}:{node_id}"),
        EventMetadata {
            phase: Some("run"),
            node_id: Some(node_id),
            parent_node_id: None,
            artifact_refs: None,
            ..EventMetadata::base(workflow_id, "run", callsite)
        },
    );
    if kind == "agent.run.completed" {
        if let Some(object) = payload.as_object_mut() {
            object.insert("output".to_string(), json!(content));
        }
    }
    payload
}
