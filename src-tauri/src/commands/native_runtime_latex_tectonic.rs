use reqwest::blocking::Client;
use std::collections::HashSet;
use std::fs;
use std::io::{Read, Write};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

const DEFAULT_TECTONIC_BUNDLE_URL: &str = "https://data1.fullyjustified.net/tlextras-2022.0r0.tar";
const MIN_TECTONIC_BUNDLE_BYTES: u64 = 300_000_000;
const BUNDLE_PROGRESS_INTERVAL: Duration = Duration::from_secs(4);

fn normalize_entry_path(path: &Path) -> String {
    path.to_string_lossy().replace('\\', "/")
}

fn load_redirect_urls(source_root: &Path) -> Vec<String> {
    let redirects_dir = source_root.join("cache-seed").join("redirects");
    let mut urls = Vec::<String>::new();
    if let Ok(entries) = fs::read_dir(redirects_dir) {
        for entry in entries.flatten() {
            let path = entry.path();
            if path.extension().and_then(|value| value.to_str()) != Some("txt") {
                continue;
            }
            if let Ok(content) = fs::read_to_string(path) {
                for line in content.lines() {
                    let value = line.trim();
                    if value.starts_with("https://") || value.starts_with("http://") {
                        urls.push(value.to_string());
                    }
                }
            }
        }
    }
    urls.push(DEFAULT_TECTONIC_BUNDLE_URL.to_string());
    let mut seen = HashSet::<String>::new();
    urls.retain(|value| seen.insert(value.clone()));
    urls
}

fn validate_bundle_entries<F>(
    bundle_path: &Path,
    required_entries: &[&str],
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(),
{
    let metadata = fs::metadata(bundle_path).map_err(|error| error.to_string())?;
    if metadata.len() < MIN_TECTONIC_BUNDLE_BYTES {
        return Err(format!(
            "bundle too small: expected at least {} bytes, found {}",
            MIN_TECTONIC_BUNDLE_BYTES,
            metadata.len()
        ));
    }
    let file = fs::File::open(bundle_path).map_err(|error| error.to_string())?;
    let mut archive = tar::Archive::new(file);
    let mut remaining = required_entries
        .iter()
        .map(|value| value.replace('\\', "/"))
        .collect::<HashSet<String>>();
    let entries = archive.entries().map_err(|error| error.to_string())?;
    let mut next_progress_at = Instant::now() + BUNDLE_PROGRESS_INTERVAL;
    for entry in entries {
        if Instant::now() >= next_progress_at {
            on_progress();
            next_progress_at = Instant::now() + BUNDLE_PROGRESS_INTERVAL;
        }
        let entry = entry.map_err(|error| error.to_string())?;
        let path = entry.path().map_err(|error| error.to_string())?;
        let normalized = normalize_entry_path(&path);
        remaining.remove(&normalized);
        if remaining.is_empty() {
            return Ok(());
        }
    }
    Err(format!(
        "bundle missing required entries: {}",
        remaining.into_iter().collect::<Vec<_>>().join(", ")
    ))
}

fn download_to_file<F>(url: &str, target_path: &Path, mut on_progress: F) -> Result<(), String>
where
    F: FnMut(),
{
    let client = Client::builder()
        .timeout(Duration::from_secs(120))
        .build()
        .map_err(|error| error.to_string())?;
    let mut response = client.get(url).send().map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!("{} => {}", url, response.status()));
    }
    if let Some(parent) = target_path.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let mut file = fs::File::create(target_path).map_err(|error| error.to_string())?;
    let mut bytes_written = 0_u64;
    let mut buffer = [0_u8; 64 * 1024];
    let mut next_progress_at = Instant::now() + BUNDLE_PROGRESS_INTERVAL;
    loop {
        let read = response
            .read(&mut buffer)
            .map_err(|error| error.to_string())?;
        if read == 0 {
            break;
        }
        file.write_all(&buffer[..read])
            .map_err(|error| error.to_string())?;
        bytes_written += read as u64;
        if Instant::now() >= next_progress_at {
            on_progress();
            next_progress_at = Instant::now() + BUNDLE_PROGRESS_INTERVAL;
        }
    }
    if bytes_written < MIN_TECTONIC_BUNDLE_BYTES {
        return Err(format!("{} => body too small ({})", url, bytes_written));
    }
    Ok(())
}

fn replace_runtime_bundle(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    if target.exists() {
        fs::remove_file(target).map_err(|error| error.to_string())?;
    }
    fs::copy(source, target).map_err(|error| error.to_string())?;
    Ok(())
}

