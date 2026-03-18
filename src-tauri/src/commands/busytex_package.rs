use super::ensure_busytex_cache_dir;
use crate::models::{
    BusyTexInstallPackageInput,
    BusyTexInstallPackageResult,
    BusyTexInstalledOverlayFile,
};
use crate::state::AppState;
use reqwest::blocking::Client;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::State;

const ALLOWED_TEX_EXTENSIONS: [&str; 7] = ["sty", "cls", "cfg", "def", "fd", "tex", "lua"];
const DOWNLOAD_TIMEOUT_SECONDS: u64 = 45;
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;
const BUSYTEX_PACKAGE_SOURCES: [(&str, &str); 6] = [
    ("ctan-official", "https://mirrors.ctan.org"),
    ("ctan-mirror-aliyun", "https://mirrors.aliyun.com/CTAN"),
    ("ctan-mirror-tsinghua", "https://mirrors.tuna.tsinghua.edu.cn/CTAN"),
    ("ctan-mirror-sjtug", "https://mirrors.sjtug.sjtu.edu.cn/ctan"),
    ("ctan-mirror-princeton", "https://mirror.math.princeton.edu/pub/CTAN"),
    ("ctan-mirror-fau", "https://ftp.fau.de/ctan"),
];
const BUSYTEX_PACKAGE_METADATA_ENDPOINTS: [&str; 2] =
    ["https://www.ctan.org/json/2.0/pkg", "https://ctan.org/json/2.0/pkg"];
const STYLE_PACKAGE_ALIASES: [(&str, &str); 10] = [
    ("ctex.sty", "ctex"),
    ("xeCJK.sty", "xecjk"),
    ("CJKutf8.sty", "cjk"),
    ("fontspec.sty", "fontspec"),
    ("unicode-math.sty", "unicode-math"),
    ("polyglossia.sty", "polyglossia"),
    ("babel.sty", "babel"),
    ("tikz.sty", "pgf"),
    ("xcolor.sty", "xcolor"),
    ("graphicx.sty", "graphics"),
];
const PACKAGE_FAMILY_HINTS: [(&str, &str); 8] = [
    ("ctex", "language/chinese"),
    ("xecjk", "language/chinese"),
    ("cjk", "language/chinese"),
    ("fontspec", "macros/unicodetex/latex"),
    ("unicode-math", "macros/unicodetex/latex"),
    ("polyglossia", "macros/latex/contrib/polyglossia"),
    ("tikz", "graphics/pgf/base"),
    ("pgf", "graphics/pgf/base"),
];

fn normalize_style_file(input: &str) -> Option<String> {
    let value = input.trim().replace('\\', "/");
    let file_name = Path::new(&value).file_name()?.to_string_lossy().to_string();
    if file_name.is_empty() || !file_name.contains('.') {
        return None;
    }
    Some(file_name)
}

fn package_name_from_style(style_file: &str) -> String {
    Path::new(style_file)
        .file_stem()
        .map(|stem| stem.to_string_lossy().to_string())
        .unwrap_or_else(|| style_file.to_string())
}

fn style_alias_package(style_file: &str) -> Option<String> {
    let target = style_file.to_ascii_lowercase();
    STYLE_PACKAGE_ALIASES
        .iter()
        .find_map(|(style, package)| (target == style.to_ascii_lowercase()).then(|| (*package).to_string()))
}

fn variant_package_names(package_name: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut seen = HashSet::new();
    let base = package_name.trim().to_ascii_lowercase();
    if base.is_empty() {
        return out;
    }

    for candidate in [
        base.clone(),
        base.replace('_', "-"),
        base.replace('-', "_"),
        base.replace('-', ""),
        base.replace('_', ""),
    ] {
        if !candidate.is_empty() && seen.insert(candidate.clone()) {
            out.push(candidate);
        }
    }

    out
}

fn package_name_candidates(style_file: &str, package_name: &str) -> Vec<String> {
    let mut candidates = Vec::new();
    let mut seen = HashSet::<String>::new();

    for candidate in variant_package_names(package_name) {
        if seen.insert(candidate.clone()) {
            candidates.push(candidate);
        }
    }

    if let Some(alias) = style_alias_package(style_file) {
        for candidate in variant_package_names(&alias) {
            if seen.insert(candidate.clone()) {
                candidates.push(candidate);
            }
        }
    }

    candidates
}

fn infer_package_family(package_name: &str) -> Option<&'static str> {
    let lower = package_name.to_ascii_lowercase();
    PACKAGE_FAMILY_HINTS
        .iter()
        .find_map(|(prefix, family)| lower.starts_with(prefix).then_some(*family))
}

