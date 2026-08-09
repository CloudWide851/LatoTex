use crate::models::{
    Ack, AgentResourceLock, AgentResourceLockListInput, AgentResourceLockReleaseInput,
    ClaimEvidenceAssessInput, ClaimEvidenceAssessment, ClaimEvidenceAssessmentListInput,
    EvidencePacket, EvidencePacketListInput, EvidencePacketUpsertInput, ResearchAgentRun,
    ResearchCapabilityDescriptor, ResearchChangeCheckpoint, ResearchChangeCheckpointListInput,
    ResearchChangeCheckpointUndoInput, ResearchChangeCheckpointUndoResult,
    ResearchChatMigrationInput, ResearchChatMigrationResult, ResearchChatStore,
    ResearchChatStoreReplaceInput, ResearchPlanApproval, ResearchPlanApprovalResolveInput,
    ResearchPlanApproveInput, ResearchPlanExecuteInput, ResearchPlanExecutionAccepted,
    ResearchPlanSaveInput, ResearchPlanVersion, ResearchProjectInput, ResearchRunControlInput,
    ResearchRunListInput, ResearchRunRecoveryResponse, ResearchRunsRecoverInput, ResearchTask,
    ResearchTaskCreateInput, ResearchUiCommand, ResearchUiCommandListInput,
    ResearchUiCommandResolveInput, ResearchWorkspaceSnapshot,
};
use crate::state::AppState;
use crate::storage;
use tauri::State;

#[tauri::command]
pub fn research_capability_registry() -> Vec<ResearchCapabilityDescriptor> {
    crate::research_agent::capability_registry()
}

#[tauri::command]
pub fn research_workspace_get(
    state: State<'_, AppState>,
    input: ResearchProjectInput,
) -> Result<ResearchWorkspaceSnapshot, String> {
    storage::research_workspace_snapshot(&state.db_path, &state.runtime_root, &input.project_id)
}

