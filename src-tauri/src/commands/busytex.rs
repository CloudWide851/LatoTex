use crate::models::{
    AnalysisPyodideCacheInfo,
    AnalysisPyodidePrepareInput,
    BusyTexCacheInfo,
    BusyTexCachePrepareInput,
    BusyTexInstallPackageInput,
    BusyTexInstallPackageResult,
    BusyTexInstalledOverlayFile,
    DrawioCacheInfo,
    DrawioCachePrepareInput,
};
use crate::state::AppState;
use reqwest::blocking::Client;
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Cursor, Read};
use std::path::{Component, Path, PathBuf};
use std::time::Duration;
use tauri::State;

const REQUIRED_BUSYTEX_ASSETS: [&str; 5] =
    ["busytex.js", "busytex.wasm", "busytex_worker.js", "busytex_pipeline.js", "texlive-basic.js"];

const REQUIRED_PYODIDE_ASSETS: [&str; 5] =
    ["pyodide.mjs", "pyodide.asm.js", "pyodide.asm.wasm", "pyodide-lock.json", "python_stdlib.zip"];

const REQUIRED_DRAWIO_ASSETS: [&str; 6] =
    ["index.html", "app.html", "js/app.min.js", "js/bootstrap.js", "js/main.js", "styles/grapheditor.css"];

const ALLOWED_TEX_EXTENSIONS: [&str; 7] = ["sty", "cls", "cfg", "def", "fd", "tex", "lua"];
const DOWNLOAD_TIMEOUT_SECONDS: u64 = 45;
const MAX_PACKAGE_BYTES: usize = 64 * 1024 * 1024;

struct CachePrepareResult {
    policy: String,
    requested_dir: String,
    actual_dir: String,
    install_dir_writable: bool,
    using_fallback: bool,
    source_dir: PathBuf,
}

fn copy_recursively(source: &Path, target: &Path) -> Result<(), String> {
    if source.is_dir() {
        fs::create_dir_all(target).map_err(|e| e.to_string())?;
        for item in fs::read_dir(source).map_err(|e| e.to_string())? {
            let item = item.map_err(|e| e.to_string())?;
            let from = item.path();
            let to = target.join(item.file_name());
            copy_recursively(&from, &to)?;
        }
        return Ok(());
    }

    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(())
}

fn has_required_assets(dir: &Path, required_assets: &[&str]) -> bool {
    required_assets.iter().all(|name| dir.join(name).exists())
}

fn candidate_source_dirs(relative_subdir: &str) -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("resources/core/{relative_subdir}")));
    candidates.push(PathBuf::from(env!("CARGO_MANIFEST_DIR")).join(format!("../public/core/{relative_subdir}")));
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(format!("resources/core/{relative_subdir}")));
            candidates.push(exe_dir.join(format!("core/{relative_subdir}")));
            candidates.push(exe_dir.join(format!("../resources/core/{relative_subdir}")));
        }
    }
    candidates
}

fn choose_existing_source_dir(required_assets: &[&str], relative_subdir: &str) -> Option<PathBuf> {
    candidate_source_dirs(relative_subdir)
        .into_iter()
        .find(|dir| has_required_assets(dir, required_assets))
}

fn ensure_cache_dir(cache_dir: &Path, source_dir: &Path, required_assets: &[&str]) -> Result<(), String> {
    if cache_dir.exists() && has_required_assets(cache_dir, required_assets) {
        return Ok(());
    }
    if !cache_dir.exists() {
        fs::create_dir_all(cache_dir).map_err(|e| e.to_string())?;
    }
    copy_recursively(source_dir, cache_dir)?;
    Ok(())
}