pub(super) fn ensure_runtime_bundle<F>(
    tool_root: &Path,
    source_root: &Path,
    bundle_relative_path: &str,
    required_entries: &[&str],
    mut on_progress: F,
) -> Result<PathBuf, String>
where
    F: FnMut(&str, Option<&str>),
{
    let source_bundle = source_root.join(bundle_relative_path);
    let runtime_bundle = tool_root.join(bundle_relative_path);
    let runtime_bundle_text = runtime_bundle.to_string_lossy().to_string();
    let source_bundle_text = source_bundle.to_string_lossy().to_string();
    if let Some(parent) = runtime_bundle.parent() {
        fs::create_dir_all(parent).map_err(|error| error.to_string())?;
    }
    let temp_bundle = runtime_bundle.with_extension("download");
    if temp_bundle.exists() {
        let _ = fs::remove_file(&temp_bundle);
    }

    let should_copy = match (fs::metadata(&source_bundle), fs::metadata(&runtime_bundle)) {
        (Ok(source_meta), Ok(runtime_meta)) => source_meta.len() != runtime_meta.len(),
        (Ok(_), Err(_)) => true,
        (Err(error), _) => return Err(error.to_string()),
    };
    if should_copy {
        replace_runtime_bundle(&source_bundle, &runtime_bundle)?;
    }

    let source_valid = validate_bundle_entries(&source_bundle, required_entries, || {
        on_progress("validating_bundle", Some(source_bundle_text.as_str()));
    })
    .is_ok();
    if validate_bundle_entries(&runtime_bundle, required_entries, || {
        on_progress("validating_bundle", Some(runtime_bundle_text.as_str()));
    })
    .is_ok()
    {
        return Ok(runtime_bundle);
    }

    if source_valid {
        on_progress("repairing_bundle", Some(source_bundle_text.as_str()));
        replace_runtime_bundle(&source_bundle, &runtime_bundle)?;
        validate_bundle_entries(&runtime_bundle, required_entries, || {
            on_progress("validating_bundle", Some(runtime_bundle_text.as_str()));
        })?;
        return Ok(runtime_bundle);
    }

    let mut errors = Vec::<String>::new();
    for url in load_redirect_urls(source_root) {
        on_progress("repairing_bundle", Some(url.as_str()));
        match download_to_file(&url, &temp_bundle, || {
            on_progress("repairing_bundle", Some(url.as_str()));
        }) {
            Ok(()) => match validate_bundle_entries(&temp_bundle, required_entries, || {
                on_progress("repairing_bundle", Some(url.as_str()));
            }) {
                Ok(()) => {
                    let _ = fs::remove_file(&runtime_bundle);
                    fs::rename(&temp_bundle, &runtime_bundle).map_err(|error| error.to_string())?;
                    return Ok(runtime_bundle);
                }
                Err(error) => errors.push(format!("{} => {}", url, error)),
            },
            Err(error) => errors.push(error),
        }
        let _ = fs::remove_file(&temp_bundle);
    }

    Err(format!(
        "tectonic.bundle_corrupt: {} is invalid and auto-repair download failed: {}",
        runtime_bundle.to_string_lossy(),
        errors.join(" | ")
    ))
}

pub(super) fn write_fontconfig_config(
    tool_root: &Path,
    font_dirs: &[PathBuf],
) -> Result<(PathBuf, PathBuf), String> {
    let fontconfig_dir = tool_root.join("fontconfig/windows");
    let font_cache_dir = fontconfig_dir.join("cache");
    fs::create_dir_all(&font_cache_dir).map_err(|error| error.to_string())?;
    let config_path = fontconfig_dir.join("fonts.conf");
    let cache_dir_text = normalize_entry_path(&font_cache_dir);
    let dir_lines = font_dirs
        .iter()
        .map(|path| format!("  <dir>{}</dir>", normalize_entry_path(path)))
        .collect::<Vec<_>>()
        .join("\n");
    let config = format!(
        concat!(
            "<?xml version=\"1.0\"?>\n",
            "<!DOCTYPE fontconfig SYSTEM \"fonts.dtd\">\n",
            "<fontconfig>\n",
            "{}\n",
            "  <cachedir>{}</cachedir>\n",
            "</fontconfig>\n"
        ),
        dir_lines, cache_dir_text,
    );
    let should_write = match fs::read_to_string(&config_path) {
        Ok(existing) => existing != config,
        Err(_) => true,
    };
    if should_write {
        fs::write(&config_path, config).map_err(|error| error.to_string())?;
    }
    Ok((config_path, fontconfig_dir))
}
