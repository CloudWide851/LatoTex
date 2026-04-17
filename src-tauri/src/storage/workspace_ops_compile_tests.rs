mod workspace_ops_compile_tests {
    use super::{
        fs_operation, remote_pdf_cache_binding_path_for_relative_path,
        to_library_annotation_relative_path,
    };
    use crate::models::FsOperationInput;
    use crate::storage;
    use std::fs;
    use std::path::PathBuf;

    fn unique_temp_dir(name: &str) -> PathBuf {
        let dir = std::env::temp_dir().join(format!(
            "latotex-workspace-op-{name}-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        dir
    }

    fn create_project_fixture(name: &str) -> (PathBuf, String, PathBuf, PathBuf) {
        let temp_root = unique_temp_dir(name);
        let runtime_root = temp_root.join("runtime");
        let projects_dir = runtime_root.join("projects");
        let db_path = runtime_root.join("latotex.db");

        fs::create_dir_all(&projects_dir).unwrap();
        storage::initialize_database(&db_path).unwrap();
        let snapshot = storage::create_project(&db_path, &projects_dir, "Workspace Op Test").unwrap();
        let project_id = snapshot.summary.id;
        let project_root = PathBuf::from(snapshot.summary.root_path);
        (temp_root, project_id, project_root, db_path)
    }

    #[test]
    fn library_bib_rename_moves_companion_pdf_and_annotation() {
        let (temp_root, project_id, project_root, db_path) = create_project_fixture("library-bundle");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        let source_pdf = papers_root.join("demo.pdf");
        fs::write(&source_bib, "@article{demo}").unwrap();
        fs::write(&source_pdf, b"%PDF-demo").unwrap();

        let annotation_relative = to_library_annotation_relative_path("demo.bib");
        let annotation_path = papers_root.join(annotation_relative.replace('/', "\\"));
        fs::create_dir_all(annotation_path.parent().unwrap()).unwrap();
        fs::write(&annotation_path, "{\"version\":4}").unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id: project_id.clone(),
                scope: "library".to_string(),
                action: "rename".to_string(),
                path: "demo.bib".to_string(),
                target_path: Some("grouped/demo-renamed.bib".to_string()),
                content: None,
            },
        )
        .unwrap();

        assert!(papers_root.join("grouped").join("demo-renamed.bib").exists());
        assert!(papers_root.join("grouped").join("demo-renamed.pdf").exists());
        let next_annotation = papers_root.join(
            to_library_annotation_relative_path("grouped/demo-renamed.bib").replace('/', "\\"),
        );
        assert!(next_annotation.exists());
        assert!(!source_bib.exists());
        assert!(!source_pdf.exists());
        assert!(!annotation_path.exists());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn library_bib_delete_removes_companion_pdf_and_annotation() {
        let (temp_root, project_id, project_root, db_path) =
            create_project_fixture("library-bundle-delete");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        let source_pdf = papers_root.join("demo.pdf");
        fs::write(&source_bib, "@article{demo}").unwrap();
        fs::write(&source_pdf, b"%PDF-demo").unwrap();

        let annotation_relative = to_library_annotation_relative_path("demo.bib");
        let annotation_path = papers_root.join(annotation_relative.replace('/', "\\"));
        fs::create_dir_all(annotation_path.parent().unwrap()).unwrap();
        fs::write(&annotation_path, "{\"version\":4}").unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id,
                scope: "library".to_string(),
                action: "delete".to_string(),
                path: "demo.bib".to_string(),
                target_path: None,
                content: None,
            },
        )
        .unwrap();

        assert!(!source_bib.exists());
        assert!(!source_pdf.exists());
        assert!(!annotation_path.exists());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn library_bib_copy_duplicates_annotation_and_remote_cache_binding() {
        let (temp_root, project_id, project_root, db_path) =
            create_project_fixture("library-bundle-copy");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        let source_pdf = papers_root.join("demo.pdf");
        fs::write(&source_bib, "@article{demo}").unwrap();
        fs::write(&source_pdf, b"%PDF-demo").unwrap();

        let annotation_relative = to_library_annotation_relative_path("demo.bib");
        let annotation_path = papers_root.join(annotation_relative.replace('/', "\\"));
        fs::create_dir_all(annotation_path.parent().unwrap()).unwrap();
        fs::write(&annotation_path, "{\"version\":4}").unwrap();

        let cache_dir = papers_root.join(".cache").join("remote-pdf");
        fs::create_dir_all(&cache_dir).unwrap();
        let cache_file = cache_dir.join("shared-cache.pdf");
        fs::write(&cache_file, b"%PDF-1.7\ncopy\n").unwrap();
        let binding_path =
            remote_pdf_cache_binding_path_for_relative_path(&papers_root, "demo.bib").unwrap();
        fs::write(
            &binding_path,
            "{\"source_url\":\"https://example.com/demo.pdf\",\"cache_file_name\":\"shared-cache.pdf\",\"updated_at_unix_ms\":1}",
        )
        .unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id,
                scope: "library".to_string(),
                action: "copy".to_string(),
                path: "demo.bib".to_string(),
                target_path: Some("archive/demo-copy.bib".to_string()),
                content: None,
            },
        )
        .unwrap();

        let copied_annotation = papers_root.join(
            to_library_annotation_relative_path("archive/demo-copy.bib").replace('/', "\\"),
        );
        let copied_binding = remote_pdf_cache_binding_path_for_relative_path(
            &papers_root,
            "archive/demo-copy.bib",
        )
        .unwrap();

        assert!(source_bib.exists());
        assert!(source_pdf.exists());
        assert!(annotation_path.exists());
        assert!(binding_path.exists());
        assert!(papers_root.join("archive").join("demo-copy.bib").exists());
        assert!(papers_root.join("archive").join("demo-copy.pdf").exists());
        assert!(copied_annotation.exists());
        assert!(copied_binding.exists());
        assert_eq!(
            fs::read_to_string(binding_path).unwrap(),
            fs::read_to_string(copied_binding).unwrap()
        );

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn library_bib_rename_moves_remote_cache_binding() {
        let (temp_root, project_id, project_root, db_path) =
            create_project_fixture("library-binding-move");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        fs::write(&source_bib, "@article{demo}").unwrap();

        let source_binding =
            remote_pdf_cache_binding_path_for_relative_path(&papers_root, "demo.bib").unwrap();
        fs::write(
            &source_binding,
            "{\"source_url\":\"https://example.com/demo.pdf\",\"cache_file_name\":\"cached.pdf\",\"updated_at_unix_ms\":2}",
        )
        .unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id,
                scope: "library".to_string(),
                action: "rename".to_string(),
                path: "demo.bib".to_string(),
                target_path: Some("renamed/demo.bib".to_string()),
                content: None,
            },
        )
        .unwrap();

        let target_binding =
            remote_pdf_cache_binding_path_for_relative_path(&papers_root, "renamed/demo.bib")
                .unwrap();
        assert!(!source_binding.exists());
        assert!(target_binding.exists());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn library_bib_delete_removes_remote_cache_binding_only() {
        let (temp_root, project_id, project_root, db_path) =
            create_project_fixture("library-binding-delete");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(&papers_root).unwrap();

        let source_bib = papers_root.join("demo.bib");
        fs::write(&source_bib, "@article{demo}").unwrap();

        let cache_dir = papers_root.join(".cache").join("remote-pdf");
        fs::create_dir_all(&cache_dir).unwrap();
        let cache_file = cache_dir.join("shared-cache.pdf");
        fs::write(&cache_file, b"%PDF-1.7\ncached\n").unwrap();
        let binding_path =
            remote_pdf_cache_binding_path_for_relative_path(&papers_root, "demo.bib").unwrap();
        fs::write(
            &binding_path,
            "{\"source_url\":\"https://example.com/demo.pdf\",\"cache_file_name\":\"shared-cache.pdf\",\"updated_at_unix_ms\":3}",
        )
        .unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id,
                scope: "library".to_string(),
                action: "delete".to_string(),
                path: "demo.bib".to_string(),
                target_path: None,
                content: None,
            },
        )
        .unwrap();

        assert!(!binding_path.exists());
        assert!(cache_file.exists());

        let _ = fs::remove_dir_all(temp_root);
    }

    #[test]
    fn library_directory_move_migrates_nested_annotation_and_remote_bindings() {
        let (temp_root, project_id, project_root, db_path) =
            create_project_fixture("library-directory-move");
        let papers_root = project_root.join(".latotex").join("papers");
        fs::create_dir_all(papers_root.join("incoming")).unwrap();

        let nested_bib = papers_root.join("incoming").join("demo.bib");
        let nested_pdf = papers_root.join("incoming").join("demo.pdf");
        fs::write(&nested_bib, "@article{demo}").unwrap();
        fs::write(&nested_pdf, b"%PDF-demo").unwrap();

        let annotation_path = papers_root.join(
            to_library_annotation_relative_path("incoming/demo.bib").replace('/', "\\"),
        );
        fs::create_dir_all(annotation_path.parent().unwrap()).unwrap();
        fs::write(&annotation_path, "{\"version\":4}").unwrap();

        let source_binding =
            remote_pdf_cache_binding_path_for_relative_path(&papers_root, "incoming/demo.bib")
                .unwrap();
        fs::write(
            &source_binding,
            "{\"source_url\":\"https://example.com/demo.pdf\",\"cache_file_name\":\"cached.pdf\",\"updated_at_unix_ms\":4}",
        )
        .unwrap();

        fs_operation(
            &db_path,
            FsOperationInput {
                project_id,
                scope: "library".to_string(),
                action: "move".to_string(),
                path: "incoming".to_string(),
                target_path: Some("archive/incoming".to_string()),
                content: None,
            },
        )
        .unwrap();

        let target_annotation = papers_root.join(
            to_library_annotation_relative_path("archive/incoming/demo.bib").replace('/', "\\"),
        );
        let target_binding = remote_pdf_cache_binding_path_for_relative_path(
            &papers_root,
            "archive/incoming/demo.bib",
        )
        .unwrap();

        assert!(papers_root.join("archive").join("incoming").join("demo.bib").exists());
        assert!(papers_root.join("archive").join("incoming").join("demo.pdf").exists());
        assert!(!annotation_path.exists());
        assert!(target_annotation.exists());
        assert!(!source_binding.exists());
        assert!(target_binding.exists());

        let _ = fs::remove_dir_all(temp_root);
    }
}
