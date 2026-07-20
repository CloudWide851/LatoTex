use super::ShareRuntime;

pub(super) fn share_pdf_ready(runtime: &ShareRuntime) -> bool {
    runtime.pdf_size_bytes > 0
        && runtime
            .pdf_cache_path
            .as_ref()
            .map(|path| path.exists())
            .unwrap_or(false)
}

fn share_pdf_cache_relative_path(runtime: &ShareRuntime) -> String {
    format!(".latotex/share/{}/latest.pdf", runtime.session_id)
}

pub(super) fn persist_uploaded_pdf(
    runtime: &mut ShareRuntime,
    decoded: &[u8],
) -> Result<(), String> {
    let pdf_path = crate::storage::atomic_write_under_root(
        &runtime.project_root,
        &share_pdf_cache_relative_path(runtime),
        decoded,
        crate::storage::WORKSPACE_BINARY_FILE_LIMIT,
    )?;
    runtime.pdf_cache_path = Some(pdf_path);
    runtime.pdf_size_bytes = decoded.len() as u64;
    runtime.pdf_updated_at = Some(chrono::Utc::now().to_rfc3339());
    Ok(())
}