fn sync_cache_files(cache_dir: &Path, source_dir: &Path, files: &[&str]) -> Result<(), String> {
    for relative in files {
        let source = source_dir.join(relative);
        if !source.exists() {
            continue;
        }
        let target = cache_dir.join(relative);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::copy(&source, &target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn is_permission_denied(message: &str) -> bool {
    let lower = message.to_lowercase();
    lower.contains("access is denied")
        || lower.contains("permission denied")
        || lower.contains("os error 5")
}

fn write_cache_marker(
    actual_dir: &Path,
    policy: &str,
    requested_dir: &Path,
    using_fallback: bool,
) {
    let marker_path = actual_dir.join(".cache-info.json");
    let marker_json = serde_json::json!({
        "policy": policy,
        "requestedDir": requested_dir.to_string_lossy().to_string(),
        "actualDir": actual_dir.to_string_lossy().to_string(),
        "usingFallback": using_fallback
    });
    let _ = fs::write(
        marker_path,
        serde_json::to_string_pretty(&marker_json).unwrap_or_else(|_| "{}".to_string()),
    );
}

fn prepare_cache(
    state: &State<'_, AppState>,
    policy: &str,
    cache_dir_name: &str,
    source_relative_subdir: &str,
    required_assets: &[&str],
    missing_hint: &str,
) -> Result<CachePrepareResult, String> {
    let source_dir = choose_existing_source_dir(required_assets, source_relative_subdir)
        .ok_or_else(|| missing_hint.to_string())?;

    let install_dir = std::env::current_exe()
        .ok()
        .and_then(|path| path.parent().map(|parent| parent.join(cache_dir_name)))
        .unwrap_or_else(|| state.runtime_root.join(cache_dir_name));
    let appdata_dir = state.app_data_dir.join(cache_dir_name);

    let requested_dir = if policy == "appdata-only" {
        appdata_dir.clone()
    } else {
        install_dir.clone()
    };

    let mut actual_dir = requested_dir.clone();
    let mut install_dir_writable = true;
    let mut using_fallback = false;

    let ensure_result = ensure_cache_dir(&requested_dir, &source_dir, required_assets);
    if let Err(error) = ensure_result {
        if requested_dir == install_dir && is_permission_denied(&error) {
            install_dir_writable = false;
            using_fallback = true;
            actual_dir = appdata_dir.clone();
            ensure_cache_dir(&actual_dir, &source_dir, required_assets)?;
        } else {
            return Err(error);
        }
    }

    write_cache_marker(&actual_dir, policy, &requested_dir, using_fallback);

    Ok(CachePrepareResult {
        policy: policy.to_string(),
        requested_dir: requested_dir.to_string_lossy().to_string(),
        actual_dir: actual_dir.to_string_lossy().to_string(),
        install_dir_writable,
        using_fallback,
        source_dir,
    })
}

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

fn package_candidate_urls(package_name: &str) -> Vec<String> {
    vec![
        format!("https://mirrors.ctan.org/install/macros/latex/contrib/{package_name}.tds.zip"),
        format!("https://mirrors.ctan.org/macros/latex/contrib/{package_name}.zip"),
        format!("https://mirrors.ctan.org/install/macros/generic/{package_name}.tds.zip"),
        format!("https://mirrors.ctan.org/macros/generic/{package_name}.zip"),
    ]
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

fn download_archive(url: &str) -> Result<Vec<u8>, String> {
    let client = Client::builder()
        .timeout(Duration::from_secs(DOWNLOAD_TIMEOUT_SECONDS))
        .build()
        .map_err(|e| e.to_string())?;
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

fn ensure_busytex_cache_dir(
    state: &State<'_, AppState>,
    policy: &str,
) -> Result<CachePrepareResult, String> {
    prepare_cache(
        state,
        policy,
        "busytex-cache",
        "busytex",
        &REQUIRED_BUSYTEX_ASSETS,
        "BusyTeX source assets were not found in app resources",
    )
}

#[tauri::command]
pub fn busytex_cache_prepare(
    state: State<'_, AppState>,
    input: BusyTexCachePrepareInput,
) -> Result<BusyTexCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = ensure_busytex_cache_dir(&state, policy)?;

    Ok(BusyTexCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
    })
}

#[tauri::command]
pub fn busytex_install_missing_package(
    state: State<'_, AppState>,
    input: BusyTexInstallPackageInput,
) -> Result<BusyTexInstallPackageResult, String> {
    let style_file = normalize_style_file(&input.style_file)
        .ok_or_else(|| format!("Invalid style file: {}", input.style_file))?;
    let package_name = package_name_from_style(&style_file);
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

    let mut reasons: Vec<String> = Vec::new();
    for url in package_candidate_urls(&package_name) {
        let archive = match download_archive(&url) {
            Ok(bytes) => bytes,
            Err(error) => {
                reasons.push(format!("{url}: {error}"));
                continue;
            }
        };

        let overlay_files = match extract_overlay_files_from_zip(&archive) {
            Ok(files) => files,
            Err(error) => {
                reasons.push(format!("{url}: zip parse failed: {error}"));
                continue;
            }
        };

        if !has_required_style_file(&overlay_files, &style_file) {
            reasons.push(format!("{url}: style file {style_file} not found in archive"));
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
        "Failed to install BusyTeX package for {style_file}. Tried: {}",
        reasons.join(" | ")
    ))
}

#[tauri::command]
pub fn analysis_pyodide_prepare(
    state: State<'_, AppState>,
    input: AnalysisPyodidePrepareInput,
) -> Result<AnalysisPyodideCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_cache(
        &state,
        policy,
        "analysis-pyodide-cache",
        "pyodide",
        &REQUIRED_PYODIDE_ASSETS,
        "Pyodide source assets were not found in app resources",
    )?;

    Ok(AnalysisPyodideCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
    })
}

#[tauri::command]
pub fn drawio_cache_prepare(
    state: State<'_, AppState>,
    input: DrawioCachePrepareInput,
) -> Result<DrawioCacheInfo, String> {
    let policy = input.policy.trim();
    let prepared = prepare_cache(
        &state,
        policy,
        "drawio-cache",
        "drawio",
        &REQUIRED_DRAWIO_ASSETS,
        "Drawio source assets were not found in app resources",
    )?;

    sync_cache_files(
        Path::new(&prepared.actual_dir),
        &prepared.source_dir,
        &REQUIRED_DRAWIO_ASSETS,
    )?;

    Ok(DrawioCacheInfo {
        policy: prepared.policy,
        requested_dir: prepared.requested_dir,
        actual_dir: prepared.actual_dir,
        install_dir_writable: prepared.install_dir_writable,
        using_fallback: prepared.using_fallback,
    })
}
