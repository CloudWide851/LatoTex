use super::{
    analysis_resource_candidates, runtime_dependency_fingerprint, strip_windows_verbatim_prefix,
};
use std::fs;
use std::path::PathBuf;
use uuid::Uuid;

fn unique_temp_dir(name: &str) -> PathBuf {
    let path = std::env::temp_dir().join(format!("latotex-analysis-env-{name}-{}", Uuid::new_v4()));
    fs::create_dir_all(&path).unwrap();
    path
}

#[test]
fn strips_windows_verbatim_prefixes() {
    assert_eq!(
        strip_windows_verbatim_prefix("\\\\?\\C:\\Workspace\\Demo"),
        "C:/Workspace/Demo"
    );
    assert_eq!(
        strip_windows_verbatim_prefix("\\\\?\\UNC\\server\\share\\demo"),
        "//server/share/demo"
    );
}

#[test]
fn runtime_dependency_fingerprint_ignores_python_caches() {
    let runtime_root = unique_temp_dir("runtime-root");
    fs::write(runtime_root.join("analysis_runner.py"), "print('ok')\\n").unwrap();
    fs::write(runtime_root.join("module.py"), "VALUE = 1\\n").unwrap();

    let base = runtime_dependency_fingerprint(&runtime_root, None).unwrap();

    let pycache_file = runtime_root
        .join("__pycache__")
        .join("module.cpython-312.pyc");
    fs::create_dir_all(pycache_file.parent().unwrap()).unwrap();
    fs::write(&pycache_file, b"compiled").unwrap();

    let pytest_cache_file = runtime_root.join(".pytest_cache").join("README.md");
    fs::create_dir_all(pytest_cache_file.parent().unwrap()).unwrap();
    fs::write(&pytest_cache_file, "cache\\n").unwrap();

    let mypy_cache_file = runtime_root.join(".mypy_cache").join("module.meta.json");
    fs::create_dir_all(mypy_cache_file.parent().unwrap()).unwrap();
    fs::write(&mypy_cache_file, "{}\\n").unwrap();

    let cached = runtime_dependency_fingerprint(&runtime_root, None).unwrap();
    assert_eq!(base, cached);

    fs::write(runtime_root.join("module.py"), "VALUE = 2\\n").unwrap();
    let changed = runtime_dependency_fingerprint(&runtime_root, None).unwrap();
    assert_ne!(base, changed);

    let _ = fs::remove_dir_all(runtime_root);
}

#[test]
fn analysis_resource_candidates_include_packaged_resource_paths() {
    let candidates = analysis_resource_candidates("resources/python/analysis_runtime");
    let rendered = candidates
        .iter()
        .map(|value| value.to_string_lossy().replace('\\', "/"))
        .collect::<Vec<_>>();

    assert!(rendered
        .iter()
        .any(|value| value.ends_with("/resources/python/analysis_runtime")));
    assert!(rendered
        .iter()
        .any(|value| value.contains("../src-tauri/resources/python/analysis_runtime")));
}
