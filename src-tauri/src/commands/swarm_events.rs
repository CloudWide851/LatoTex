use crate::storage;
use serde_json::json;
use std::path::Path;

#[derive(Debug, Clone, Copy)]
pub(super) struct EventMetadata<'a> {
    pub workflow_id: &'a str,
    pub step_id: &'a str,
    pub callsite: &'a str,
    pub actions: Option<&'a serde_json::Value>,
}

impl<'a> EventMetadata<'a> {
    pub(super) fn base(workflow_id: &'a str, step_id: &'a str, callsite: &'a str) -> Self {
        Self {
            workflow_id,
            step_id,
            callsite,
            actions: None,
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
        if let Some(actions) = metadata.actions {
            object.insert("actions".to_string(), actions.clone());
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
        "success" => "a2a.task.completed",
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
        "success" => "mcp.tool.call.completed",
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
