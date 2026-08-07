use super::*;

#[test]
fn runtime_path_requires_absolute_exe() {
    assert_eq!(
        validate_runtime_executable(Path::new("codex.exe")).unwrap_err(),
        "agent.runtime.path_invalid"
    );
    assert_eq!(
        validate_runtime_executable(Path::new("../codex.cmd")).unwrap_err(),
        "agent.runtime.path_invalid"
    );
}

#[test]
fn runtime_registry_is_closed() {
    assert_eq!(runtime_spec("codex-cli").unwrap().executable, "codex.exe");
    assert!(runtime_spec("custom-shell").is_err());
}

#[test]
fn provider_version_output_cannot_be_forged_by_exit_status_alone() {
    assert!(validate_version_output("codex-cli", "codex-cli 0.146.0").is_ok());
    assert!(validate_version_output("claude-code-cli", "2.1.179 (Claude Code)").is_ok());
    let failure = validate_version_output("codex-cli", "unrelated tool 1.0").unwrap_err();
    assert_eq!(failure.code, "agent.runtime.version_invalid");
}

#[test]
fn cached_catalog_starts_unchecked_without_running_discovery() {
    let root = std::env::temp_dir().join(format!(
        "latotex-runtime-cache-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&root).unwrap();
    let db_path = root.join("latotex.sqlite3");
    storage::initialize_database(&db_path).unwrap();

    let runtimes = cached_runtime_catalog(&db_path);
    let codex = runtimes.iter().find(|item| item.id == "codex-cli").unwrap();
    assert_eq!(codex.source, "unchecked");
    assert_eq!(codex.checked_at, None);
    assert_eq!(
        codex.failure.as_ref().unwrap().code,
        "agent.runtime.not_checked"
    );

    let mut stored = codex.clone();
    stored.source = "manual".to_string();
    stored.available = true;
    stored.authenticated = true;
    stored.version = Some("codex-cli 1.0.0".to_string());
    stored.checked_at = Some(chrono::Utc::now().to_rfc3339());
    storage::set_agent_runtime_snapshot(&db_path, &stored).unwrap();
    let cached = cached_runtime_catalog(&db_path);
    assert_eq!(
        cached
            .iter()
            .find(|item| item.id == "codex-cli")
            .unwrap()
            .version
            .as_deref(),
        Some("codex-cli 1.0.0")
    );
    let _ = std::fs::remove_dir_all(root);
}

#[test]
fn runtime_refresh_reason_is_closed() {
    assert!(validate_refresh_reason("startup").is_ok());
    assert!(validate_refresh_reason("manual").is_ok());
    assert_eq!(
        validate_refresh_reason("page-mount").unwrap_err(),
        "agent.runtime.refresh_reason_invalid"
    );
}
