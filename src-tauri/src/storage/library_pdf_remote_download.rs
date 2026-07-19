fn cache_remote_pdf_file<F>(
    cache_target: &Path,
    source_url: &str,
    allow_http_once: bool,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(u64, Option<u64>),
{
    use std::io::{Read, Write};

    const MAX_REMOTE_PDF_BYTES: u64 = 128 * 1024 * 1024;
    let mut response = crate::remote_network::blocking_get_with_policy(
        source_url,
        allow_http_once,
        std::time::Duration::from_secs(15),
        std::time::Duration::from_secs(120),
        "LatoTex/0.1.3",
    )?;
    let status = response.status();
    if !status.is_success() {
        return Err(format!("remote.http_status:{status}"));
    }
    if response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(|value| {
            let normalized = value.to_ascii_lowercase();
            normalized.starts_with("text/html") || normalized.starts_with("application/xhtml+xml")
        })
        .unwrap_or(false)
    {
        return Err("remote.pdf_html_rejected".to_string());
    }
    let declared_length = response.content_length();
    if declared_length
        .map(|value| value > MAX_REMOTE_PDF_BYTES)
        .unwrap_or(false)
    {
        return Err("remote.pdf_too_large".to_string());
    }

    if let Some(parent) = cache_target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let temp_path = temp_cache_path(cache_target);
    let mut file = std::fs::File::create(&temp_path).map_err(|e| e.to_string())?;
    let total_bytes = declared_length;
    let mut downloaded_bytes = 0_u64;
    let mut header = Vec::<u8>::with_capacity(32);
    let mut buffer = [0_u8; 64 * 1024];
    on_progress(downloaded_bytes, total_bytes);

    loop {
        let read = response.read(&mut buffer).map_err(|e| e.to_string())?;
        if read == 0 {
            break;
        }
        downloaded_bytes = downloaded_bytes.saturating_add(read as u64);
        if downloaded_bytes > MAX_REMOTE_PDF_BYTES {
            let _ = fs::remove_file(&temp_path);
            return Err("remote.pdf_too_large".to_string());
        }
        file.write_all(&buffer[..read]).map_err(|error| {
            let _ = fs::remove_file(&temp_path);
            error.to_string()
        })?;
        if header.len() < 32 {
            let remaining = 32_usize.saturating_sub(header.len());
            header.extend_from_slice(&buffer[..read.min(remaining)]);
        }
        on_progress(downloaded_bytes, total_bytes);
    }

    file.flush().map_err(|error| {
        let _ = fs::remove_file(&temp_path);
        error.to_string()
    })?;
    if declared_length
        .map(|value| value != downloaded_bytes)
        .unwrap_or(false)
    {
        let _ = fs::remove_file(&temp_path);
        return Err("remote.content_length_mismatch".to_string());
    }
    if !pdf_bytes_valid(&header) {
        let _ = fs::remove_file(&temp_path);
        return Err("remote.pdf_invalid".to_string());
    }
    fs::rename(&temp_path, cache_target).map_err(|e| {
        let _ = fs::remove_file(&temp_path);
        e.to_string()
    })?;
    on_progress(downloaded_bytes, total_bytes);
    Ok(())
}