fn base_relative_paths_for_package(package_name: &str) -> Vec<String> {
    let mut out = vec![
        format!("install/macros/latex/contrib/{package_name}.tds.zip"),
        format!("install/macros/latex/contrib/{package_name}.zip"),
        format!("macros/latex/contrib/{package_name}.zip"),
        format!("install/macros/generic/{package_name}.tds.zip"),
        format!("macros/generic/{package_name}.zip"),
        format!("install/language/chinese/{package_name}.tds.zip"),
        format!("language/chinese/{package_name}.zip"),
    ];
    if let Some(family) = infer_package_family(package_name) {
        out.push(format!("install/{family}/{package_name}.tds.zip"));
        out.push(format!("{family}/{package_name}.zip"));
        out.push(format!("{family}.tds.zip"));
        out.push(format!("{family}.zip"));
    }
    out
}

fn normalize_relative_path(path: &str) -> Option<String> {
    let value = path
        .trim()
        .replace('\\', "/")
        .trim_start_matches('/')
        .trim_start_matches("./")
        .to_string();
    if value.is_empty() {
        return None;
    }
    Some(value)
}

fn metadata_base_paths(value: &Value) -> Vec<String> {
    let mut out = Vec::new();

    let direct = value
        .get("ctan")
        .and_then(|item| item.get("path"))
        .and_then(|item| item.as_str())
        .or_else(|| value.get("path").and_then(|item| item.as_str()))
        .unwrap_or_default();

    if let Some(path) = normalize_relative_path(direct) {
        out.push(path);
    }

    if let Some(authoritative_path) = value
        .get("ctan")
        .and_then(|item| item.get("location"))
        .and_then(|item| item.as_str())
        .and_then(normalize_relative_path)
    {
        if !out.iter().any(|item| item == &authoritative_path) {
            out.push(authoritative_path);
        }
    }

    out
}

fn metadata_relative_paths_for_package(client: &Client, package_name: &str) -> Vec<String> {
    let mut rel_paths = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    for endpoint in BUSYTEX_PACKAGE_METADATA_ENDPOINTS {
        let url = format!("{}/{}", endpoint.trim_end_matches('/'), package_name);
        let response = match client
            .get(&url)
            .header("User-Agent", "LatoTex/0.1 busytex-installer")
            .send()
        {
            Ok(resp) => resp,
            Err(_) => continue,
        };
        if !response.status().is_success() {
            continue;
        }
        let payload: Value = match response.json() {
            Ok(value) => value,
            Err(_) => continue,
        };

        for base_path in metadata_base_paths(&payload) {
            for relative in [
                format!("{base_path}.zip"),
                format!("{base_path}.tds.zip"),
                format!("install/{base_path}.tds.zip"),
                format!("{base_path}/{package_name}.zip"),
                format!("{base_path}/{package_name}.tds.zip"),
                format!("install/{base_path}/{package_name}.tds.zip"),
            ] {
                if let Some(normalized) = normalize_relative_path(&relative) {
                    if seen.insert(normalized.clone()) {
                        rel_paths.push(normalized);
                    }
                }
            }
        }

        if !rel_paths.is_empty() {
            break;
        }
    }

    rel_paths
}

fn package_relative_paths(client: &Client, package_names: &[String]) -> Vec<String> {
    let mut out = Vec::<String>::new();
    let mut seen = HashSet::<String>::new();

    for package_name in package_names {
        for relative in base_relative_paths_for_package(package_name) {
            if let Some(normalized) = normalize_relative_path(&relative) {
                if seen.insert(normalized.clone()) {
                    out.push(normalized);
                }
            }
        }

        for relative in metadata_relative_paths_for_package(client, package_name) {
            if seen.insert(relative.clone()) {
                out.push(relative);
            }
        }
    }

    out
}

fn package_candidate_urls(client: &Client, package_names: &[String]) -> Vec<(String, String)> {
    let relative_paths = package_relative_paths(client, package_names);
    let mut seen = HashSet::new();
    let mut candidates = Vec::<(String, String)>::new();

    for (label, base) in BUSYTEX_PACKAGE_SOURCES {
        let normalized_base = base.trim_end_matches('/');
        for relative in &relative_paths {
            let url = format!("{normalized_base}/{relative}");
            if seen.insert(url.clone()) {
                candidates.push((label.to_string(), url));
            }
        }
    }

    candidates
}

fn has_allowed_tex_extension(path: &str) -> bool {
    let lower = path.to_lowercase();
    ALLOWED_TEX_EXTENSIONS
        .iter()
        .any(|ext| lower.ends_with(&format!(".{ext}")))
}

