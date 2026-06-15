use super::submission_pack_core::build_submission_pack;
use crate::models::{SubmissionPackBuildInput, SubmissionPackIssueInput};
use crate::storage;
use std::fs;
use std::path::PathBuf;
use zip::ZipArchive;

fn unique_temp_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!(
        "latotex-submission-pack-{name}-{}",
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
    let snapshot =
        storage::create_project(&db_path, &projects_dir, "Submission Pack Test").unwrap();
    let project_id = snapshot.summary.id;
    let project_root = PathBuf::from(snapshot.summary.root_path);
    (temp_root, project_id, project_root, db_path)
}

#[test]
fn writes_manifest_and_zip_when_gate_passes() {
    let (temp_root, project_id, project_root, db_path) = create_project_fixture("ready");
    fs::create_dir_all(project_root.join("figures")).unwrap();
    fs::write(
        project_root.join("main.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\includegraphics{figures/a}\n\\bibliography{refs}\n\\end{document}\n",
    )
    .unwrap();
    fs::write(project_root.join("refs.bib"), "@article{a,title={A}}\n").unwrap();
    fs::write(project_root.join("figures").join("a.png"), b"png").unwrap();

    let result = build_submission_pack(
        &db_path,
        SubmissionPackBuildInput {
            project_id,
            main_path: "main.tex".to_string(),
            profile_id: "generic".to_string(),
            gate_issues: Vec::new(),
            compile_diagnostics: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "ready");
    let zip_path = project_root.join(result.zip_path.as_ref().unwrap());
    assert!(zip_path.exists());
    let file = fs::File::open(zip_path).unwrap();
    let mut archive = ZipArchive::new(file).unwrap();
    assert!(archive.by_name("main.tex").is_ok());
    assert!(archive.by_name("refs.bib").is_ok());
    assert!(archive.by_name("figures/a.png").is_ok());
    assert!(project_root.join(result.manifest_path).exists());
    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn blocks_zip_when_gate_has_errors() {
    let (temp_root, project_id, project_root, db_path) = create_project_fixture("blocked-gate");
    fs::write(
        project_root.join("main.tex"),
        "\\begin{document}x\\end{document}\n",
    )
    .unwrap();

    let result = build_submission_pack(
        &db_path,
        SubmissionPackBuildInput {
            project_id,
            main_path: "main.tex".to_string(),
            profile_id: "generic".to_string(),
            gate_issues: vec![SubmissionPackIssueInput {
                id: "missingBibliography".to_string(),
                severity: "error".to_string(),
                count: Some(1),
                detail: Some("missing".to_string()),
            }],
            compile_diagnostics: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "blocked");
    assert!(result.zip_path.is_none());
    assert!(project_root.join(result.manifest_path).exists());
    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn rejects_outside_dependencies_and_skips_disallowed_files() {
    let (temp_root, project_id, project_root, db_path) = create_project_fixture("dependency");
    fs::write(
        project_root.join("main.tex"),
        "\\begin{document}\n\\input{../outside}\n\\includegraphics{figures/missing}\n\\end{document}\n",
    )
    .unwrap();
    fs::write(project_root.join("data.csv"), "x,y\n").unwrap();

    let result = build_submission_pack(
        &db_path,
        SubmissionPackBuildInput {
            project_id,
            main_path: "main.tex".to_string(),
            profile_id: "arxiv".to_string(),
            gate_issues: Vec::new(),
            compile_diagnostics: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(result.status, "blocked");
    assert!(result
        .blockers
        .iter()
        .any(|item| item.id == "submissionPack.pathOutsideProject"));
    assert!(result
        .blockers
        .iter()
        .any(|item| item.id == "submissionPack.missingDependency"));
    assert!(result
        .skipped_files
        .iter()
        .any(|item| item.path == "data.csv"));
    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn keeps_acm_profile_when_building_pack() {
    let (temp_root, project_id, project_root, db_path) = create_project_fixture("acm");
    fs::write(
        project_root.join("main.tex"),
        "\\documentclass{acmart}\n\\acmConference{Demo}{2026}{Remote}\n\\begin{document}\n\\begin{abstract}Short.\\end{abstract}\n\\cite{smith2024}\\bibliography{refs}\n\\end{document}\n",
    )
    .unwrap();
    fs::write(
        project_root.join("refs.bib"),
        "@article{smith2024,title={A}}\n",
    )
    .unwrap();

    let result = build_submission_pack(
        &db_path,
        SubmissionPackBuildInput {
            project_id,
            main_path: "main.tex".to_string(),
            profile_id: "acm".to_string(),
            gate_issues: Vec::new(),
            compile_diagnostics: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(result.profile_id, "acm");
    assert!(result
        .warnings
        .iter()
        .all(|item| item.id != "submissionPack.acmClassHint"));
    assert_eq!(result.status, "ready");
    let _ = fs::remove_dir_all(temp_root);
}

#[test]
fn reports_publisher_profile_warnings_without_blocking_zip() {
    let (temp_root, project_id, project_root, db_path) =
        create_project_fixture("publisher-warning");
    fs::write(
        project_root.join("main.tex"),
        "\\documentclass{article}\n\\begin{document}\n\\begin{abstract}Short.\\end{abstract}\n\\cite{smith2024}\\bibliography{refs}\n\\end{document}\n",
    )
    .unwrap();
    fs::write(
        project_root.join("refs.bib"),
        "@article{smith2024,title={A}}\n",
    )
    .unwrap();

    let result = build_submission_pack(
        &db_path,
        SubmissionPackBuildInput {
            project_id,
            main_path: "main.tex".to_string(),
            profile_id: "springer".to_string(),
            gate_issues: Vec::new(),
            compile_diagnostics: Vec::new(),
        },
    )
    .unwrap();

    assert_eq!(result.profile_id, "springer");
    assert!(result
        .warnings
        .iter()
        .any(|item| item.id == "submissionPack.springerClassHint"));
    assert!(result
        .warnings
        .iter()
        .any(|item| item.id == "submissionPack.springerKeywordsHint"));
    assert_eq!(result.status, "ready");
    assert!(result.zip_path.is_some());
    let _ = fs::remove_dir_all(temp_root);
}
