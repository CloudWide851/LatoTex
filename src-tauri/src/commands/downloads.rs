use crate::commands::source_locale::prefer_cn_source;
use crate::outbound_http::{build_blocking_client, OutboundProxyMode};
use reqwest::blocking::Response;
use reqwest::header::{LOCATION, USER_AGENT};
use ring::digest::{digest, SHA256};
use std::fs;
use std::io::{Read, Write};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;

const MAX_RUNTIME_DOWNLOAD_BYTES: u64 = 512 * 1024 * 1024;
const MAX_DOWNLOAD_REDIRECTS: usize = 5;

pub(crate) fn hex_digest(bytes: &[u8]) -> String {
    bytes.iter().map(|value| format!("{value:02x}")).collect()
}

pub(crate) fn ordered_download_urls(primary: &str, cn: Option<&str>) -> Vec<String> {
    ordered_download_urls_for_preference(primary, cn, prefer_cn_source())
}

fn ordered_download_urls_for_preference(
    primary: &str,
    cn: Option<&str>,
    prefer_cn: bool,
) -> Vec<String> {
    let primary = primary.trim();
    let cn = cn.map(str::trim).filter(|item| !item.is_empty());
    let mut urls = Vec::new();
    if prefer_cn {
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

fn parse_https_download_url(value: &str) -> Result<reqwest::Url, String> {
    let parsed = reqwest::Url::parse(value.trim())
        .map_err(|_| "runtime.download_url_invalid".to_string())?;
    if parsed.scheme() != "https"
        || !parsed.username().is_empty()
        || parsed.password().is_some()
        || parsed.host_str().is_none()
        || parsed.fragment().is_some()
    {
        return Err("runtime.download_url_invalid".to_string());
    }
    Ok(parsed)
}

fn redirect_host_allowed(source_host: &str, next_host: &str) -> bool {
    if source_host.eq_ignore_ascii_case(next_host) {
        return true;
    }
    matches!(
        (
            source_host.to_ascii_lowercase().as_str(),
            next_host.to_ascii_lowercase().as_str(),
        ),
        (
            "github.com",
            "objects.githubusercontent.com"
                | "release-assets.githubusercontent.com"
                | "github-releases.githubusercontent.com"
        ) | (
            "huggingface.co",
            "cdn-lfs.huggingface.co"
                | "cas-bridge.xethub.hf.co"
                | "cas-server.xethub.hf.co"
                | "us.aws.cdn.hf.co"
        ) | (
            "www.modelscope.cn",
            "modelscope.cn"
                | "modelscope.oss-cn-beijing.aliyuncs.com"
                | "modelscope.oss-cn-hangzhou.aliyuncs.com"
        ) | ("cran.r-project.org", "cloud.r-project.org")
    )
}

fn validate_download_redirect(
    source_host: &str,
    current: &reqwest::Url,
    location: &str,
) -> Result<reqwest::Url, String> {
    let next = current
        .join(location)
        .map_err(|_| "runtime.download_redirect_unsafe".to_string())?;
    let next = parse_https_download_url(next.as_str())
        .map_err(|_| "runtime.download_redirect_unsafe".to_string())?;
    let next_host = next
        .host_str()
        .ok_or_else(|| "runtime.download_redirect_unsafe".to_string())?;
    if !redirect_host_allowed(source_host, next_host) {
        return Err("runtime.download_redirect_unsafe".to_string());
    }
    Ok(next)
}

fn download_response(url: &str, timeout_secs: u64) -> Result<Response, String> {
    let mut current = parse_https_download_url(url)?;
    let source_host = current
        .host_str()
        .ok_or_else(|| "runtime.download_url_invalid".to_string())?
        .to_ascii_lowercase();
    for redirect_count in 0..=MAX_DOWNLOAD_REDIRECTS {
        let (client, _) = build_blocking_client(
            current.as_str(),
            &OutboundProxyMode::System,
            Duration::from_secs(timeout_secs),
        )
        .map_err(|_| "runtime.download_client_failed".to_string())?;
        let response = client
            .get(current.clone())
            .header(USER_AGENT, "LatoTex/0.1 plugin-runtime-downloader")
            .send()
            .map_err(|_| "runtime.download_failed".to_string())?;
        if !response.status().is_redirection() {
            return Ok(response);
        }
        if redirect_count == MAX_DOWNLOAD_REDIRECTS {
            return Err("runtime.download_redirect_limit".to_string());
        }
        let location = response
            .headers()
            .get(LOCATION)
            .and_then(|value| value.to_str().ok())
            .ok_or_else(|| "runtime.download_redirect_unsafe".to_string())?;
        current = validate_download_redirect(&source_host, &current, location)?;
    }
    Err("runtime.download_redirect_limit".to_string())
}

fn download_source_label(url: &str) -> String {
    reqwest::Url::parse(url)
        .ok()
        .and_then(|parsed| parsed.host_str().map(str::to_ascii_lowercase))
        .unwrap_or_else(|| "invalid-source".to_string())
}

pub(crate) fn download_verified(
    runtime_root: &Path,
    label: &str,
    urls: Vec<String>,
    expected_sha256: &str,
    timeout_secs: u64,
) -> Result<Vec<u8>, String> {
    let download_dir = runtime_root.join("downloads");
    fs::create_dir_all(&download_dir).map_err(|e| e.to_string())?;
    let mut errors = Vec::new();
    for url in urls.into_iter().filter(|url| url.starts_with("https://")) {
        let source_label = download_source_label(&url);
        for attempt in 1..=3 {
            let temp_path = download_dir.join(format!(
                "{}-{}-{attempt}.part",
                safe_segment(label),
                crate::storage::now_iso().replace([':', '.'], "-")
            ));
            let result = (|| -> Result<Vec<u8>, String> {
                let mut response = download_response(&url, timeout_secs)?;
                if !response.status().is_success() {
                    return Err(format!("{label}.download_http: {}", response.status()));
                }
                if response
                    .content_length()
                    .is_some_and(|length| length > MAX_RUNTIME_DOWNLOAD_BYTES)
                {
                    return Err(format!("{label}.download_too_large"));
                }
                let mut file = fs::File::create(&temp_path).map_err(|e| e.to_string())?;
                let written = std::io::copy(
                    &mut (&mut response).take(MAX_RUNTIME_DOWNLOAD_BYTES + 1),
                    &mut file,
                )
                .map_err(|_| format!("{label}.download_failed"))?;
                if written > MAX_RUNTIME_DOWNLOAD_BYTES {
                    return Err(format!("{label}.download_too_large"));
                }
                file.flush().map_err(|e| e.to_string())?;
                file.sync_all().map_err(|e| e.to_string())?;
                drop(file);
                if fs::metadata(&temp_path)
                    .map_err(|_| format!("{label}.download_failed"))?
                    .len()
                    > MAX_RUNTIME_DOWNLOAD_BYTES
                {
                    return Err(format!("{label}.download_too_large"));
                }
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
                    errors.push(format!("{source_label} attempt {attempt}: {error}"));
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

#[cfg(test)]
mod download_policy_tests {
    use super::{
        download_source_label, ordered_download_urls_for_preference, redirect_host_allowed,
        validate_download_redirect,
    };

    #[test]
    fn source_preference_keeps_verified_fallback_order() {
        assert_eq!(
            ordered_download_urls_for_preference(
                "https://huggingface.co/model",
                Some("https://www.modelscope.cn/model"),
                true,
            ),
            vec![
                "https://www.modelscope.cn/model".to_string(),
                "https://huggingface.co/model".to_string(),
            ]
        );
        assert_eq!(
            ordered_download_urls_for_preference(
                "https://huggingface.co/model",
                Some("https://www.modelscope.cn/model"),
                false,
            ),
            vec![
                "https://huggingface.co/model".to_string(),
                "https://www.modelscope.cn/model".to_string(),
            ]
        );
    }

    #[test]
    fn redirect_policy_accepts_only_exact_known_hosts() {
        assert!(redirect_host_allowed(
            "huggingface.co",
            "cas-bridge.xethub.hf.co"
        ));
        assert!(redirect_host_allowed("huggingface.co", "us.aws.cdn.hf.co"));
        assert!(!redirect_host_allowed(
            "huggingface.co",
            "cas-bridge.xethub.hf.co.attacker.example"
        ));
        assert!(!redirect_host_allowed(
            "huggingface.co",
            "us.aws.cdn.hf.co.attacker.example"
        ));
        assert!(!redirect_host_allowed(
            "www.modelscope.cn",
            "modelscope.cn.attacker.example"
        ));
    }

    #[test]
    fn redirect_policy_rejects_credentials_and_non_https_targets() {
        let current = reqwest::Url::parse("https://huggingface.co/model").unwrap();
        assert!(validate_download_redirect(
            "huggingface.co",
            &current,
            "https://user:secret@cas-bridge.xethub.hf.co/model"
        )
        .is_err());
        assert!(validate_download_redirect(
            "huggingface.co",
            &current,
            "http://cas-bridge.xethub.hf.co/model"
        )
        .is_err());
    }

    #[test]
    fn diagnostics_label_omits_query_and_fragment() {
        assert_eq!(
            download_source_label("https://huggingface.co/model?token=secret#fragment"),
            "huggingface.co"
        );
    }
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