fn normalize_archive_rel_path(raw: &str) -> Option<String> {
    let value = raw.replace('\\', "/").trim_start_matches("./").to_string();
    if value.is_empty() || value.ends_with('/') {
        return None;
    }
    if let Some(idx) = value.find("texmf-dist/") {
        return Some(value[(idx + "texmf-dist/".len())..].to_string());
    }
    if value.starts_with("tex/") {
        return Some(value);
    }
    if let Some(idx) = value.find("/tex/") {
        return Some(value[(idx + 1)..].to_string());
    }
    None
}

fn build_overlay_variants(rel_path: &str) -> Vec<String> {
    let mut variants = Vec::new();
    let mut seen = HashSet::new();

    let mut push_variant = |value: String| {
        let normalized = value.replace('\\', "/").trim_start_matches('/').to_string();
        if normalized.is_empty() {
            return;
        }
        if seen.insert(normalized.clone()) {
            variants.push(normalized);
        }
    };

    push_variant(rel_path.to_string());
    if let Some(stripped) = rel_path.strip_prefix("tex/latex/") {
        push_variant(stripped.to_string());
    }
    if let Some(stripped) = rel_path.strip_prefix("tex/generic/") {
        push_variant(stripped.to_string());
    }
    if let Some(stripped) = rel_path.strip_prefix("tex/") {
        push_variant(stripped.to_string());
    }
    if let Some(name) = Path::new(rel_path).file_name() {
        push_variant(name.to_string_lossy().to_string());
    }

    variants
}

fn sanitize_overlay_relative_path(path: &str) -> Option<PathBuf> {
    let normalized = path.trim().replace('\\', "/");
    if normalized.is_empty() {
        return None;
    }
    let mut output = PathBuf::new();
    for component in Path::new(&normalized).components() {
        match component {
            Component::Normal(part) => output.push(part),
            _ => return None,
        }
    }
    if output.as_os_str().is_empty() {
        return None;
    }
    Some(output)
}

fn collect_overlay_files_recursive(
    dir: &Path,
    root: &Path,
    output: &mut Vec<BusyTexInstalledOverlayFile>,
) -> Result<(), String> {
    for item in fs::read_dir(dir).map_err(|e| e.to_string())? {
        let item = item.map_err(|e| e.to_string())?;
        let path = item.path();
        if path.is_dir() {
            collect_overlay_files_recursive(&path, root, output)?;
            continue;
        }
        if !path.is_file() {
            continue;
        }
        let rel = path
            .strip_prefix(root)
            .map_err(|e| e.to_string())?
            .to_string_lossy()
            .replace('\\', "/");
        let content = fs::read_to_string(&path).map_err(|e| e.to_string())?;
        output.push(BusyTexInstalledOverlayFile { path: rel, content });
    }
    Ok(())
}

fn read_overlay_files_from_cache(overlay_dir: &Path) -> Result<Vec<BusyTexInstalledOverlayFile>, String> {
    if !overlay_dir.exists() {
        return Ok(Vec::new());
    }
    let mut output: Vec<BusyTexInstalledOverlayFile> = Vec::new();
    collect_overlay_files_recursive(overlay_dir, overlay_dir, &mut output)?;
    output.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(output)
}

