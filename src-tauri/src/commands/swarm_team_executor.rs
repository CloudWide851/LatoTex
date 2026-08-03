use crate::models::AgentExecuteRequest;
use crate::storage;
use std::sync::atomic::AtomicBool;
use std::sync::Arc;

use super::swarm_executor::run_execute_pipeline_supervisor;
use super::swarm_graph_executor::run_execute_pipeline_graph;
use super::swarm_workflows::WorkflowDefinition;

fn prompt_requests_team(prompt: &str) -> bool {
    let lower = prompt.to_ascii_lowercase();
    lower.contains("teams")
        || lower.contains("team mode")
        || lower.contains("multi-agent")
        || lower.contains("multi agent")
        || prompt.contains("团队")
        || prompt.contains("协作")
        || prompt.contains("多Agent")
        || prompt.contains("多 agent")
        || prompt.contains("多智能体")
}

pub(super) fn should_use_team(input: &AgentExecuteRequest) -> bool {
    match input.team_mode.as_deref().unwrap_or("auto") {
        "force" => true,
        "off" => false,
        _ => prompt_requests_team(&input.prompt),
    }
}

pub(super) fn run_execute_pipeline_team(
    db_path: &std::path::Path,
    runtime_root: &std::path::Path,
    app_data_dir: &std::path::Path,
    session_log_path: &std::path::Path,
    run_id: &str,
    cancel_flag: &Arc<AtomicBool>,
    input: &AgentExecuteRequest,
    workflow: &WorkflowDefinition,
) -> Result<String, String> {
    let selection = storage::resolve_agent_execution_selection(db_path, input)?;
    let Some(graph) = selection.graph_template else {
        return run_execute_pipeline_supervisor(
            db_path,
            runtime_root,
            app_data_dir,
            run_id,
            cancel_flag,
            input,
            workflow,
        );
    };
    run_execute_pipeline_graph(
        db_path,
        runtime_root,
        app_data_dir,
        session_log_path,
        run_id,
        cancel_flag,
        input,
        workflow,
        &selection.profile,
        &graph,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(prompt: &str, team_mode: Option<&str>) -> AgentExecuteRequest {
        AgentExecuteRequest {
            project_id: "project".to_string(),
            workflow_id: "analysis.synthesize".to_string(),
            callsite: "analysis.workspace".to_string(),
            prompt: prompt.to_string(),
            context_refs: Vec::new(),
            model_override: None,
            bypass_cache: false,
            team_mode: team_mode.map(str::to_string),
            harness_profile_id: None,
            profile_id: None,
            graph_template_id: None,
        }
    }

    #[test]
    fn explicit_team_mode_wins_over_prompt_detection() {
        assert!(should_use_team(&request("ordinary request", Some("force"))));
        assert!(!should_use_team(&request(
            "multi-agent review",
            Some("off")
        )));
        assert!(should_use_team(&request("请进行多智能体协作", None)));
    }
}
