use super::{run_extract_bridge, PaperRuntimeRunDir};
use crate::commands::native_runtime::{
    ensure_analysis_env_blocking, resolve_analysis_runtime_root,
};
use crate::storage;
use serde::{Deserialize, Serialize};
use std::collections::hash_map::DefaultHasher;
use std::fs;
use std::hash::{Hash, Hasher};
use std::path::{Path, PathBuf};
use std::time::UNIX_EPOCH;

#[derive(Clone, Debug, Deserialize, Serialize)]
#[serde(rename_all = "camelCase")]
pub(crate) struct WorkspacePdfContextExtract {
    pub content: String,
    pub page_count: u32,
    pub ocr_page_count: u32,
    pub extraction_engine: Option<String>,
    pub extraction_mode: Option<String>,
}

fn is_valid_cached_extract(value: &WorkspacePdfContextExtract) -> bool {
    !value.content.trim().is_empty()
        && !value.content.contains('\0')
        && value.page_count > 0
        && value.page_count <= 100_000
        && value.ocr_page_count <= value.page_count
}

fn cache_path(project_root: &Path, source_pdf_path: &Path) -> Result<PathBuf, String> {
    let metadata = storage::ensure_workspace_binary_file(source_pdf_path)?;
    let modified = metadata
        .modified()
        .ok()
        .and_then(|value| value.duration_since(UNIX_EPOCH).ok())
        .map(|value| value.as_nanos())
        .unwrap_or_default();
    let mut hasher = DefaultHasher::new();
    source_pdf_path.to_string_lossy().hash(&mut hasher);
    metadata.len().hash(&mut hasher);
    modified.hash(&mut hasher);
    let cache_dir = storage::prepare_workspace_mutation_path(
        project_root,
        ".latotex/paper-runtime/workspace-context-cache",
    )?;
    fs::create_dir_all(&cache_dir).map_err(|_| "workspace.operation.failed".to_string())?;
    Ok(cache_dir.join(format!("{:016x}.json", hasher.finish())))
}

fn load_cached(cache_path: &Path) -> Result<Option<WorkspacePdfContextExtract>, String> {
    if !cache_path.exists() {
        return Ok(None);
    }
    if storage::workspace_path_is_link_or_reparse(cache_path)? {
        return Err("workspace.path.reparse_denied".to_string());
    }
    let cached = storage::read_file_with_limit(cache_path, storage::WORKSPACE_TEXT_FILE_LIMIT)?;
    match serde_json::from_slice::<WorkspacePdfContextExtract>(&cached) {
        Ok(value) if is_valid_cached_extract(&value) => Ok(Some(value)),
        Ok(_) | Err(_) => {
            let _ = fs::remove_file(cache_path);
            Ok(None)
        }
    }
}

pub(crate) fn extract_workspace_pdf_context(
    db_path: &Path,
    app_runtime_root: &Path,
    app_data_dir: &Path,
    project_id: &str,
    project_root: &Path,
    source_pdf_path: &Path,
) -> Result<WorkspacePdfContextExtract, String> {
    let cache_path = cache_path(project_root, source_pdf_path)?;
    if let Some(cached) = load_cached(&cache_path)? {
        return Ok(cached);
    }

    let env_status = ensure_analysis_env_blocking(
        db_path,
        app_runtime_root,
        app_data_dir,
        project_id,
        project_root,
    )?;
    let python_path = PathBuf::from(
        env_status
            .python_path
            .ok_or_else(|| "python.env.python_missing".to_string())?,
    );
    let runtime_root =
        resolve_analysis_runtime_root().ok_or_else(|| "python.env.runtime_missing".to_string())?;
    let run_dir = PaperRuntimeRunDir::create(app_runtime_root)?;
    let extracted =
        run_extract_bridge(&python_path, &runtime_root, run_dir.path(), source_pdf_path)?;
    let content = extracted
        .blocks
        .iter()
        .filter(|block| block.role != "metadata" && !block.text.trim().is_empty())
        .map(|block| {
            let page = block.page.unwrap_or(1).max(1);
            format!("[Page {page}]\n{}", block.text.trim())
        })
        .collect::<Vec<_>>()
        .join("\n\n");
    if content.trim().is_empty() {
        return Err("analysis.context.pdf_extract_empty".to_string());
    }
    let response = WorkspacePdfContextExtract {
        content,
        page_count: extracted.page_count,
        ocr_page_count: extracted.ocr_page_count,
        extraction_engine: extracted.extraction_engine,
        extraction_mode: extracted.extraction_mode,
    };
    let serialized = serde_json::to_vec(&response)
        .map_err(|_| "analysis.context.pdf_cache_invalid".to_string())?;
    let _ = storage::atomic_write_file(&cache_path, &serialized);
    Ok(response)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::thread;
    use std::time::Duration;
    use uuid::Uuid;

    fn fixture() -> PathBuf {
        let root = std::env::temp_dir().join(format!("latotex-pdf-context-{}", Uuid::new_v4()));
        fs::create_dir_all(&root).unwrap();
        root
    }

    #[test]
    fn cache_round_trip_and_invalid_cache_recovery_are_bounded() {
        let root = fixture();
        let cache = root.join("entry.json");
        let expected = WorkspacePdfContextExtract {
            content: "extracted".to_string(),
            page_count: 2,
            ocr_page_count: 1,
            extraction_engine: Some("fixture".to_string()),
            extraction_mode: Some("ocr".to_string()),
        };
        fs::write(&cache, serde_json::to_vec(&expected).unwrap()).unwrap();
        assert_eq!(load_cached(&cache).unwrap().unwrap().content, "extracted");
        fs::write(&cache, b"{broken").unwrap();
        assert!(load_cached(&cache).unwrap().is_none());
        assert!(!cache.exists());
        let invalid_semantics = WorkspacePdfContextExtract {
            content: "   ".to_string(),
            page_count: 0,
            ocr_page_count: 1,
            extraction_engine: Some("fixture".to_string()),
            extraction_mode: Some("ocr".to_string()),
        };
        fs::write(&cache, serde_json::to_vec(&invalid_semantics).unwrap()).unwrap();
        assert!(load_cached(&cache).unwrap().is_none());
        assert!(!cache.exists());
        let _ = fs::remove_dir_all(root);
    }

    #[test]
    fn cache_identity_changes_when_same_size_file_changes() {
        let root = fixture();
        let source = root.join("paper.pdf");
        fs::write(&source, b"%PDF-a").unwrap();
        let first = cache_path(&root, &source).unwrap();
        thread::sleep(Duration::from_millis(15));
        fs::write(&source, b"%PDF-b").unwrap();
        let second = cache_path(&root, &source).unwrap();
        assert_ne!(first, second);
        let _ = fs::remove_dir_all(root);
    }
}
