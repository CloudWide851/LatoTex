use crate::models::{
    Ack, AgentBinding, AgentBindingDeleteInput, AgentBindingUpsertInput, AgentControlCatalogInput,
    AgentControlCatalogResponse, AgentControlDeleteResponse, AgentGraphDeleteInput,
    AgentGraphTemplate, AgentGraphUpsertInput, AgentProfile, AgentProfileDeleteInput,
    AgentProfileUpsertInput,
};
use crate::state::AppState;
use crate::storage;
use tauri::State;

#[tauri::command]
pub fn agent_control_catalog(
    state: State<'_, AppState>,
    input: AgentControlCatalogInput,
) -> Result<AgentControlCatalogResponse, String> {
    storage::agent_control_catalog(&state.db_path, input.project_id.as_deref())
}

#[tauri::command]
pub fn agent_profile_upsert(
    state: State<'_, AppState>,
    input: AgentProfileUpsertInput,
) -> Result<AgentProfile, String> {
    storage::upsert_agent_profile(&state.db_path, input.profile)
}

#[tauri::command]
pub fn agent_profile_delete(
    state: State<'_, AppState>,
    input: AgentProfileDeleteInput,
) -> Result<AgentControlDeleteResponse, String> {
    storage::delete_agent_profile(&state.db_path, input.profile_id.trim())
}

#[tauri::command]
pub fn agent_binding_upsert(
    state: State<'_, AppState>,
    input: AgentBindingUpsertInput,
) -> Result<AgentBinding, String> {
    storage::upsert_agent_binding(&state.db_path, input.binding)
}

#[tauri::command]
pub fn agent_binding_delete(
    state: State<'_, AppState>,
    input: AgentBindingDeleteInput,
) -> Result<Ack, String> {
    storage::delete_agent_binding(
        &state.db_path,
        input.project_id.as_deref(),
        input.callsite.trim(),
    )?;
    Ok(Ack {
        ok: true,
        message: "agent.binding.deleted".to_string(),
    })
}

#[tauri::command]
pub fn agent_graph_upsert(
    state: State<'_, AppState>,
    input: AgentGraphUpsertInput,
) -> Result<AgentGraphTemplate, String> {
    storage::upsert_agent_graph_template(&state.db_path, input.graph_template)
}

#[tauri::command]
pub fn agent_graph_delete(
    state: State<'_, AppState>,
    input: AgentGraphDeleteInput,
) -> Result<AgentControlDeleteResponse, String> {
    storage::delete_agent_graph_template(&state.db_path, input.graph_template_id.trim())
}
