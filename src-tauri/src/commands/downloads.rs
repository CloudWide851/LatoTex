use ring::digest::{digest, SHA256};
use std::fs;
use std::io::Write;
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

pub(crate) fn prefer_cn_source() -> bool {
    std::env::var("LANG")
        .or_else(|_| std::env::var("LC_ALL"))
        .unwrap_or_default()
        .to_ascii_lowercase()
        .starts_with("zh")
}

pub(crate) fn ordered_download_urls(primary: &str, cn: Option<&str>) -> Vec<String> {
    let primary = primary.trim();
    let cn = cn.map(str::trim).filter(|item| !item.is_empty());
    let mut urls = Vec::new();
    if prefer_cn_source() {
        if let Some(url) = cn {
            urls.push(url.to_string());
        }
        urls.push(primary.to_string());
    } else {
        urls.push(primary.to_string());
        if let Some(url) = cn {
            urls.push(url.to_string());
        }
    }
    urls.dedup();
    urls
}

pub(crate) fn download_verified(
    runtime_root: &Path,
    label: &str,
    urls: Vec<String>,
    expected_sha256: &str,
    timeout_secs: u64,
) -> Result<Vec<u8>, String> {
    let client = reqwest::blocking::Client::builder()
        .connect_timeout(Duration::from_secs(20))
        .timeout(Duration::from_secs(timeout_secs))
        .user_agent("LatoTex/0.1 plugin-runtime-downloader")
        .build()
        .map_err(|e| e.to_string())?;
    let download_dir = runtime_root.join("downloads");
    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let mut errors = Vec::new();
    for url in urls.into_iter().filter(|url| url.starts_with("https://")) {
        for attempt in 1..=3 {
            let temp_path = download_dir.join(format!(
                "{}-{}-{attempt}.part",
                safe_segment(label),
                crate::storage::now_iso().replace([':', '.'], "-")
            ));
            let result = (|| -> Result<Vec<u8>, String> {
                let mut response = client
                    .get(&url)
                    .send()
                    .map_err(|e| format!("{label}.download_failed: {e}"))?;
                if !response.status().is_success() {
                    return Err(format!("{label}.download_http: {}", response.status()));
                }
                let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
                response.copy_to(&mut file).map_err(|e| e.to_string())?;
                file.flush().map_err(|e| e.to_string())?;
                drop(file);
                let bytes = fs::read(&temp_path).map_err(|e| e.to_string())?;
                let actual = hex_digest(digest(&SHA256, &bytes).as_ref());
                if !actual.eq_ignore_ascii_case(expected_sha256) {
                    return Err(format!("{label}.sha256_mismatch"));
                }
                Ok(bytes)
            })();
            let _ = fs::remove_file(&temp_path);
            match result {
                Ok(bytes) => return Ok(bytes),
                Err(error) => {
                    errors.push(format!("{url} attempt {attempt}: {error}"));
                    std::thread::sleep(Duration::from_millis(350 * attempt));
                }
            }
        }
    }
    Err(format!(
        "{label}.download_exhausted: {}",
        errors.join(" | ")
    ))
}

pub(crate) fn safe_segment(value: &str) -> String {
    value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || matches!(ch, '-' | '_' | '.') {
                ch
            } else {
                '-'
            }
        })
        .collect()
}

pub(crate) fn safe_relative_path(value: &str) -> Result<PathBuf, String> {
    let trimmed = value.trim().replace('\\', "/");
    if trimmed.is_empty() {
        return Err("runtime.path_empty".to_string());
    }
    let mut out = PathBuf::new();
    for component in Path::new(&trimmed).components() {
        match component {
            Component::Normal(value) => out.push(value),
            Component::CurDir => {}
            _ => return Err("runtime.path_unsafe".to_string()),
        }
    }
    if out.as_os_str().is_empty() {
        Err("runtime.path_empty".to_string())
    } else {
        Ok(out)
    }
}

pub(crate) fn find_unique_file_by_name(
    root: &Path,
    file_name: &str,
) -> Result<Option<PathBuf>, String> {
    if file_name.trim().is_empty() || file_name.contains('/') || file_name.contains('\\') {
        return Ok(None);
    }
    let mut matches = Vec::new();
    let mut stack = vec![root.to_path_buf()];
    while let Some(dir) = stack.pop() {
        for entry in fs::read_dir(&dir).map_err(|e| e.to_string())? {
            let entry = entry.map_err(|e| e.to_string())?;
            let path = entry.path();
            let file_type = entry.file_type().map_err(|e| e.to_string())?;
            if file_type.is_dir() {
                stack.push(path);
            } else if file_type.is_file()
                && path
                    .file_name()
                    .and_then(|name| name.to_str())
                    .is_some_and(|name| name.eq_ignore_ascii_case(file_name))
            {
                matches.push(path);
            }
        }
    }
    match matches.len() {
        0 => Ok(None),
        1 => Ok(matches.pop()),
        _ => Err("runtime.file_ambiguous".to_string()),
    }
}

pub(crate) fn resolve_installed_file(
    root: &Path,
    manifest_path: &str,
    error_code: &str,
) -> Result<PathBuf, String> {
    let relative = safe_relative_path(manifest_path)?;
    let expected = root.join(&relative);
    if expected.is_file() {
        return Ok(expected);
    }
    let file_name = relative
        .file_name()
        .and_then(|name| name.to_str())
        .ok_or_else(|| error_code.to_string())?;
    if let Some(found) = find_unique_file_by_name(root, file_name)? {
        return Ok(found);
    }
    Err(error_code.to_string())
}

pub(crate) fn replace_dir_atomically(staging: &Path, final_root: &Path) -> Result<(), String> {
    let backup = final_root.with_file_name(format!(
        "{}.backup-{}",
        final_root
            .file_name()
            .and_then(|name| name.to_str())
            .unwrap_or("runtime"),
        crate::storage::now_iso().replace([':', '.'], "-")
    ));
    let had_existing = final_root.exists();
    if had_existing {
        fs::rename(final_root, &backup).map_err(|e| e.to_string())?;
    }
    if let Err(error) = fs::rename(staging, final_root) {
        if had_existing {
            let _ = fs::rename(&backup, final_root);
        }
        return Err(error.to_string());
    }
    if had_existing {
        let _ = fs::remove_dir_all(backup);
    }
    Ok(())
}