fn write_overlay_files_to_cache(
    overlay_dir: &Path,
    overlay_files: &[BusyTexInstalledOverlayFile],
) -> Result<(), String> {
    if overlay_dir.exists() {
        fs::remove_dir_all(overlay_dir).map_err(|e| e.to_string())?;
    }
    fs::create_dir_all(overlay_dir).map_err(|e| e.to_string())?;

    for file in overlay_files {
        let Some(relative_path) = sanitize_overlay_relative_path(&file.path) else {
            continue;
        };
        let target = overlay_dir.join(relative_path);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(target, file.content.as_bytes()).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn has_required_style_file(overlay_files: &[BusyTexInstalledOverlayFile], style_file: &str) -> bool {
    let needle = style_file.to_lowercase();
    overlay_files.iter().any(|item| {
        let path = item.path.to_lowercase();
        path == needle || path.ends_with(&format!("/{needle}"))
    })
}

fn build_http_client() -> Result<Client, String> {
    Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| e.to_string())
}

fn download_archive(client: &Client, url: &str) -> Result<Vec<u8>, String> {
    let response = client
        .get(url)
        .header("User-Agent", "LatoTex/0.1 busytex-installer")
        .send()
        .map_err(|e| e.to_string())?;

    if !response.status().is_success() {
        return Err(format!("HTTP {}", response.status()));
    }

    let bytes = response.bytes().map_err(|e| e.to_string())?;
    if bytes.len() > MAX_PACKAGE_BYTES {
        return Err(format!("archive too large: {} bytes", bytes.len()));
    }
    Ok(bytes.to_vec())
}

fn extract_overlay_files_from_zip(archive_bytes: &[u8]) -> Result<Vec<BusyTexInstalledOverlayFile>, String> {
    let cursor = Cursor::new(archive_bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| e.to_string())?;
    let mut merged: HashMap<String, String> = HashMap::new();

    for idx in 0..archive.len() {
        let mut entry = archive.by_index(idx).map_err(|e| e.to_string())?;
        if !entry.is_file() {
            continue;
        }
        let name = entry.name().to_string();
        if !has_allowed_tex_extension(&name) {
            continue;
        }

        let Some(rel_path) = normalize_archive_rel_path(&name) else {
            continue;
        };

        let mut bytes: Vec<u8> = Vec::new();
        entry.read_to_end(&mut bytes).map_err(|e| e.to_string())?;
        if bytes.is_empty() {
            continue;
        }

        let content = String::from_utf8_lossy(&bytes).to_string();
        for variant in build_overlay_variants(&rel_path) {
            merged.entry(variant).or_insert_with(|| content.clone());
        }
    }

    let mut overlay_files: Vec<BusyTexInstalledOverlayFile> = merged
        .into_iter()
        .map(|(path, content)| BusyTexInstalledOverlayFile { path, content })
        .collect();
    overlay_files.sort_by(|a, b| a.path.cmp(&b.path));
    Ok(overlay_files)
}

#[tauri::command]
pub fn busytex_install_missing_package(
    state: State<'_, AppState>,
    input: BusyTexInstallPackageInput,
) -> Result<BusyTexInstallPackageResult, String> {
    let style_file = normalize_style_file(&input.style_file)
        .ok_or_else(|| format!("Invalid style file: {}", input.style_file))?;
    let package_name = package_name_from_style(&style_file);
    let package_names = package_name_candidates(&style_file, &package_name);
    let policy = input
        .policy
        .as_deref()
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
        .unwrap_or("install-first");

    let prepared = ensure_busytex_cache_dir(&state, policy)?;
    let cache_dir_path = PathBuf::from(prepared.actual_dir.clone());
    let overlay_dir = cache_dir_path
        .join("texmf-local")
        .join("packages")
        .join(&package_name)
        .join("overlay");

    let cached_overlay_files = read_overlay_files_from_cache(&overlay_dir)?;
    if has_required_style_file(&cached_overlay_files, &style_file) {
        return Ok(BusyTexInstallPackageResult {
            style_file,
            package_name,
            installed: false,
            from_cache: true,
            source_url: None,
            cache_dir: prepared.actual_dir,
            overlay_files: cached_overlay_files,
        });
    }

    let client = build_http_client()?;
    let mut reasons: Vec<String> = Vec::new();
    let urls = package_candidate_urls(&client, &package_names);

    for (source, url) in urls {
        let archive = match download_archive(&client, &url) {
            Ok(bytes) => bytes,
            Err(error) => {
                reasons.push(format!("[{source}] {url}: {error}"));
                continue;
            }
        };

        let overlay_files = match extract_overlay_files_from_zip(&archive) {
            Ok(files) => files,
            Err(error) => {
                reasons.push(format!("[{source}] {url}: zip parse failed: {error}"));
                continue;
            }
        };

        if !has_required_style_file(&overlay_files, &style_file) {
            reasons.push(format!(
                "[{source}] {url}: style file {style_file} not found in archive"
            ));
            continue;
        }

        write_overlay_files_to_cache(&overlay_dir, &overlay_files)?;
        let persisted_overlay_files = read_overlay_files_from_cache(&overlay_dir)?;

        return Ok(BusyTexInstallPackageResult {
            style_file,
            package_name,
            installed: true,
            from_cache: false,
            source_url: Some(url),
            cache_dir: prepared.actual_dir,
            overlay_files: persisted_overlay_files,
        });
    }

    Err(format!(
        "Failed to install BusyTeX package for {style_file} (candidates: {}). Tried: {}",
        package_names.join(", "),
        reasons.join(" | ")
    ))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn package_candidates_include_language_chinese_for_ctex() {
        let paths = base_relative_paths_for_package("ctex");
        assert!(paths.iter().any(|item| item == "language/chinese/ctex.zip"));
        assert!(paths
            .iter()
            .any(|item| item == "install/language/chinese/ctex.tds.zip"));
    }

    #[test]
    fn style_alias_promotes_expected_package_names() {
        let names = package_name_candidates("xeCJK.sty", "xecjk");
        assert!(names.iter().any(|name| name == "xecjk"));
    }
}