#[tauri::command]
pub fn research_task_create(
    state: State<'_, AppState>,
    input: ResearchTaskCreateInput,
) -> Result<ResearchTask, String> {
    storage::create_research_task(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_plan_save(
    state: State<'_, AppState>,
    input: ResearchPlanSaveInput,
) -> Result<ResearchPlanVersion, String> {
    storage::save_research_plan(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_plan_approve(
    state: State<'_, AppState>,
    input: ResearchPlanApproveInput,
) -> Result<ResearchPlanVersion, String> {
    storage::approve_research_plan(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_chat_store_get(
    state: State<'_, AppState>,
    input: ResearchProjectInput,
) -> Result<ResearchChatStore, String> {
    storage::research_chat_store_get(&state.db_path, &state.runtime_root, &input.project_id)
}

#[tauri::command]
pub fn research_chat_store_replace(
    state: State<'_, AppState>,
    input: ResearchChatStoreReplaceInput,
) -> Result<ResearchChatStore, String> {
    storage::research_chat_store_replace(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_chat_store_migrate(
    state: State<'_, AppState>,
    input: ResearchChatMigrationInput,
) -> Result<ResearchChatMigrationResult, String> {
    storage::research_chat_store_migrate(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_resource_lock_list(
    state: State<'_, AppState>,
    input: AgentResourceLockListInput,
) -> Result<Vec<AgentResourceLock>, String> {
    storage::list_research_resource_locks(&state.db_path, &input.project_id)
}

#[tauri::command]
pub fn research_resource_lock_release(
    state: State<'_, AppState>,
    input: AgentResourceLockReleaseInput,
) -> Result<Ack, String> {
    let released =
        storage::release_research_resource_locks(&state.db_path, &input.project_id, &input.run_id)?;
    Ok(Ack {
        ok: true,
        message: format!("research.lock.released:{released}"),
    })
}

#[tauri::command]
pub fn research_plan_execute(
    state: State<'_, AppState>,
    input: ResearchPlanExecuteInput,
) -> Result<ResearchPlanExecutionAccepted, String> {
    super::research_agent_execution::start_plan_execution(
        &state,
        &input.project_id,
        &input.task_id,
        input.version,
    )
}

#[tauri::command]
pub fn research_run_list(
    state: State<'_, AppState>,
    input: ResearchRunListInput,
) -> Result<Vec<ResearchAgentRun>, String> {
    let project_ids = if let Some(project_id) = input.project_id {
        vec![project_id]
    } else {
        storage::list_projects(&state.db_path)?
            .into_iter()
            .map(|project| project.id)
            .collect()
    };
    let mut runs = Vec::new();
    for project_id in project_ids {
        runs.extend(storage::list_research_plan_runs(
            &state.db_path,
            &state.runtime_root,
            &project_id,
            input.include_terminal.unwrap_or(false),
        )?);
    }
    runs.sort_by(|left, right| right.updated_at.cmp(&left.updated_at));
    Ok(runs)
}

#[tauri::command]
pub fn research_ui_command_list(
    state: State<'_, AppState>,
    input: ResearchUiCommandListInput,
) -> Result<Vec<ResearchUiCommand>, String> {
    storage::list_pending_research_ui_commands(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
    )
}

#[tauri::command]
pub fn research_ui_command_resolve(
    state: State<'_, AppState>,
    input: ResearchUiCommandResolveInput,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let pending = storage::list_pending_research_ui_commands(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
    )?
    .into_iter()
    .find(|command| command.run_id == input.run_id && command.step_id == input.step_id)
    .ok_or_else(|| "research.ui_command.not_pending".to_string())?;
    if input.status == "completed"
        && matches!(
            pending.command,
            crate::models::AgentAppCommand::ApplyLatexProposal { .. }
        )
    {
        storage::finalize_research_change_checkpoint(
            &state.db_path,
            &state.runtime_root,
            &input.project_id,
            &input.run_id,
            &input.step_id,
        )?;
    }
    let completed_steps =
        storage::resolve_research_ui_command(&state.db_path, &state.runtime_root, &input)?;
    storage::release_research_resource_locks(&state.db_path, &input.project_id, &input.run_id)?;
    if input.status == "completed" {
        storage::update_research_run_progress(
            &state.db_path,
            &state.runtime_root,
            &input.project_id,
            &input.run_id,
            "waiting_ui",
            Some(&input.step_id),
            completed_steps,
            Some("ui_command_completed"),
            None,
        )?;
        return super::research_agent_execution::resume_plan_execution(
            &state,
            &input.project_id,
            &input.run_id,
        );
    }
    storage::update_research_run_progress(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
        &input.run_id,
        "failed",
        Some(&input.step_id),
        completed_steps,
        Some("ui_command_failed"),
        input.diagnostic_code.as_deref(),
    )?;
    Ok(ResearchPlanExecutionAccepted {
        run_id: input.run_id,
        status: "failed".to_string(),
    })
}

fn set_research_run_status(
    state: &AppState,
    input: &ResearchRunControlInput,
    status: &str,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let run = storage::get_research_plan_run(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
        &input.run_id,
    )?;
    storage::update_research_run_progress(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
        &input.run_id,
        status,
        run.current_step_id.as_deref(),
        run.completed_steps,
        run.last_operation.as_deref(),
        None,
    )?;
    if status == "cancelled" {
        if !storage::research_run_has_active_lease(
            &state.db_path,
            &input.project_id,
            &input.run_id,
        )? {
            storage::release_research_resource_locks(
                &state.db_path,
                &input.project_id,
                &input.run_id,
            )?;
            storage::cancel_research_run_lease(&state.db_path, &input.project_id, &input.run_id)?;
        }
    }
    Ok(ResearchPlanExecutionAccepted {
        run_id: input.run_id.clone(),
        status: status.to_string(),
    })
}

#[tauri::command]
pub fn research_run_pause(
    state: State<'_, AppState>,
    input: ResearchRunControlInput,
) -> Result<ResearchPlanExecutionAccepted, String> {
    set_research_run_status(&state, &input, "paused")
}

#[tauri::command]
pub fn research_run_cancel(
    state: State<'_, AppState>,
    input: ResearchRunControlInput,
) -> Result<ResearchPlanExecutionAccepted, String> {
    set_research_run_status(&state, &input, "cancelled")
}

#[tauri::command]
pub fn research_run_resume(
    state: State<'_, AppState>,
    input: ResearchRunControlInput,
) -> Result<ResearchPlanExecutionAccepted, String> {
    super::research_agent_execution::resume_plan_execution(&state, &input.project_id, &input.run_id)
}

#[tauri::command]
pub fn research_runs_recover(
    state: State<'_, AppState>,
    input: ResearchRunsRecoverInput,
) -> Result<ResearchRunRecoveryResponse, String> {
    super::research_agent_execution::recover_plan_executions(&state, &input.project_id)
}

#[tauri::command]
pub fn research_change_checkpoint_list(
    state: State<'_, AppState>,
    input: ResearchChangeCheckpointListInput,
) -> Result<Vec<ResearchChangeCheckpoint>, String> {
    storage::list_research_change_checkpoints(
        &state.db_path,
        &input.project_id,
        input.run_id.as_deref(),
    )
}

#[tauri::command]
pub fn research_change_checkpoint_undo(
    state: State<'_, AppState>,
    input: ResearchChangeCheckpointUndoInput,
) -> Result<ResearchChangeCheckpointUndoResult, String> {
    storage::undo_research_change_checkpoint(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
        &input.checkpoint_id,
    )
}

#[tauri::command]
pub fn research_plan_approval_list(
    state: State<'_, AppState>,
    input: ResearchProjectInput,
) -> Result<Vec<ResearchPlanApproval>, String> {
    storage::list_research_plan_approvals(&state.db_path, &state.runtime_root, &input.project_id)
}

#[tauri::command]
pub fn research_plan_approval_resolve(
    state: State<'_, AppState>,
    input: ResearchPlanApprovalResolveInput,
) -> Result<ResearchPlanExecutionAccepted, String> {
    let (run_id, _) = storage::resolve_research_plan_approval(
        &state.db_path,
        &input.project_id,
        &input.approval_id,
        &input.decision,
    )?;
    if input.decision == "approved" {
        return super::research_agent_execution::resume_plan_execution(
            &state,
            &input.project_id,
            &run_id,
        );
    }
    set_research_run_status(
        &state,
        &ResearchRunControlInput {
            project_id: input.project_id,
            run_id,
        },
        "cancelled",
    )
}

#[tauri::command]
pub fn research_evidence_upsert(
    state: State<'_, AppState>,
    input: EvidencePacketUpsertInput,
) -> Result<EvidencePacket, String> {
    storage::upsert_evidence_packet(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_evidence_list(
    state: State<'_, AppState>,
    input: EvidencePacketListInput,
) -> Result<Vec<EvidencePacket>, String> {
    storage::list_evidence_packets(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
        &input.task_id,
    )
}

#[tauri::command]
pub fn research_claim_assess(
    state: State<'_, AppState>,
    input: ClaimEvidenceAssessInput,
) -> Result<ClaimEvidenceAssessment, String> {
    storage::assess_claim_evidence(&state.db_path, &state.runtime_root, input)
}

#[tauri::command]
pub fn research_claim_assessment_list(
    state: State<'_, AppState>,
    input: ClaimEvidenceAssessmentListInput,
) -> Result<Vec<ClaimEvidenceAssessment>, String> {
    storage::list_claim_evidence_assessments(
        &state.db_path,
        &state.runtime_root,
        &input.project_id,
        &input.task_id,
    )
}
