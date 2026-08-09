#[cfg(test)]
mod tests {
    use super::{
        build_tool_search_context_with, downgrade_unsupported_research_lines,
        unsupported_research_lines,
    };
    use crate::commands::analysis::{
        ReferenceCheckItem, ReferenceCheckResponse, ReferenceEvidence,
    };
    use crate::storage;
    use std::fs;
    use std::path::PathBuf;
    use uuid::Uuid;

    fn project_fixture() -> (PathBuf, PathBuf, PathBuf, String) {
        let root = std::env::temp_dir().join(format!("latotex-search-tool-{}", Uuid::new_v4()));
        let runtime_root = root.join("runtime");
        let db_path = runtime_root.join("latotex.db");
        let projects_root = root.join("projects");
        fs::create_dir_all(&runtime_root).unwrap();
        fs::create_dir_all(&projects_root).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let snapshot = storage::create_project(&db_path, &projects_root, "Knowledge").unwrap();
        (root, db_path, runtime_root, snapshot.summary.id)
    }

    #[test]
    fn web_search_disabled_still_returns_local_knowledge_without_provider_call() {
        let (root, db_path, runtime_root, project_id) = project_fixture();
        let project_root = storage::load_project_root(&db_path, &project_id).unwrap();
        fs::write(
            project_root.join("local.md"),
            "# Local evidence\n\nA fixed seed makes the analysis reproducible.",
        )
        .unwrap();
        storage::archive_knowledge_item(&db_path, &project_id, "local.md", None).unwrap();
        let context = build_tool_search_context_with(
            &db_path,
            &runtime_root,
            None,
            &project_id,
            "[tool_search.queries.v1]\n- fixed seed",
            false,
            |_, _, _, _, _, _, _, _| panic!("network provider must stay disabled"),
        );

        assert!(context
            .compact_context
            .contains("web_search=disabled_by_settings"));
        assert!(context.compact_context.contains("local_knowledge"));
        assert_eq!(context.local_evidence_ids.len(), 1);
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn agent_search_forwards_project_scope_and_keeps_local_bib_evidence() {
        let (root, db_path, runtime_root, project_id) = project_fixture();
        let context = build_tool_search_context_with(
            &db_path,
            &runtime_root,
            None,
            &project_id,
            "[tool_search.queries.v1]\n- reproducible local evidence",
            true,
            |received_db,
             received_runtime,
             received_app_data,
             received_project,
             queries,
             limit,
             email,
             deep| {
                assert_eq!(received_db, db_path.as_path());
                assert_eq!(received_runtime, runtime_root.as_path());
                assert_eq!(received_app_data, None);
                assert_eq!(received_project, Some(project_id.as_str()));
                assert_eq!(queries, vec!["reproducible local evidence"]);
                assert_eq!(limit, 4);
                assert_eq!(email, None);
                assert!(deep);
                let local = ReferenceEvidence {
                    stable_id: "bib:fixture2026".to_string(),
                    title: "Local Bib Fixture".to_string(),
                    authors: vec!["A. Researcher".to_string()],
                    year: Some(2026),
                    venue: None,
                    doi: None,
                    arxiv_id: None,
                    open_access: None,
                    pdf_url: None,
                    landing_url: "refs.bib#fixture2026".to_string(),
                    citation_count: None,
                    abstract_text: None,
                    source: "local_bib".to_string(),
                    evidence_level: "metadata".to_string(),
                    provenance: vec!["local_bib".to_string()],
                    original_source_url: "refs.bib#fixture2026".to_string(),
                    fulltext_document_hash: None,
                    fulltext_anchors: Vec::new(),
                    retraction_status: "unknown".to_string(),
                    correction_status: "unknown".to_string(),
                    rrf_score: 0.0,
                    url: "refs.bib#fixture2026".to_string(),
                    snippet: String::new(),
                };
                Ok(ReferenceCheckResponse {
                    items: vec![ReferenceCheckItem {
                        query: "reproducible local evidence".to_string(),
                        query_snapshot_id: "query-snapshot-fixture".to_string(),
                        stop_reason: "providers_exhausted".to_string(),
                        ok: true,
                        message: "academic.search.complete".to_string(),
                        results: vec![local.clone()],
                        academic_results: vec![local],
                        web_results: Vec::new(),
                        provider_errors: Vec::new(),
                        provider_health: Vec::new(),
                        network_used: true,
                    }],
                })
            },
        );

        assert_eq!(context.evidence_count, 1);
        assert!(context
            .compact_context
            .contains("[academic; metadata; providers=local_bib] Local Bib Fixture"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn agent_search_includes_bounded_local_knowledge_evidence_ids() {
        let root =
            std::env::temp_dir().join(format!("latotex-search-knowledge-{}", Uuid::new_v4()));
        let runtime_root = root.join("runtime");
        let db_path = runtime_root.join("latotex.db");
        let projects_root = root.join("projects");
        fs::create_dir_all(&runtime_root).unwrap();
        fs::create_dir_all(&projects_root).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let snapshot = storage::create_project(&db_path, &projects_root, "Knowledge").unwrap();
        let project_root = storage::load_project_root(&db_path, &snapshot.summary.id).unwrap();
        fs::write(
            project_root.join("protocol.md"),
            "# Protocol\n\nThe preregistered analysis uses a fixed random seed.",
        )
        .unwrap();
        storage::archive_knowledge_item(&db_path, &snapshot.summary.id, "protocol.md", None)
            .unwrap();

        let context = build_tool_search_context_with(
            &db_path,
            &runtime_root,
            None,
            &snapshot.summary.id,
            "[tool_search.queries.v1]\n- fixed random seed",
            true,
            |_, _, _, _, queries, _, _, deep| {
                assert!(deep);
                Ok(ReferenceCheckResponse {
                    items: queries
                        .into_iter()
                        .map(|query| ReferenceCheckItem {
                            query,
                            query_snapshot_id: "query-snapshot-fixture".to_string(),
                            stop_reason: "no_results".to_string(),
                            ok: true,
                            message: "academic.search.complete".to_string(),
                            results: Vec::new(),
                            academic_results: Vec::new(),
                            web_results: Vec::new(),
                            provider_errors: Vec::new(),
                            provider_health: Vec::new(),
                            network_used: false,
                        })
                        .collect(),
                })
            },
        );

        assert!(context.evidence_count >= 1);
        assert!(context
            .compact_context
            .contains("local_knowledge; evidence_id=knowledge:"));
        assert!(context.compact_context.contains("source=protocol.md"));
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn unsupported_facts_are_downgraded_after_one_repair_budget() {
        let context = super::ToolSearchContext {
            queries: vec!["fixture".to_string()],
            compact_context: String::new(),
            evidence_count: 2,
            local_evidence_ids: ["knowledge:1".to_string()].into_iter().collect(),
            network_urls: ["https://example.org/paper".to_string()]
                .into_iter()
                .collect(),
        };
        let draft = [
            "Supported local fact. [knowledge:1]",
            "Supported network fact. https://example.org/paper",
            "Unsupported factual claim.",
            "Inference: this remains a hypothesis.",
        ]
        .join("\n");

        assert_eq!(unsupported_research_lines(&draft, &context), vec![2]);
        let downgraded = downgrade_unsupported_research_lines(&draft, &context);
        assert!(downgraded.contains("Unconfirmed: Unsupported factual claim."));
        assert!(!downgraded.contains("Unconfirmed: Supported local fact."));
    }
}
