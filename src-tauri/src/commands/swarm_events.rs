use crate::storage;
use serde_json::json;
use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub(super) struct EventMetadata<'a> {
    pub workflow_id: &'a str,
    pub step_id: &'a str,
    pub callsite: &'a str,
    pub phase: Option<&'a str>,
    pub node_id: Option<&'a str>,
    pub parent_node_id: Option<&'a str>,
    pub decision: Option<&'a str>,
    pub risk_level: Option<&'a str>,
    pub artifact_refs: Option<&'a [String]>,
    pub requires_approval: Option<bool>,
}

impl<'a> EventMetadata<'a> {
    pub(super) fn base(workflow_id: &'a str, step_id: &'a str, callsite: &'a str) -> Self {
        Self {
            workflow_id,
            step_id,
            callsite,
            phase: None,
            node_id: None,
            parent_node_id: None,
            decision: None,
            risk_level: None,
            artifact_refs: None,
            requires_approval: None,
        }
    }
}

fn envelope(
    run_id: &str,
    source: &str,
    stage: &str,
    status: &str,
    title: &str,
    content: &str,
    card_key: &str,
) -> serde_json::Value {
    json!({
        "protocol": "json",
        "schema": "json-agent-envelope.v1",
        "runId": run_id,
        "source": source,
        "stage": stage,
        "status": status,
        "title": title,
        "content": content,
        "cardKey": card_key
    })
}

fn apply_metadata(payload: &mut serde_json::Value, metadata: EventMetadata<'_>) {
    if let Some(object) = payload.as_object_mut() {
        object.insert("workflowId".to_string(), json!(metadata.workflow_id));
        object.insert("stepId".to_string(), json!(metadata.step_id));
        object.insert("callsite".to_string(), json!(metadata.callsite));
        if let Some(value) = metadata.phase.filter(|value| !value.trim().is_empty()) {
            object.insert("phase".to_string(), json!(value));
        }
        if let Some(value) = metadata.node_id.filter(|value| !value.trim().is_empty()) {
            object.insert("nodeId".to_string(), json!(value));
        }
        if let Some(value) = metadata.parent_node_id.filter(|value| !value.trim().is_empty()) {
            object.insert("parentNodeId".to_string(), json!(value));
        }
        if let Some(value) = metadata.decision.filter(|value| !value.trim().is_empty()) {
            object.insert("decision".to_string(), json!(value));
        }
        if let Some(value) = metadata.risk_level.filter(|value| !value.trim().is_empty()) {
            object.insert("riskLevel".to_string(), json!(value));
        }
        if let Some(value) = metadata.artifact_refs {
            object.insert("artifactRefs".to_string(), json!(value));
        }
        if let Some(value) = metadata.requires_approval {
            object.insert("requiresApproval".to_string(), json!(value));
        }
    }
}

pub(super) fn append_protocol_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    role: &str,
    kind: &str,
    payload: serde_json::Value,
) -> Result<(), String> {
    storage::append_event(db_path, run_id, project_id, role, kind, payload)?;
    Ok(())
}

pub(super) fn emit_stage_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    source: &str,
    stage: &str,
    status: &str,
    title: &str,
    content: &str,
    metadata: EventMetadata<'_>,
) -> Result<(), String> {
    let kind = match status {
        "running" => "a2a.task.started",
        "success" | "completed" | "accepted" => "a2a.task.completed",
        _ => "a2a.task.failed",
    };
    let mut payload = envelope(
        run_id,
        source,
        stage,
        status,
        title,
        content,
        &format!("{run_id}:{stage}:{source}:{event_scope}"),
    );
    apply_metadata(&mut payload, metadata);
    append_protocol_event(db_path, run_id, project_id, event_scope, kind, payload)
}

pub(super) fn emit_tool_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    source: &str,
    stage: &str,
    tool_name: &str,
    status: &str,
    content: &str,
    metadata: EventMetadata<'_>,
) -> Result<(), String> {
    let kind = match status {
        "running" => "mcp.tool.call.started",
        "success" | "completed" => "mcp.tool.call.completed",
        _ => "mcp.tool.call.failed",
    };
    let mut payload = envelope(
        run_id,
        source,
        stage,
        status,
        &format!("{stage} · {tool_name}"),
        content,
        &format!("{run_id}:{stage}:{source}:{event_scope}:tool:{tool_name}"),
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("toolName".to_string(), json!(tool_name));
    }
    apply_metadata(&mut payload, metadata);
    append_protocol_event(db_path, run_id, project_id, event_scope, kind, payload)
}

pub(super) fn emit_response_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    event_scope: &str,
    source: &str,
    stage: &str,
    output: &str,
    metadata: EventMetadata<'_>,
) -> Result<(), String> {
    let card_key = format!("{run_id}:{stage}:{source}:{event_scope}:response");
    for chunk in output.as_bytes().chunks(520) {
        let text = String::from_utf8_lossy(chunk).to_string();
        let mut payload = envelope(
            run_id,
            source,
            stage,
            "running",
            &format!("{stage} · output"),
            &text,
            &card_key,
        );
        if let Some(object) = payload.as_object_mut() {
            object.insert("append".to_string(), json!(true));
        }
        apply_metadata(&mut payload, metadata);
        append_protocol_event(
            db_path,
            run_id,
            project_id,
            event_scope,
            "responses.output_text.delta",
            payload,
        )?;
    }
    let mut completed_payload = envelope(
        run_id,
        source,
        stage,
        "success",
        &format!("{stage} · output"),
        output,
        &card_key,
    );
    apply_metadata(&mut completed_payload, metadata);
    append_protocol_event(
        db_path,
        run_id,
        project_id,
        event_scope,
        "responses.output_text.completed",
        completed_payload,
    )?;
    Ok(())
}

pub(super) fn run_envelope(
    run_id: &str,
    status: &str,
    title: &str,
    content: &str,
    card_key: &str,
    metadata: EventMetadata<'_>,
) -> serde_json::Value {
    let mut payload = envelope(run_id, "system", "run", status, title, content, card_key);
    apply_metadata(&mut payload, metadata);
    payload
}
