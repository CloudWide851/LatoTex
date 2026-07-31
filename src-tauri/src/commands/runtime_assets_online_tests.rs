mod online_tests {
    use super::*;
    use crate::commands::plugins_trusted_recipes::{
        KNOWLEDGE_EMBEDDING_CONTRIBUTION_ID, KNOWLEDGE_EMBEDDING_PLUGIN_ID,
    };
    use uuid::Uuid;

    #[test]
    #[ignore = "downloads the pinned model and runs a real ONNX/HNSW smoke"]
    fn knowledge_embedding_runtime_asset_online_smoke() {
        let root =
            std::env::temp_dir().join(format!("latotex-knowledge-model-smoke-{}", Uuid::new_v4()));
        let runtime_root = root.join("runtime");
        let db_path = runtime_root.join("latotex.db");
        let projects_root = root.join("projects");
        fs::create_dir_all(&runtime_root).unwrap();
        fs::create_dir_all(&projects_root).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let snapshot =
            storage::create_project(&db_path, &projects_root, "Knowledge model smoke").unwrap();
        let project_root = storage::load_project_root(&db_path, &snapshot.summary.id).unwrap();
        fs::write(
            project_root.join("evidence.md"),
            "# Reproducible analysis\n\nA fixed random seed makes bootstrap intervals reproducible.",
        )
        .unwrap();
        storage::archive_knowledge_item(&db_path, &snapshot.summary.id, "evidence.md", None)
            .unwrap();

        let installed = install_blocking(
            &runtime_root,
            RuntimeAssetActionInput {
                plugin_id: KNOWLEDGE_EMBEDDING_PLUGIN_ID.to_string(),
                contribution_id: KNOWLEDGE_EMBEDDING_CONTRIBUTION_ID.to_string(),
            },
        )
        .unwrap();
        assert!(installed.installed);
        let job =
            storage::rebuild_knowledge_embeddings(&db_path, &runtime_root, &snapshot.summary.id)
                .unwrap();
        assert_eq!(job.state, "ready");
        assert!(job.total >= 1);
        let result = storage::search_knowledge(
            &db_path,
            &runtime_root,
            &crate::models::KnowledgeSearchInput {
                project_id: snapshot.summary.id.clone(),
                project_ids: None,
                query: "reproducible bootstrap analysis".to_string(),
                limit: Some(20),
                deep: Some(true),
                run_id: Some("knowledge-model-smoke".to_string()),
                semantic: Some(true),
            },
        )
        .unwrap();
        assert!(result.embedding.available);
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.match_kinds.iter().any(|kind| kind == "semantic")));
        assert!(result
            .hits
            .iter()
            .any(|hit| hit.relative_path == "evidence.md"));
        let _ = fs::remove_dir_all(root);
    }
}
