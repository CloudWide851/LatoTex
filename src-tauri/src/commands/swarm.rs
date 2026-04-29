#[path = "swarm_events.rs"]
mod swarm_events;
#[path = "swarm_executor.rs"]
mod swarm_executor;
#[path = "swarm_pipeline.rs"]
mod swarm_pipeline;
#[path = "swarm_provider.rs"]
mod swarm_provider;
#[path = "swarm_runtime.rs"]
mod swarm_runtime;
#[path = "swarm_supervisor.rs"]
mod swarm_supervisor;
#[path = "swarm_team_executor.rs"]
mod swarm_team_executor;
#[path = "swarm_tool_search.rs"]
mod swarm_tool_search;
#[path = "swarm_tool_workspace.rs"]
mod swarm_tool_workspace;
#[path = "swarm_tool_python.rs"]
mod swarm_tool_python;
#[path = "swarm_tool_mcp.rs"]
mod swarm_tool_mcp;
#[path = "swarm_workflows.rs"]
mod swarm_workflows;
pub(crate) use swarm_provider::{call_provider_with_retry, call_provider_with_retry_streaming};

use crate::models::{
    Ack, AgentExecuteCancelInput, AgentExecuteRequest, AgentExecuteStartAccepted, CompileRecord,
    CompileRecordInput, EventBatch, EventQuery,
};
use crate::state::AppState;
use crate::storage;
use std::sync::atomic::Ordering;
use std::time::{Duration, Instant};
use tokio::time::sleep;
use tauri::State;

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
pub fn agent_execute_start(
    state: State<'_, AppState>,
    input: AgentExecuteRequest,
) -> Result<AgentExecuteStartAccepted, String> {
    start_agent_execution(&state, input)
}

pub(crate) fn start_agent_execution(
    state: &AppState,
    input: AgentExecuteRequest,
) -> Result<AgentExecuteStartAccepted, String> {
    swarm_pipeline::agent_execute_start(state, input)
}

#[tauri::command]
pub fn agent_execute_cancel(
    state: State<'_, AppState>,
    input: AgentExecuteCancelInput,
) -> Result<Ack, String> {
    let flags = state
        .agent_cancel_flags
        .lock()
        .map_err(|_| "failed to lock agent cancel flags".to_string())?;
    let flag = flags
        .get(&input.run_id)
        .ok_or_else(|| "agent run not found".to_string())?;
    flag.store(true, Ordering::Relaxed);
    state.log(
        "INFO",
        &format!("agent_execute_cancel requested: {}", input.run_id),
    );
    Ok(Ack {
        ok: true,
        message: "cancelling".to_string(),
    })
}

#[tauri::command]
pub async fn events_subscribe(
    state: State<'_, AppState>,
    query: EventQuery,
) -> Result<EventBatch, String> {
    let wait_ms = query.wait_ms.unwrap_or(0).min(4_000);
    let mut next_query = query;
    next_query.wait_ms = None;

    if wait_ms == 0 {
        return storage::events_since(&state.db_path, next_query);
    }

    let started = Instant::now();
    let wait_deadline = Duration::from_millis(wait_ms);
    loop {
        let batch = storage::events_since(&state.db_path, next_query.clone())?;
        if !batch.events.is_empty() || started.elapsed() >= wait_deadline {
            return Ok(batch);
        }
        sleep(Duration::from_millis(120)).await;
    }
}
