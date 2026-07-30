use super::*;

fn temp_db_path() -> PathBuf {
    std::env::temp_dir().join(format!("latotex-agent-control-{}.sqlite3", Uuid::new_v4()))
}

#[test]
fn catalog_seeds_builtins_and_project_binding_overrides_global() {
    let db_path = temp_db_path();
    initialize_database(&db_path).unwrap();
    let catalog = agent_control_catalog(&db_path, Some("project-a")).unwrap();
    assert!(catalog
        .profiles
        .iter()
        .any(|profile| profile.id == "builtin-analyst"));
    assert_eq!(catalog.graph_templates[0].max_parallelism, 2);

    let binding = upsert_agent_binding(
        &db_path,
        crate::models::AgentBinding {
            project_id: Some("project-a".to_string()),
            callsite: "analysis.workspace".to_string(),
            profile_id: "builtin-reviewer".to_string(),
            graph_template_id: Some("builtin-research-workflow".to_string()),
            updated_at: String::new(),
        },
    )
    .unwrap();
    assert_eq!(binding.project_id.as_deref(), Some("project-a"));
    let (resolved, source) =
        resolve_agent_binding(&db_path, "project-a", "analysis.workspace").unwrap();
    assert_eq!(resolved.profile_id, "builtin-reviewer");
    assert_eq!(source, "project");
    let _ = fs::remove_file(db_path);
}

#[test]
fn graph_validation_rejects_cycles_and_permission_escalation() {
    let now = now_iso();
    let mut graph = built_in_research_graph(&now);
    graph.id = "custom-cycle".to_string();
    graph.built_in = false;
    graph.edges.push(crate::models::AgentGraphEdge {
        from: "synthesize".to_string(),
        to: "plan".to_string(),
    });
    assert_eq!(
        validate_agent_graph_template(&graph).unwrap_err(),
        "agent.graph.cycle"
    );

    let mut profile = built_in_agent_profiles(&now).remove(0);
    profile.id = "custom-profile".to_string();
    profile.built_in = false;
    profile.write_scopes = vec!["../outside.tex".to_string()];
    assert_eq!(
        validate_agent_profile(&profile).unwrap_err(),
        "agent.profile.invalid_scope"
    );
}

#[test]
fn deleting_profile_falls_back_all_global_and_project_bindings() {
    let db_path = temp_db_path();
    initialize_database(&db_path).unwrap();
    let mut profile = get_agent_profile(&db_path, "builtin-researcher")
        .unwrap()
        .unwrap();
    profile.id = "custom-delete-fallback".to_string();
    profile.name = "Delete fallback fixture".to_string();
    profile.built_in = false;
    profile.created_at.clear();
    profile.updated_at.clear();
    upsert_agent_profile(&db_path, profile).unwrap();

    for project_id in [None, Some("project-a"), Some("project-b")] {
        upsert_agent_binding(
            &db_path,
            crate::models::AgentBinding {
                project_id: project_id.map(str::to_string),
                callsite: "analysis.workspace".to_string(),
                profile_id: "custom-delete-fallback".to_string(),
                graph_template_id: Some("builtin-research-workflow".to_string()),
                updated_at: String::new(),
            },
        )
        .unwrap();
    }

    let response = delete_agent_profile(&db_path, "custom-delete-fallback").unwrap();
    assert!(response.deleted);
    assert_eq!(response.affected_bindings.len(), 3);
    for project_id in ["project-a", "project-b"] {
        let (binding, _) =
            resolve_agent_binding(&db_path, project_id, "analysis.workspace").unwrap();
        assert_eq!(binding.profile_id, "builtin-analyst");
    }
    let (global, source) =
        resolve_agent_binding(&db_path, "unbound-project", "analysis.workspace").unwrap();
    assert_eq!(global.profile_id, "builtin-analyst");
    assert_eq!(source, "global");
    let _ = fs::remove_file(db_path);
}
