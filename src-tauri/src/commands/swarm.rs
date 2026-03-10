#[path = "swarm_pipeline.rs"]
mod swarm_pipeline;
#[path = "swarm_events.rs"]
mod swarm_events;
#[path = "swarm_tool_search.rs"]
mod swarm_tool_search;
#[path = "swarm_provider.rs"]
mod swarm_provider;
pub(crate) use swarm_provider::call_provider_with_retry;

use crate::models::{
    Ack, AgentRunAccepted, AgentRunCancelInput, AgentRunRequest, AgentRunStartAccepted,
    CompileRecord, CompileRecordInput, EventBatch, EventQuery,
};
use crate::state::AppState;
use crate::storage;
use std::sync::atomic::Ordering;
use std::thread;
use std::time::{Duration, Instant};
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
pub fn agent_run(
    state: State<'_, AppState>,
    input: AgentRunRequest,
) -> Result<AgentRunAccepted, String> {
    const WAIT_TIMEOUT_TOTAL: Duration = Duration::from_secs(900);
    const WAIT_INTERVAL: Duration = Duration::from_millis(240);

    state.log(
        "INFO",
        &format!(
            "agent_run(sync-through-start): role={}, project={}",
            input.role, input.project_id
        ),
    );
    let accepted = swarm_pipeline::agent_run_start(&state, input)?;
    let run_id = accepted.run_id.clone();
    let started_at = Instant::now();
    let mut cursor: i64 = 0;
    let mut fallback_output = String::new();

    loop {
        if started_at.elapsed() > WAIT_TIMEOUT_TOTAL {
            return Err("agent.run.timeout.total".to_string());
        }
        let batch = storage::events_since(
            &state.db_path,
            EventQuery {
                cursor: Some(cursor),
                limit: Some(240),
                run_id: Some(run_id.clone()),
                wait_ms: None,
            },
        )?;
        cursor = batch.next_cursor;

        for event in batch.events {
            let payload = event.payload;
            match event.kind.as_str() {
                "responses.output_text.delta" => {
                    if let Some(chunk) = payload.get("content").and_then(|value| value.as_str()) {
                        fallback_output.push_str(chunk);
                    }
                }
                "agent.run.completed" => {
                    let output = payload
                        .get("output")
                        .and_then(|value| value.as_str())
                        .map(|value| value.to_string())
                        .unwrap_or(fallback_output);
                    return Ok(AgentRunAccepted {
                        run_id,
                        status: "completed".to_string(),
                        output,
                    });
                }
                "agent.run.cancelled" => return Err("agent.run.cancelled".to_string()),
                "agent.run.failed" => {
                    let message = payload
                        .get("content")
                        .and_then(|value| value.as_str())
                        .filter(|value| !value.trim().is_empty())
                        .map(|value| value.to_string())
                        .or_else(|| {
                            payload
                                .get("message")
                                .and_then(|value| value.as_str())
                                .map(|value| value.to_string())
                        })
                        .unwrap_or_else(|| "agent.run.failed".to_string());
                    return Err(message);
                }
                _ => {}
            }
        }

        thread::sleep(WAIT_INTERVAL);
    }
}

#[tauri::command]
pub fn agent_run_start(
    state: State<'_, AppState>,
    input: AgentRunRequest,
) -> Result<AgentRunStartAccepted, String> {
    swarm_pipeline::agent_run_start(&state, input)
}

#[tauri::command]
pub fn agent_run_cancel(
    state: State<'_, AppState>,
    input: AgentRunCancelInput,
) -> Result<Ack, String> {
    let flags = state
        .agent_cancel_flags
        .lock()
        .map_err(|_| "failed to lock agent cancel flags".to_string())?;
    let flag = flags
        .get(&input.run_id)
        .ok_or_else(|| "agent run not found".to_string())?;
    flag.store(true, Ordering::Relaxed);
    state.log("INFO", &format!("agent_run_cancel requested: {}", input.run_id));
    Ok(Ack {
        ok: true,
        message: "cancelling".to_string(),
    })
}

#[tauri::command]
pub fn events_subscribe(state: State<'_, AppState>, query: EventQuery) -> Result<EventBatch, String> {
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
        thread::sleep(Duration::from_millis(120));
    }
}

