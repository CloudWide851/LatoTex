use super::*;

fn step(id: &str, dependencies: Vec<String>) -> ResearchPlanStep {
    ResearchPlanStep {
        id: id.to_string(),
        order: 0,
        enabled: true,
        dependencies,
        capability: "project.overview".to_string(),
        input: serde_json::json!({}),
        risk_level: "read".to_string(),
        status: "pending".to_string(),
        run_id: None,
    }
}

#[test]
fn execution_order_respects_dependencies_after_user_reordering() {
    let plan = ResearchPlanVersion {
        id: "plan-1".to_string(),
        task_id: "task-1".to_string(),
        version: 1,
        source_message: "Research".to_string(),
        approval_status: "approved".to_string(),
        authorized_project_ids: vec!["project-1".to_string()],
        steps: vec![
            step("synthesis", vec!["search".to_string()]),
            step("search", Vec::new()),
        ],
        created_at: "2026-08-07T00:00:00Z".to_string(),
        approved_at: Some("2026-08-07T00:01:00Z".to_string()),
    };

    let ordered = ordered_execution_steps(&plan).unwrap();
    assert_eq!(
        ordered
            .iter()
            .map(|item| item.id.as_str())
            .collect::<Vec<_>>(),
        vec!["search", "synthesis"]
    );
}

#[test]
fn worker_registry_single_flights_and_releases_runs() {
    let key = format!("project:run-{}", uuid::Uuid::new_v4());
    assert!(claim_research_worker(&key).unwrap());
    assert!(!claim_research_worker(&key).unwrap());
    super::worker::release_research_worker(&key);
    assert!(claim_research_worker(&key).unwrap());
    super::worker::release_research_worker(&key);
}
