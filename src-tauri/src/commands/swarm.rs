#[path = "research_planning.rs"]
mod research_planning;
#[path = "swarm_events.rs"]
mod swarm_events;
#[path = "swarm_executor.rs"]
mod swarm_executor;
#[path = "swarm_external_dispatch.rs"]
mod swarm_external_dispatch;
#[path = "swarm_external_pipeline.rs"]
mod swarm_external_pipeline;
#[path = "swarm_external_runtime.rs"]
mod swarm_external_runtime;
#[path = "swarm_graph_executor.rs"]
mod swarm_graph_executor;
#[path = "swarm_harness.rs"]
mod swarm_harness;
#[path = "swarm_permissions.rs"]
mod swarm_permissions;
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
#[path = "swarm_terminal_payload.rs"]
mod swarm_terminal_payload;
#[path = "swarm_tool_mcp.rs"]
mod swarm_tool_mcp;
#[path = "swarm_tool_python.rs"]
mod swarm_tool_python;
#[path = "swarm_tool_search.rs"]
mod swarm_tool_search;
#[path = "swarm_tool_skills.rs"]
mod swarm_tool_skills;
#[path = "swarm_tool_workspace.rs"]
mod swarm_tool_workspace;
#[path = "swarm_workflows.rs"]
mod swarm_workflows;
pub(crate) use swarm_provider::{call_provider_with_retry, call_provider_with_retry_streaming};

pub(crate) fn migrate_research_skill_settings(
    ui_prefs: &mut Option<crate::models::UiPrefs>,
) -> bool {
    swarm_tool_skills::migrate_research_skill_settings(ui_prefs)
}

use crate::models::{
    Ack, AgentApprovalListInput, AgentApprovalRequest, AgentApprovalResolveInput,
    AgentExecuteCancelInput, AgentExecuteRequest, AgentExecuteStartAccepted, AgentPermissionGrant,
    AgentPermissionGrantRevokeInput, AgentRunsRecoverInput, AgentRunsRecoverResponse,
    CompileRecord, CompileRecordInput, EventBatch, EventQuery, McpServerConfig,
    McpValidationResult, ResearchSkillDescriptor, SkillValidationInput, SkillValidationResult,
};
use crate::state::AppState;
use crate::storage;
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
pub fn agent_execute_start(
    state: State<'_, AppState>,
    input: AgentExecuteRequest,
) -> Result<AgentExecuteStartAccepted, String> {
    swarm_pipeline::agent_execute_start(&state, input)
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
    let result = swarm_pipeline::cancel_agent_execution(&state, &input.run_id)?;
    state.log(
        "INFO",
        &format!("agent_execute_cancel requested: {}", input.run_id),
    );
    Ok(result)
}

fn expire_pending_approvals(state: &AppState) -> Result<(), String> {
    for context in storage::expire_pending_agent_approvals(&state.db_path)? {
        state.log(
            "INFO",
            &format!("agent approval expired: {}", context.approval.approval_id),
        );
        swarm_pipeline::expire_approval_context(state, context);
    }
    Ok(())
}

#[tauri::command]
pub fn agent_approval_list(
    state: State<'_, AppState>,
    input: AgentApprovalListInput,
) -> Result<Vec<AgentApprovalRequest>, String> {
    expire_pending_approvals(&state)?;
    storage::list_pending_agent_approvals(&state.db_path, input.project_id.as_deref())
}

#[tauri::command]
pub fn agent_approval_resolve(
    state: State<'_, AppState>,
    input: AgentApprovalResolveInput,
) -> Result<AgentExecuteStartAccepted, String> {
    let result =
        swarm_pipeline::resolve_agent_approval(&state, &input.approval_id, &input.decision)?;
    state.log(
        "INFO",
        &format!(
            "agent approval resolved: approval={}, decision={}",
            input.approval_id, input.decision
        ),
    );
    Ok(result)
}

#[tauri::command]
pub fn agent_permission_grants_list(
    state: State<'_, AppState>,
    input: AgentApprovalListInput,
) -> Result<Vec<AgentPermissionGrant>, String> {
    storage::list_agent_permission_grants(&state.db_path, input.project_id.as_deref())
}

#[tauri::command]
pub fn agent_permission_grant_revoke(
    state: State<'_, AppState>,
    input: AgentPermissionGrantRevokeInput,
) -> Result<Ack, String> {
    let revoked = storage::revoke_agent_permission_grant(&state.db_path, &input.grant_id)?;
    state.log(
        if revoked { "INFO" } else { "WARN" },
        &format!("agent permission grant revoke: {}", input.grant_id),
    );
    Ok(Ack {
        ok: revoked,
        message: if revoked { "revoked" } else { "not_found" }.to_string(),
    })
}

#[tauri::command]
pub fn agent_runs_recover(
    state: State<'_, AppState>,
    input: AgentRunsRecoverInput,
) -> Result<AgentRunsRecoverResponse, String> {
    expire_pending_approvals(&state)?;
    let flags = state
        .agent_cancel_flags
        .lock()
        .map_err(|_| "failed to lock agent cancel flags".to_string())?;
    let mut recovered_run_ids = flags.keys().cloned().collect::<Vec<_>>();
    drop(flags);
    for approval in
        storage::list_pending_agent_approvals(&state.db_path, input.project_id.as_deref())?
    {
        if !recovered_run_ids
            .iter()
            .any(|run_id| run_id == &approval.run_id)
        {
            recovered_run_ids.push(approval.run_id);
        }
    }
    state.log(
        "INFO",
        &format!(
            "agent_runs_recover: project={}, recovered={}",
            input.project_id.as_deref().unwrap_or(""),
            recovered_run_ids.len()
        ),
    );
    Ok(AgentRunsRecoverResponse { recovered_run_ids })
}

#[tauri::command]
pub fn agent_mcp_validate(input: McpServerConfig) -> Result<McpValidationResult, String> {
    swarm_tool_mcp::validate_mcp_server(input)
}

#[tauri::command]
pub fn agent_skill_validate(
    state: State<'_, AppState>,
    input: SkillValidationInput,
) -> Result<SkillValidationResult, String> {
    swarm_tool_skills::validate_skill(&state.db_path, &state.runtime_root, &input.skill_id)
}

#[tauri::command]
pub fn agent_skill_catalog(
    state: State<'_, AppState>,
) -> Result<Vec<ResearchSkillDescriptor>, String> {
    Ok(swarm_tool_skills::skill_catalog(
        &state.db_path,
        &state.runtime_root,
    ))
}

#[tauri::command]
pub fn events_subscribe(
    state: State<'_, AppState>,
    query: EventQuery,
) -> Result<EventBatch, String> {
    expire_pending_approvals(&state)?;
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
