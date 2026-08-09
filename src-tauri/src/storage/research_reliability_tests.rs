#[cfg(target_os = "windows")]
mod research_reliability_tests {
    use super::*;
    use crate::models::{
        FileWriteInput, ResearchPlanApproveInput, ResearchPlanSaveInput, ResearchPlanStepDraft,
        ResearchTaskCreateInput,
    };

    struct Fixture {
        runtime_root: PathBuf,
        db_path: PathBuf,
        project_id: String,
        run_id: String,
    }

    fn fixture() -> Fixture {
        let runtime_root =
            std::env::temp_dir().join(format!("latotex-research-reliability-{}", Uuid::new_v4()));
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");
        fs::create_dir_all(&projects_dir).unwrap();
        initialize_database(&db_path).unwrap();
        let project = create_project(&db_path, &projects_dir, "Research Reliability").unwrap();
        let project_id = project.summary.id;
        write_project_file(
            &db_path,
            FileWriteInput {
                project_id: project_id.clone(),
                relative_path: "main.tex".to_string(),
                content: "private base manuscript".to_string(),
                knowledge_approval_token: None,
            },
        )
        .unwrap();
        let task = create_research_task(
            &db_path,
            &runtime_root,
            ResearchTaskCreateInput {
                project_id: project_id.clone(),
                goal: "Reliably apply manuscript proposals".to_string(),
                chat_session_id: None,
            },
        )
        .unwrap();
        let steps = ["apply-one", "apply-two"]
            .into_iter()
            .map(|id| ResearchPlanStepDraft {
                id: Some(id.to_string()),
                enabled: true,
                dependencies: Vec::new(),
                capability: "workspace.apply_latex".to_string(),
                input: json!({ "path": "main.tex", "proposalId": id }),
                risk_level: "write".to_string(),
            })
            .collect();
        let plan = save_research_plan(
            &db_path,
            &runtime_root,
            ResearchPlanSaveInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                source_message: "Apply two reviewed proposals".to_string(),
                authorized_project_ids: vec![project_id.clone()],
                title: "Reliable writes".to_string(),
                summary: String::new(),
                assumptions: Vec::new(),
                expected_artifacts: Vec::new(),
                acceptance_criteria: Vec::new(),
                steps,
            },
        )
        .unwrap();
        approve_research_plan(
            &db_path,
            &runtime_root,
            ResearchPlanApproveInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                version: plan.version,
            },
        )
        .unwrap();
        let (run, _) =
            create_research_plan_run(&db_path, &runtime_root, &project_id, &task.id, plan.version)
                .unwrap();
        Fixture {
            runtime_root,
            db_path,
            project_id,
            run_id: run.run_id,
        }
    }

    #[test]
    fn run_lease_is_transactional_owned_and_allows_expired_takeover() {
        let fixture = fixture();
        let first = claim_research_run_lease(
            &fixture.db_path,
            &fixture.project_id,
            &fixture.run_id,
            "instance-first",
        )
        .unwrap()
        .unwrap();
        assert!(claim_research_run_lease(
            &fixture.db_path,
            &fixture.project_id,
            &fixture.run_id,
            "instance-second",
        )
        .unwrap()
        .is_none());
        assert_eq!(
            heartbeat_research_run_lease(
                &fixture.db_path,
                &fixture.project_id,
                &fixture.run_id,
                "instance-first",
                "wrong-token",
            )
            .unwrap_err(),
            "research.run.lease_lost"
        );
        let research_db = research_database_path(&fixture.db_path, &fixture.project_id).unwrap();
        Connection::open(research_db)
            .unwrap()
            .execute(
                "UPDATE research_run_leases SET expires_at = '2000-01-01T00:00:00Z' WHERE run_id = ?1",
                params![fixture.run_id],
            )
            .unwrap();
        let second = claim_research_run_lease(
            &fixture.db_path,
            &fixture.project_id,
            &fixture.run_id,
            "instance-second",
        )
        .unwrap()
        .unwrap();
        assert_eq!(
            verify_research_run_lease(
                &fixture.db_path,
                &fixture.project_id,
                &fixture.run_id,
                "instance-first",
                &first,
            )
            .unwrap_err(),
            "research.run.lease_lost"
        );
        heartbeat_research_run_lease(
            &fixture.db_path,
            &fixture.project_id,
            &fixture.run_id,
            "instance-second",
            &second,
        )
        .unwrap();
        assert_eq!(
            release_research_run_lease(
                &fixture.db_path,
                &fixture.project_id,
                &fixture.run_id,
                "instance-first",
                &first,
            )
            .unwrap(),
            0
        );
        assert!(research_run_has_active_lease(
            &fixture.db_path,
            &fixture.project_id,
            &fixture.run_id,
        )
        .unwrap());
    }

    #[test]
    fn checkpoints_are_encrypted_and_undo_or_return_three_way_conflict() {
        let fixture = fixture();
        let first = prepare_research_change_checkpoint(
            &fixture.db_path,
            &fixture.runtime_root,
            &fixture.project_id,
            &fixture.run_id,
            "apply-one",
            "main.tex",
        )
        .unwrap();
        write_project_file(
            &fixture.db_path,
            FileWriteInput {
                project_id: fixture.project_id.clone(),
                relative_path: "main.tex".to_string(),
                content: "private applied manuscript".to_string(),
                knowledge_approval_token: None,
            },
        )
        .unwrap();
        let applied = finalize_research_change_checkpoint(
            &fixture.db_path,
            &fixture.runtime_root,
            &fixture.project_id,
            &fixture.run_id,
            "apply-one",
        )
        .unwrap();
        assert_eq!(applied.status, "applied");
        let research_db = research_database_path(&fixture.db_path, &fixture.project_id).unwrap();
        let raw = String::from_utf8_lossy(&fs::read(research_db).unwrap()).to_string();
        assert!(!raw.contains("private base manuscript"));
        assert!(!raw.contains("private applied manuscript"));
        let undone = undo_research_change_checkpoint(
            &fixture.db_path,
            &fixture.runtime_root,
            &fixture.project_id,
            &first.checkpoint_id,
        )
        .unwrap();
        assert_eq!(undone.outcome, "undone");
        assert_eq!(
            read_project_file(&fixture.db_path, &fixture.project_id, "main.tex")
                .unwrap()
                .content,
            "private base manuscript"
        );

        let second = prepare_research_change_checkpoint(
            &fixture.db_path,
            &fixture.runtime_root,
            &fixture.project_id,
            &fixture.run_id,
            "apply-two",
            "main.tex",
        )
        .unwrap();
        for content in ["private second application", "user continued editing"] {
            write_project_file(
                &fixture.db_path,
                FileWriteInput {
                    project_id: fixture.project_id.clone(),
                    relative_path: "main.tex".to_string(),
                    content: content.to_string(),
                    knowledge_approval_token: None,
                },
            )
            .unwrap();
            if content == "private second application" {
                finalize_research_change_checkpoint(
                    &fixture.db_path,
                    &fixture.runtime_root,
                    &fixture.project_id,
                    &fixture.run_id,
                    "apply-two",
                )
                .unwrap();
            }
        }
        let conflict = undo_research_change_checkpoint(
            &fixture.db_path,
            &fixture.runtime_root,
            &fixture.project_id,
            &second.checkpoint_id,
        )
        .unwrap();
        assert_eq!(conflict.outcome, "conflict");
        let conflict = conflict.conflict.unwrap();
        assert_eq!(conflict.base_content, "private base manuscript");
        assert_eq!(conflict.applied_content, "private second application");
        assert_eq!(conflict.current_content, "user continued editing");
        assert_eq!(
            read_project_file(&fixture.db_path, &fixture.project_id, "main.tex")
                .unwrap()
                .content,
            "user continued editing"
        );
    }
}
