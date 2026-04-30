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
    Ack, AgentExecuteCancelInput, AgentExecuteRequest, AgentExecuteStartAccepted,
    AgentRunsRecoverInput, AgentRunsRecoverResponse, CompileRecord, CompileRecordInput,
    EventBatch, EventQuery, McpServerConfig, McpValidationResult,
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
pub fn agent_runs_recover(
    state: State<'_, AppState>,
    input: AgentRunsRecoverInput,
) -> Result<AgentRunsRecoverResponse, String> {
    let records = storage::list_recoverable_agent_runs(
        &state.db_path,
        input.project_id.as_deref(),
    )?;
    let mut recovered_run_ids = Vec::new();
    for record in records {
        if storage::agent_run_has_terminal_event(&state.db_path, &record.run_id)? {
            continue;
        }
        {
            let flags = state
                .agent_cancel_flags
                .lock()
                .map_err(|_| "failed to lock agent cancel flags".to_string())?;
            if flags.contains_key(&record.run_id) {
                continue;
            }
        }
        let request = serde_json::from_str::<AgentExecuteRequest>(&record.request_json)
            .map_err(|e| format!("agent.run.recover.deserialize: {}", e))?;
        let lease_id = uuid::Uuid::new_v4().to_string();
        storage::mark_agent_run_recovering(&state.db_path, &record.run_id, &lease_id)?;
        swarm_pipeline::agent_execute_start_with_run_id(
            &state,
            request,
            record.run_id.clone(),
            true,
        )?;
        state.log(
            "INFO",
            &format!(
                "agent_runs_recover: run={}, project={}, workflow={}, callsite={}, previous_status={}, recovered_count={}",
                record.run_id,
                record.project_id,
                record.workflow_id,
                record.callsite,
                record.status,
                record.recovered_count + 1
            ),
        );
        recovered_run_ids.push(record.run_id);
    }
    Ok(AgentRunsRecoverResponse { recovered_run_ids })
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
pub fn agent_mcp_validate(
    state: State<'_, AppState>,
    input: McpServerConfig,
) -> Result<McpValidationResult, String> {
    state.log("INFO", &format!("agent_mcp_validate: {}", input.id));
    swarm_tool_mcp::validate_mcp_server(input)
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
