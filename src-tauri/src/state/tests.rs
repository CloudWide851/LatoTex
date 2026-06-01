use super::{copy_runtime_candidates, resolve_runtime_root, should_migrate_runtime_data};
use std::fs;
use std::path::PathBuf;
use std::sync::{Mutex, OnceLock};
use uuid::Uuid;

fn runtime_env_lock() -> std::sync::MutexGuard<'static, ()> {
    static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
    LOCK.get_or_init(|| Mutex::new(())).lock().unwrap()
}

fn unique_temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("latotex-{}-{}", name, Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn copy_runtime_candidates_includes_python_envs() {
    let source_root = unique_temp_dir("runtime-source");
    let target_root = unique_temp_dir("runtime-target");
    let source_env_file = source_root
        .join("python-envs")
        .join("env-a")
        .join("venv")
        .join("marker.txt");
    fs::create_dir_all(source_env_file.parent().unwrap()).unwrap();
    fs::write(&source_env_file, "ready").unwrap();

    copy_runtime_candidates(&source_root, &target_root).unwrap();

    let target_env_file = target_root
        .join("python-envs")
        .join("env-a")
        .join("venv")
        .join("marker.txt");
    assert_eq!(fs::read_to_string(target_env_file).unwrap(), "ready");

    let _ = fs::remove_dir_all(source_root);
    let _ = fs::remove_dir_all(target_root);
}

#[test]
fn resolve_runtime_root_reuses_previous_existing_root() {
    let _guard = runtime_env_lock();
    std::env::remove_var("LATOTEX_E2E_RUNTIME_ROOT");
    let previous_root = unique_temp_dir("runtime-existing");

    let resolved = resolve_runtime_root(Some(&previous_root)).unwrap();

    assert_eq!(resolved, previous_root);

    let _ = fs::remove_dir_all(resolved);
}

#[test]
fn resolve_runtime_root_prefers_test_override() {
    let _guard = runtime_env_lock();
    let previous_root = unique_temp_dir("runtime-existing");
    let override_root =
        std::env::temp_dir().join(format!("latotex-runtime-override-{}", Uuid::new_v4()));
    std::env::set_var(
        "LATOTEX_E2E_RUNTIME_ROOT",
        override_root.to_string_lossy().to_string(),
    );

    let resolved = resolve_runtime_root(Some(&previous_root)).unwrap();

    std::env::remove_var("LATOTEX_E2E_RUNTIME_ROOT");
    assert_eq!(resolved, override_root);
    assert!(resolved.exists());

    let _ = fs::remove_dir_all(previous_root);
    let _ = fs::remove_dir_all(resolved);
}

#[test]
fn runtime_migration_is_disabled_for_smoke_and_override_roots() {
    assert!(!should_migrate_runtime_data(true, false));
    assert!(!should_migrate_runtime_data(false, true));
    assert!(should_migrate_runtime_data(false, false));
}
