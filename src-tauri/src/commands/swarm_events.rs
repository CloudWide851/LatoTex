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
    pub requires_approval: Option<bool>,
    pub team_id: Option<&'a str>,
    pub team_role_id: Option<&'a str>,
    pub team_role_name: Option<&'a str>,
    pub team_task_id: Option<&'a str>,
    pub artifact_refs: Option<&'a [String]>,
    pub harness_profile_id: Option<&'a str>,
    pub actions: Option<&'a serde_json::Value>,
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
            requires_approval: None,
            team_id: None,
            team_role_id: None,
            team_role_name: None,
            team_task_id: None,
            artifact_refs: None,
            harness_profile_id: None,
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
        if let Some(phase) = metadata.phase {
            object.insert("phase".to_string(), json!(phase));
        }
        if let Some(node_id) = metadata.node_id {
            object.insert("nodeId".to_string(), json!(node_id));
        }
        if let Some(parent_node_id) = metadata.parent_node_id {
            object.insert("parentNodeId".to_string(), json!(parent_node_id));
        }
        if let Some(decision) = metadata.decision {
            object.insert("decision".to_string(), json!(decision));
        }
        if let Some(risk_level) = metadata.risk_level {
            object.insert("riskLevel".to_string(), json!(risk_level));
        }
        if let Some(requires_approval) = metadata.requires_approval {
            object.insert("requiresApproval".to_string(), json!(requires_approval));
        }
        if let Some(team_id) = metadata.team_id {
            object.insert("teamId".to_string(), json!(team_id));
        }
        if let Some(team_role_id) = metadata.team_role_id {
            object.insert("teamRoleId".to_string(), json!(team_role_id));
        }
        if let Some(team_role_name) = metadata.team_role_name {
            object.insert("teamRoleName".to_string(), json!(team_role_name));
        }
        if let Some(team_task_id) = metadata.team_task_id {
            object.insert("teamTaskId".to_string(), json!(team_task_id));
        }
        if let Some(artifact_refs) = metadata.artifact_refs {
            object.insert("artifactRefs".to_string(), json!(artifact_refs));
        }
        if let Some(harness_profile_id) = metadata.harness_profile_id {
            object.insert("harnessProfileId".to_string(), json!(harness_profile_id));
        }
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
