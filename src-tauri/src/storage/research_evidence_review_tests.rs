#[cfg(target_os = "windows")]
mod research_evidence_review_tests {
    use super::*;
    use crate::models::{
        EvidenceLocator, EvidencePacketUpsertInput, ResearchFulltextDocumentGetInput,
        ResearchQuerySnapshotRecordInput, ResearchReviewProtocolSaveInput,
        ResearchScreeningConfirmBatchInput, ResearchScreeningDecisionInput,
        ResearchScreeningSuggestInput, ResearchTask, ResearchTaskCreateInput,
    };

    fn fixture() -> (PathBuf, PathBuf, ProjectSnapshot, ResearchTask) {
        let runtime_root =
            std::env::temp_dir().join(format!("latotex-research-evidence-{}", Uuid::new_v4()));
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");
        fs::create_dir_all(&projects_dir).unwrap();
        initialize_database(&db_path).unwrap();
        let project = create_project(&db_path, &projects_dir, "Evidence Review Test").unwrap();
        let task = create_research_task(
            &db_path,
            &runtime_root,
            ResearchTaskCreateInput {
                project_id: project.summary.id.clone(),
                goal: "Review reproducible evidence".to_string(),
                chat_session_id: None,
            },
        )
        .unwrap();
        (runtime_root, db_path, project, task)
    }

    #[test]
    fn open_fulltext_cache_round_trips_hash_anchored_encrypted_blocks() {
        let (runtime_root, db_path, project, task) = fixture();
        let project_id = project.summary.id;
        let project_root = load_project_root(&db_path, &project_id).unwrap();
        let bytes = b"%PDF-1.7\nfixture-open-access-document";
        let document = cache_research_fulltext_document(
            &db_path,
            &runtime_root,
            &project_id,
            &project_root,
            "https://repository.example/paper.pdf",
            bytes,
            vec![
                (
                    1,
                    "Introduction paragraph.\n\nMethods paragraph.".to_string(),
                ),
                (2, "Results paragraph with effect size 0.42.".to_string()),
            ],
        )
        .unwrap();
        assert_eq!(document.document_hash.len(), 64);
        assert_eq!(document.page_count, 2);
        assert_eq!(document.blocks[1].paragraph_index, 1);
        assert_eq!(document.blocks[2].page, 2);
        assert_eq!(document.blocks[2].text_hash.len(), 64);
        assert_eq!(
            fs::read(project_root.join(&document.relative_path)).unwrap(),
            bytes
        );

        let loaded = load_research_fulltext_document(
            &db_path,
            &runtime_root,
            ResearchFulltextDocumentGetInput {
                project_id: project_id.clone(),
                document_hash: document.document_hash.clone(),
            },
        )
        .unwrap();
        assert_eq!(loaded, document);
        let block = &loaded.blocks[2];
        let packet = upsert_evidence_packet(
            &db_path,
            &runtime_root,
            EvidencePacketUpsertInput {
                project_id: project_id.clone(),
                task_id: task.id,
                run_id: None,
                stable_id: None,
                source: "openalex".to_string(),
                doi: Some("10.1000/fulltext".to_string()),
                source_version: None,
                title: "Open fulltext study".to_string(),
                excerpt: block.text.clone(),
                locator: EvidenceLocator {
                    page: Some(block.page),
                    section: None,
                    paragraph: None,
                    document_hash: Some(block.document_hash.clone()),
                    paragraph_index: Some(block.paragraph_index),
                    text_hash: Some(block.text_hash.clone()),
                },
                retraction_status: Some("clear".to_string()),
                correction_status: Some("none".to_string()),
                source_url: "https://repository.example/paper.pdf".to_string(),
            },
        )
        .unwrap();
        assert_eq!(packet.locator.page, Some(2));
        assert_eq!(packet.locator.text_hash, Some(block.text_hash.clone()));
        let research_db = fs::read(project_root.join(".latotex/research/tasks.sqlite3")).unwrap();
        assert!(!research_db
            .windows("Results paragraph with effect size 0.42".len())
            .any(|window| window == b"Results paragraph with effect size 0.42"));

        let research_conn = open_research_database(&db_path, &project_id).unwrap();
        research_conn
            .execute(
                "UPDATE research_fulltext_blocks SET text_hash = ?2
                 WHERE document_hash = ?1 AND page = 2",
                params![document.document_hash, "0".repeat(64)],
            )
            .unwrap();
        drop(research_conn);
        let error = load_research_fulltext_document(
            &db_path,
            &runtime_root,
            ResearchFulltextDocumentGetInput {
                project_id,
                document_hash: document.document_hash,
            },
        )
        .unwrap_err();
        assert_eq!(error, "research.fulltext.text_hash_mismatch");
        let _ = fs::remove_dir_all(runtime_root);
    }

