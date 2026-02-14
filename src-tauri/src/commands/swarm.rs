use crate::models::{
    AgentRunAccepted, AgentRunRequest, CompileRecord, CompileRecordInput, EventBatch, EventQuery,
};
use crate::state::AppState;
use crate::storage;
use serde_json::json;
use tauri::State;
use uuid::Uuid;

#[tauri::command]
pub fn latex_compile_record(
    state: State<'_, AppState>,
    input: CompileRecordInput,
) -> Result<CompileRecord, String> {
    state.log(
        "INFO",
        &format!(
            "latex_compile_record: project={}, file={}, status={}",
            input.project_id, input.main_file, input.status
        ),
    );
    storage::record_compile(&state.db_path, input)
}

#[tauri::command]
pub fn agent_run(
    state: State<'_, AppState>,
    input: AgentRunRequest,
) -> Result<AgentRunAccepted, String> {
    state.log(
        "INFO",
        &format!("agent_run: role={}, project={}", input.role, input.project_id),
    );
    let run_id = Uuid::new_v4().to_string();
    storage::append_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &input.role,
        "agent.run.accepted",
        json!({
            "prompt": input.prompt,
            "contextRefs": input.context_refs,
            "modelOverride": input.model_override
        }),
    )?;

    let output = format!(
        "[{}] generated a task-level response. Use provider binding in settings for live model calls.",
        input.role
    );
    storage::append_event(
        &state.db_path,
        &run_id,
        &input.project_id,
        &input.role,
        "agent.run.completed",
        json!({
            "output": output
        }),
    )?;

    Ok(AgentRunAccepted {
        run_id,
        status: "completed".to_string(),
        output,
    })
}

#[tauri::command]
pub fn events_subscribe(state: State<'_, AppState>, query: EventQuery) -> Result<EventBatch, String> {
    state.log(
        "DEBUG",
        &format!(
            "events_subscribe: cursor={:?}, limit={:?}",
            query.cursor, query.limit
        ),
    );
    storage::events_since(&state.db_path, query)
}
