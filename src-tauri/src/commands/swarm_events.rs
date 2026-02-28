use crate::storage;
use serde_json::json;
use std::path::Path;

pub(super) fn envelope(
    run_id: &str,
    source: &str,
    stage: &str,
    status: &str,
    title: &str,
    content: &str,
    card_key: &str,
) -> serde_json::Value {
    json!({
        "protocol": "ison",
        "schema": "ison-agent-envelope.v1",
        "a2ui": {
            "version": "google-a2ui",
            "layout": "timeline-card",
            "collapsible": true
        },
        "runId": run_id,
        "source": source,
        "stage": stage,
        "status": status,
        "title": title,
        "content": content,
        "cardKey": card_key
    })
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
    role: &str,
    source: &str,
    stage: &str,
    status: &str,
    title: &str,
    content: &str,
) -> Result<(), String> {
    let kind = match status {
        "running" => "a2a.task.started",
        "success" => "a2a.task.completed",
        _ => "a2a.task.failed",
    };
    append_protocol_event(
        db_path,
        run_id,
        project_id,
        role,
        kind,
        envelope(
            run_id,
            source,
            stage,
            status,
            title,
            content,
            &format!("{run_id}:{stage}:{source}:{role}"),
        ),
    )
}

pub(super) fn emit_tool_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    role: &str,
    source: &str,
    stage: &str,
    tool_name: &str,
    status: &str,
    content: &str,
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
        &format!("{run_id}:{stage}:{source}:{role}:tool:{tool_name}"),
    );
    if let Some(object) = payload.as_object_mut() {
        object.insert("toolName".to_string(), json!(tool_name));
    }
    append_protocol_event(db_path, run_id, project_id, role, kind, payload)
}

pub(super) fn emit_response_event(
    db_path: &Path,
    run_id: &str,
    project_id: &str,
    role: &str,
    source: &str,
    stage: &str,
    output: &str,
) -> Result<(), String> {
    let card_key = format!("{run_id}:{stage}:{source}:{role}:response");
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
        append_protocol_event(
            db_path,
            run_id,
            project_id,
            role,
            "responses.output_text.delta",
            payload,
        )?;
    }
    append_protocol_event(
        db_path,
        run_id,
        project_id,
        role,
        "responses.output_text.completed",
        envelope(
            run_id,
            source,
            stage,
            "success",
            &format!("{stage} · output"),
            output,
            &card_key,
        ),
    )?;
    Ok(())
}
