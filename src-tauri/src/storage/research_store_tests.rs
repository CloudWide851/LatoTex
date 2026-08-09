#[cfg(target_os = "windows")]
mod research_store_tests {
    use super::*;
    use crate::models::{
        ResearchChatMessage, ResearchChatMigrationInput, ResearchChatSession, ResearchChatStore,
        ResearchPlanApproveInput, ResearchPlanSaveInput, ResearchPlanStepDraft,
        ResearchTaskCreateInput, ResearchUiCommandResolveInput,
    };

    fn fixture() -> (PathBuf, PathBuf, ProjectSnapshot) {
        let runtime_root =
            std::env::temp_dir().join(format!("latotex-research-store-{}", Uuid::new_v4()));
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");
        fs::create_dir_all(&projects_dir).unwrap();
        initialize_database(&db_path).unwrap();
        let project = create_project(&db_path, &projects_dir, "Research Store Test").unwrap();
        (runtime_root, db_path, project)
    }

    fn chat_store() -> ResearchChatStore {
        ResearchChatStore {
            sessions: vec![ResearchChatSession {
                id: "chat-session-1".to_string(),
                title: "Private literature discussion".to_string(),
                created_at: "2026-08-07T00:00:00Z".to_string(),
                updated_at: "2026-08-07T00:01:00Z".to_string(),
                messages: vec![ResearchChatMessage {
                    id: "chat-message-1".to_string(),
                    role: "user".to_string(),
                    text: "Confidential manuscript observation".to_string(),
                    created_at: "2026-08-07T00:00:30Z".to_string(),
                    run_id: Some("run-1".to_string()),
                    task_id: Some("task-linked".to_string()),
                }],
            }],
            active_session_id: Some("chat-session-1".to_string()),
            migration_completed: false,
            diagnostic_code: None,
        }
    }

    #[test]
    fn research_task_plan_and_chat_survive_restart_without_plaintext_at_rest() {
        let (runtime_root, db_path, project) = fixture();
        let project_id = project.summary.id;
        let task = create_research_task(
            &db_path,
            &runtime_root,
            ResearchTaskCreateInput {
                project_id: project_id.clone(),
                goal: "Private oncology hypothesis".to_string(),
                chat_session_id: Some("chat-session-1".to_string()),
            },
        )
        .unwrap();
        let plan = save_research_plan(
            &db_path,
            &runtime_root,
            ResearchPlanSaveInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                source_message: "Develop a reproducible plan".to_string(),
                authorized_project_ids: vec![project_id.clone()],
                title: "Reproducible oncology plan".to_string(),
                summary: "Find and validate evidence".to_string(),
                assumptions: vec!["Local project scope only".to_string()],
                expected_artifacts: vec!["Evidence summary".to_string()],
                acceptance_criteria: vec!["Every claim is traceable".to_string()],
                steps: vec![ResearchPlanStepDraft {
                    id: Some("search-evidence".to_string()),
                    enabled: true,
                    dependencies: Vec::new(),
                    capability: "literature.search".to_string(),
                    input: serde_json::json!({"queries":["private biomarker"]}),
                    risk_level: "high".to_string(),
                }],
            },
        )
        .unwrap();
        let approved = approve_research_plan(
            &db_path,
            &runtime_root,
            ResearchPlanApproveInput {
                project_id: project_id.clone(),
                task_id: task.id,
                version: plan.version,
            },
        )
        .unwrap();
        assert_eq!(approved.approval_status, "approved");
        assert_eq!(approved.steps[0].risk_level, "read");

        let migrated = research_chat_store_migrate(
            &db_path,
            &runtime_root,
            ResearchChatMigrationInput {
                project_id: project_id.clone(),
                migration_id: "localstorage-chat-v1".to_string(),
                store: chat_store(),
            },
        )
        .unwrap();
        assert!(migrated.migrated && migrated.verified);

        let snapshot = research_workspace_snapshot(&db_path, &runtime_root, &project_id).unwrap();
        assert_eq!(snapshot.tasks[0].goal, "Private oncology hypothesis");
        assert_eq!(
            snapshot.plans[0].steps[0].input["queries"][0],
            "private biomarker"
        );
        assert_eq!(
            snapshot.chat_store.sessions[0].messages[0].text,
            "Confidential manuscript observation"
        );
        assert!(snapshot.chat_store.migration_completed);

