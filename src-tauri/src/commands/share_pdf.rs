use super::ShareRuntime;
use std::fs;
use std::path::PathBuf;

pub(super) fn share_pdf_ready(runtime: &ShareRuntime) -> bool {
    runtime.pdf_size_bytes > 0
        && runtime
            .pdf_cache_path
            .as_ref()
            .map(|path| path.exists())
            .unwrap_or(false)
}

fn share_pdf_cache_path(runtime: &ShareRuntime) -> PathBuf {
    runtime
        .project_root
        .join(".latotex")
        .join("share")
        .join(&runtime.session_id)
        .join("latest.pdf")
}

pub(super) fn persist_uploaded_pdf(
    runtime: &mut ShareRuntime,
    decoded: &[u8],
) -> Result<(), String> {
    let pdf_path = share_pdf_cache_path(runtime);
    if let Some(parent) = pdf_path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(&pdf_path, decoded).map_err(|e| e.to_string())?;
    runtime.pdf_cache_path = Some(pdf_path);
    runtime.pdf_size_bytes = decoded.len() as u64;
    runtime.pdf_updated_at = Some(chrono::Utc::now().to_rfc3339());
    Ok(())
}