    #[test]
    fn screening_suggestions_remain_provisional_until_atomic_confirmation() {
        let (runtime_root, db_path, project, task) = fixture();
        let project_id = project.summary.id;
        save_research_review_protocol(
            &db_path,
            &runtime_root,
            ResearchReviewProtocolSaveInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                title: "Registered review protocol".to_string(),
                research_question: "Does the intervention improve survival?".to_string(),
                inclusion_criteria: vec!["Controlled human studies".to_string()],
                exclusion_criteria: vec!["Retracted evidence".to_string()],
            },
        )
        .unwrap();
        let snapshot = record_research_query_snapshot(
            &db_path,
            &runtime_root,
            ResearchQuerySnapshotRecordInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                stable_id: Some("query-snapshot-review-fixture".to_string()),
                query: "intervention survival".to_string(),
                sources: vec!["pubmed".to_string(), "crossref".to_string()],
                result_count: 12,
                stop_reason: "providers_exhausted".to_string(),
            },
        )
        .unwrap();
        let replayed = record_research_query_snapshot(
            &db_path,
            &runtime_root,
            ResearchQuerySnapshotRecordInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                stable_id: Some(snapshot.id.clone()),
                query: "mutated retry must not replace the snapshot".to_string(),
                sources: vec!["openalex".to_string()],
                result_count: 999,
                stop_reason: "result_limit".to_string(),
            },
        )
        .unwrap();
        assert_eq!(replayed, snapshot);
        let packet = upsert_evidence_packet(
            &db_path,
            &runtime_root,
            EvidencePacketUpsertInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                run_id: None,
                stable_id: Some("review-evidence-fixture".to_string()),
                source: "pubmed".to_string(),
                doi: Some("10.1000/review".to_string()),
                source_version: None,
                title: "Controlled survival study".to_string(),
                excerpt: "The intervention improved survival in the controlled cohort.".to_string(),
                locator: EvidenceLocator {
                    page: Some(7),
                    section: Some("Results".to_string()),
                    paragraph: None,
                    document_hash: None,
                    paragraph_index: None,
                    text_hash: None,
                },
                retraction_status: Some("clear".to_string()),
                correction_status: Some("none".to_string()),
                source_url: "https://doi.org/10.1000/review".to_string(),
            },
        )
        .unwrap();
        let suggestion = suggest_research_screening(
            &db_path,
            &runtime_root,
            ResearchScreeningSuggestInput {
                project_id: project_id.clone(),
                task_id: task.id.clone(),
                evidence_id: packet.id,
                recommendation: "include".to_string(),
                confidence: 0.91,
                suggestion_reason: "Matches the registered population and design.".to_string(),
            },
        )
        .unwrap();
        assert_eq!(suggestion.decision, "pending");
        let pending =
            load_research_review_workspace(&db_path, &runtime_root, &project_id, &task.id).unwrap();
        assert_eq!(pending.prisma.identified, 12);
        assert_eq!(pending.prisma.deduplicated, 1);
        assert_eq!(pending.prisma.screened, 0);
        assert_eq!(pending.prisma.included, 0);

        let confirmed = confirm_research_screenings(
            &db_path,
            &runtime_root,
            ResearchScreeningConfirmBatchInput {
                project_id,
                task_id: task.id,
                decisions: vec![ResearchScreeningDecisionInput {
                    screening_id: suggestion.id,
                    decision: "include".to_string(),
                    exclusion_reason: None,
                    full_text_reviewed: true,
                }],
            },
        )
        .unwrap();
        assert_eq!(confirmed.prisma.screened, 1);
        assert_eq!(confirmed.prisma.full_text_assessed, 1);
        assert_eq!(confirmed.prisma.included, 1);
        assert_eq!(confirmed.prisma.excluded, 0);
        let _ = fs::remove_dir_all(runtime_root);
    }
}