        let research_db = research_database_path(&db_path, &project_id).unwrap();
        let raw = String::from_utf8_lossy(&fs::read(research_db).unwrap()).to_string();
        for secret in [
            "Private oncology hypothesis",
            "Develop a reproducible plan",
            "private biomarker",
            "Private literature discussion",
            "Confidential manuscript observation",
        ] {
            assert!(!raw.contains(secret), "plaintext leaked: {secret}");
        }
    }

    #[test]
    fn chat_migration_is_idempotent_and_corrupted_ciphertext_never_falls_back_to_plaintext() {
        let (runtime_root, db_path, project) = fixture();
        let project_id = project.summary.id;
        let input = ResearchChatMigrationInput {
            project_id: project_id.clone(),
            migration_id: "localstorage-chat-v1".to_string(),
            store: chat_store(),
        };
        assert!(
            research_chat_store_migrate(&db_path, &runtime_root, input)
                .unwrap()
                .migrated
        );
        let second = research_chat_store_migrate(
            &db_path,
            &runtime_root,
            ResearchChatMigrationInput {
                project_id: project_id.clone(),
                migration_id: "localstorage-chat-v1".to_string(),
                store: chat_store(),
            },
        )
        .unwrap();
        assert!(!second.migrated);
        assert!(second.verified);

        let research_db = research_database_path(&db_path, &project_id).unwrap();
        let conn = Connection::open(research_db).unwrap();
        conn.execute(
            "UPDATE research_chat_messages SET text_envelope = 'plaintext must not load'",
            [],
        )
        .unwrap();
        let error = research_chat_store_get(&db_path, &runtime_root, &project_id).unwrap_err();
        assert_eq!(error, "research.crypto.envelope_invalid");
    }

    #[test]
    fn project_research_databases_are_isolated() {
        let (runtime_root, db_path, first_project) = fixture();
        let second_project = create_project(
            &db_path,
            &runtime_root.join("projects"),
            "Second Research Store",
        )
        .unwrap();
        create_research_task(
            &db_path,
            &runtime_root,
            ResearchTaskCreateInput {
                project_id: first_project.summary.id.clone(),
                goal: "Only visible in project one".to_string(),
                chat_session_id: None,
            },
        )
        .unwrap();
        let second =
            research_workspace_snapshot(&db_path, &runtime_root, &second_project.summary.id)
                .unwrap();
        assert!(second.tasks.is_empty());
        assert!(second.chat_store.sessions.is_empty());
    }

    #[test]
    fn resource_locks_allow_shared_reads_but_block_conflicting_writes() {
        let (_runtime_root, db_path, project) = fixture();
        let project_id = project.summary.id;
        acquire_research_resource_lock(&db_path, &project_id, "run-reader-a", "main.tex", "read")
            .unwrap();
        acquire_research_resource_lock(&db_path, &project_id, "run-reader-b", "main.tex", "read")
            .unwrap();
        assert_eq!(
            acquire_research_resource_lock(
                &db_path,
                &project_id,
                "run-writer",
                "main.tex",
                "write",
            )
            .unwrap_err(),
            "research.lock.conflict"
        );
        release_research_resource_locks(&db_path, &project_id, "run-reader-a").unwrap();
        release_research_resource_locks(&db_path, &project_id, "run-reader-b").unwrap();
        assert_eq!(
            acquire_research_resource_lock(
                &db_path,
                &project_id,
                "run-writer",
                "main.tex",
                "write",
            )
            .unwrap()
            .mode,
            "write"
        );
    }

    #[test]
    fn frontend_capability_waits_for_verified_ui_resolution() {
        let (runtime_root, db_path, project) = fixture();
        let project_id = project.summary.id;
        let task = create_research_task(
            &db_path,
            &runtime_root,
            ResearchTaskCreateInput {
                project_id: project_id.clone(),
                goal: "Open the literature workspace".to_string(),
                chat_session_id: None,
            },
        )
        .unwrap();
        let plan = save_research_plan(
            &db_path,
            &runtime_root,
            ResearchPlanSaveInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                source_message: "Navigate after approval".to_string(),
                authorized_project_ids: vec![project_id.clone()],
                title: String::new(),
                summary: String::new(),
                assumptions: Vec::new(),
                expected_artifacts: Vec::new(),
                acceptance_criteria: Vec::new(),
                steps: vec![ResearchPlanStepDraft {
                    id: Some("open-literature".to_string()),
                    enabled: true,
                    dependencies: Vec::new(),
                    capability: "ui.navigate".to_string(),
                    input: serde_json::json!({"pageId":"library"}),
                    risk_level: "high".to_string(),
                }],
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
        let (run, approved_plan) =
            create_research_plan_run(&db_path, &runtime_root, &project_id, &task.id, plan.version)
                .unwrap();
        let persisted = research_workspace_snapshot(&db_path, &runtime_root, &project_id).unwrap();
        assert_eq!(persisted.tasks[0].run_ids, vec![run.run_id.clone()]);
        let command =
            crate::research_agent::parse_app_command("ui.navigate", &approved_plan.steps[0].input)
                .unwrap();
        store_research_step_result(
            &db_path,
            &runtime_root,
            &project_id,
            &run.run_id,
            "open-literature",
            "waiting_ui",
            Some(&serde_json::to_value(&command).unwrap()),
            None,
        )
        .unwrap();
        update_research_run_progress(
            &db_path,
            &runtime_root,
            &project_id,
            &run.run_id,
            "waiting_ui",
            Some("open-literature"),
            0,
            Some("ui.navigate"),
            None,
        )
        .unwrap();
        let pending =
            list_pending_research_ui_commands(&db_path, &runtime_root, &project_id).unwrap();
        assert_eq!(pending.len(), 1);
        assert_eq!(pending[0].command, command);
        let resolution = ResearchUiCommandResolveInput {
            project_id: project_id.clone(),
            run_id: run.run_id.clone(),
            step_id: "open-literature".to_string(),
            status: "completed".to_string(),
            result: Some(serde_json::json!({"pageId":"library"})),
            diagnostic_code: None,
        };
        assert_eq!(
            resolve_research_ui_command(&db_path, &runtime_root, &resolution).unwrap(),
            1
        );
        assert_eq!(
            resolve_research_ui_command(&db_path, &runtime_root, &resolution).unwrap_err(),
            "research.ui_command.not_pending"
        );
        let research_db = research_database_path(&db_path, &project_id).unwrap();
        let conn = Connection::open(research_db).unwrap();
        let audit: (String, String, String, String, i64) = conn
            .query_row(
                "SELECT stage, risk_level, input_summary_envelope, result_summary_envelope,
                        duration_ms
                 FROM research_capability_audit WHERE run_id = ?1 AND step_id = ?2",
                params![run.run_id, "open-literature"],
                |row| {
                    Ok((
                        row.get(0)?,
                        row.get(1)?,
                        row.get(2)?,
                        row.get(3)?,
                        row.get(4)?,
                    ))
                },
            )
            .unwrap();
        assert_eq!(audit.0, "completed");
        assert_eq!(audit.1, "read");
        assert!(!audit.2.contains("ui.navigate"));
        assert!(!audit.3.contains("completed"));
        assert!(audit.4 >= 0);
    }

    #[test]
    fn claim_classification_excludes_retractions_and_detects_null_results() {
        let packet = |excerpt: &str, retraction_status: &str| crate::models::EvidencePacket {
            id: format!("evidence-{}", Uuid::new_v4().simple()),
            task_id: "task-1".to_string(),
            run_id: None,
            source: "pubmed".to_string(),
            doi: Some("10.1000/claim-fixture".to_string()),
            source_version: Some("v1".to_string()),
            title: "Claim fixture".to_string(),
            excerpt: excerpt.to_string(),
            locator: crate::models::EvidenceLocator {
                page: Some(2),
                section: Some("Results".to_string()),
                paragraph: Some("1".to_string()),
                document_hash: None,
                paragraph_index: None,
                text_hash: None,
            },
            content_hash: "fixture".to_string(),
            retraction_status: retraction_status.to_string(),
            correction_status: "none".to_string(),
            source_url: "https://doi.org/10.1000/claim-fixture".to_string(),
            created_at: "2026-08-07T00:00:00Z".to_string(),
        };
        let claim = "The treatment improves survival in the replication cohort";
        let null_result = packet(
            "No statistically significant survival difference was observed in the replication cohort.",
            "clear",
        );
        assert_eq!(classify_claim(claim, &[null_result]).0, "contradicted");

        let retracted_support = packet(
            "The treatment improves survival in the replication cohort.",
            "retracted",
        );
        let classified = classify_claim(claim, &[retracted_support]);
        assert_eq!(classified.0, "insufficient");
        assert_eq!(classified.1, "research.claim.retracted_evidence_only");

        let numeric_claim = "The treatment reduced mortality by 42% in 120 participants";
        let numeric_mismatch = packet(
            "The treatment reduced mortality by 18% in 120 participants.",
            "clear",
        );
        let classified = classify_claim(numeric_claim, &[numeric_mismatch]);
        assert_eq!(classified.0, "contradicted");
        assert_eq!(classified.1, "research.claim.numeric_conflict");

        let numeric_missing = packet(
            "The treatment reduced mortality in the participant cohort.",
            "clear",
        );
        let classified = classify_claim(numeric_claim, &[numeric_missing]);
        assert_eq!(classified.0, "insufficient");
        assert_eq!(classified.1, "research.claim.numeric_missing");

        let direction_claim = "The treatment improves survival in the cohort";
        let opposite_direction = packet(
            "The treatment decreased survival in the cohort.",
            "clear",
        );
        let classified = classify_claim(direction_claim, &[opposite_direction]);
        assert_eq!(classified.0, "contradicted");
        assert_eq!(classified.1, "research.claim.direction_conflict");
    }

    #[test]
    fn evidence_packets_are_hashed_encrypted_and_claim_scoped() {
        let (runtime_root, db_path, project) = fixture();
        let project_id = project.summary.id;
        let task = create_research_task(
            &db_path,
            &runtime_root,
            ResearchTaskCreateInput {
                project_id: project_id.clone(),
                goal: "Validate a biomarker claim".to_string(),
                chat_session_id: None,
            },
        )
        .unwrap();
        let packet = upsert_evidence_packet(
            &db_path,
            &runtime_root,
            crate::models::EvidencePacketUpsertInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                run_id: None,
                stable_id: Some("doi-10.1000-test".to_string()),
                source: "crossref".to_string(),
                doi: Some("10.1000/test".to_string()),
                source_version: Some("v2".to_string()),
                title: "Biomarker survival study".to_string(),
                excerpt: "The biomarker treatment improves survival in patients.".to_string(),
                locator: crate::models::EvidenceLocator {
                    page: Some(4),
                    section: Some("Results".to_string()),
                    paragraph: Some("2".to_string()),
                    document_hash: None,
                    paragraph_index: None,
                    text_hash: None,
                },
                retraction_status: Some("clear".to_string()),
                correction_status: Some("none".to_string()),
                source_url: "https://doi.org/10.1000/test".to_string(),
            },
        )
        .unwrap();
        assert_eq!(packet.content_hash.len(), 64);
        assert_eq!(packet.locator.page, Some(4));
        let assessment = assess_claim_evidence(
            &db_path,
            &runtime_root,
            crate::models::ClaimEvidenceAssessInput {
                project_id: project_id.clone(),
                task_id: task.id,
                claim: "Biomarker treatment improves survival in patients".to_string(),
                evidence_ids: vec![packet.id],
                repaired_claim: None,
            },
        )
        .unwrap();
        assert_eq!(assessment.status, "supported");
        assert!(!assessment.requires_unconfirmed_label);
        assert_eq!(assessment.verbatim_excerpts.len(), 1);

        let research_db = research_database_path(&db_path, &project_id).unwrap();
        let raw = String::from_utf8_lossy(&fs::read(research_db).unwrap()).to_string();
        assert!(!raw.contains("Biomarker survival study"));
        assert!(!raw.contains("improves survival in patients"));
        assert!(!raw.contains("https://doi.org/10.1000/test"));
    }

    #[test]
    fn research_network_policy_defaults_safe_and_round_trips_project_scope() {
        let (_runtime_root, db_path, project) = fixture();
        let project_id = project.summary.id;
        let initial = load_research_network_policy(&db_path, &project_id).unwrap();
        assert!(initial.academic_metadata_enabled);
        assert!(initial.verified_oa_download_enabled);
        assert!(!initial.external_model_evidence_excerpt_enabled);

        let updated = update_research_network_policy(
            &db_path,
            crate::models::ResearchNetworkPolicyUpdateInput {
                project_id: project_id.clone(),
                academic_metadata_enabled: false,
                verified_oa_download_enabled: false,
                external_model_evidence_excerpt_enabled: true,
            },
        )
        .unwrap();
        assert_eq!(updated.project_id, project_id);
        assert!(!updated.academic_metadata_enabled);
        assert!(!updated.verified_oa_download_enabled);
        assert!(updated.external_model_evidence_excerpt_enabled);
        assert_eq!(load_research_network_policy(&db_path, &updated.project_id).unwrap(), updated);
    }
}
