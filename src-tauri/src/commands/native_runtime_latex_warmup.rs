use super::native_runtime_common::{
    command_from_path_or_name, configure_hidden_process, try_version_command,
};
use super::native_runtime_latex_tectonic::{ensure_runtime_bundle, write_fontconfig_config};
use crate::models::TectonicWarmupInfo;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

const TECTONIC_RESOURCE_SUBDIR: &str = "tools/tectonic";
const TECTONIC_BINARY_RELATIVE_PATH: &str = "windows-x64/tectonic.exe";
const TECTONIC_BUNDLE_RELATIVE_PATH: &str = "bundles/tlextras-2022.0r0.tar";
const TECTONIC_MANAGED_CACHE_RELATIVE_PATH: &str = "cache";
const TECTONIC_BUNDLED_CACHE_SEED_RELATIVE_PATH: &str = "cache-seed";
const TECTONIC_MANAGED_SEARCH_RELATIVE_PATH: &str = "search/windows-x64";
const TECTONIC_BUNDLED_PFB_RELATIVE_PATH: &str = "pfb";
const WARMUP_HEARTBEAT_INTERVAL: Duration = Duration::from_secs(4);
pub(super) const TECTONIC_NOT_FOUND_DIAGNOSTIC: &str =
    "Tectonic was not found. Install Tectonic and retry.";
const TECTONIC_REQUIRED_SEARCH_FILES: &[&str] = &[
    "latex.ltx",
    "l3backend-xetex.def",
    "tectonic-format-latex.tex",
    "ctexart.cls",
    "xeCJK.sty",
    "pdftex.map",
    "kanjix.map",
    "ckx.map",
    "pdfglyphlist.txt",
    "glyphlist.txt",
    "lmromanslant10-regular.otf",
    "FandolSong-Regular.otf",
];
const TECTONIC_REQUIRED_BUNDLE_ENTRIES: &[&str] = &[
    "tectonic-format-latex.tex",
    "ctexart.cls",
    "xeCJK.sty",
    "EBGaramond-Bold-tosf-sc-ly1.tfm",
    "lmromanslant10-regular.otf",
    "FandolSong-Regular.otf",
];
const TECTONIC_REQUIRED_CACHE_SEED_DIRS: &[&str] = &["files", "indexes", "manifests"];

pub(super) struct ResolvedTectonicPaths {
    pub(super) engine_path: PathBuf,
    pub(super) cache_dir: PathBuf,
    pub(super) search_paths: Vec<PathBuf>,
    pub(super) fontconfig_file: Option<PathBuf>,
    pub(super) fontconfig_path: Option<PathBuf>,
    pub(super) use_only_cached: bool,
}

fn latex_tool_exists(name: &str) -> bool {
    try_version_command(&command_from_path_or_name(name), &["--version"]).is_some()
}

fn tar_tool_exists() -> bool {
    try_version_command(&command_from_path_or_name("tar"), &["--version"]).is_some()
}

fn bundled_tectonic_assets_exist(root: &Path) -> bool {
    root.join(TECTONIC_BINARY_RELATIVE_PATH).exists()
        && root.join(TECTONIC_BUNDLE_RELATIVE_PATH).exists()
        && root
            .join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH)
            .join("cmex10.pfb")
            .exists()
        && TECTONIC_REQUIRED_CACHE_SEED_DIRS.iter().all(|relative| {
            root.join(TECTONIC_BUNDLED_CACHE_SEED_RELATIVE_PATH)
                .join(relative)
                .is_dir()
        })
}

fn candidate_tectonic_source_roots() -> Vec<PathBuf> {
    let mut candidates = vec![
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("resources/{TECTONIC_RESOURCE_SUBDIR}")),
        PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .join(format!("../src-tauri/resources/{TECTONIC_RESOURCE_SUBDIR}")),
    ];
    if let Ok(exe_path) = std::env::current_exe() {
        if let Some(exe_dir) = exe_path.parent() {
            candidates.push(exe_dir.join(format!("resources/{TECTONIC_RESOURCE_SUBDIR}")));
            candidates.push(exe_dir.join(TECTONIC_RESOURCE_SUBDIR));
            candidates.push(exe_dir.join(format!("../resources/{TECTONIC_RESOURCE_SUBDIR}")));
        }
    }
    candidates
}

fn choose_bundled_tectonic_source_root() -> Option<PathBuf> {
    candidate_tectonic_source_roots()
        .into_iter()
        .find(|root| bundled_tectonic_assets_exist(root))
}

fn managed_tectonic_tool_root(app_data_dir: &Path) -> PathBuf {
    app_data_dir.join("runtime-tools").join("tectonic")
}

fn copy_asset_if_needed(source: &Path, target: &Path) -> Result<(), String> {
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let should_copy = match (fs::metadata(source), fs::metadata(target)) {
        (Ok(source_meta), Ok(target_meta)) => {
            source_meta.len() != target_meta.len()
                || source_meta.modified().ok() != target_meta.modified().ok()
        }
        (Ok(_), Err(_)) => true,
        (Err(error), _) => return Err(error.to_string()),
    };
    if should_copy {
        fs::copy(source, target).map_err(|e| e.to_string())?;
    }
    Ok(())
}

fn copy_directory_contents_if_needed(source: &Path, target: &Path) -> Result<(), String> {
    if !source.exists() {
        return Ok(());
    }
    fs::create_dir_all(target).map_err(|e| e.to_string())?;
    for entry in fs::read_dir(source).map_err(|e| e.to_string())? {
        let entry = entry.map_err(|e| e.to_string())?;
        let source_path = entry.path();
        let target_path = target.join(entry.file_name());
        let file_type = entry.file_type().map_err(|e| e.to_string())?;
        if file_type.is_dir() {
            copy_directory_contents_if_needed(&source_path, &target_path)?;
            continue;
        }
        if file_type.is_file() {
            copy_asset_if_needed(&source_path, &target_path)?;
        }
    }
    Ok(())
}

fn tectonic_search_dir_ready(search_dir: &Path) -> bool {
    TECTONIC_REQUIRED_SEARCH_FILES
        .iter()
        .all(|relative| search_dir.join(relative).exists())
}

fn tectonic_cache_dir_ready(cache_dir: &Path) -> bool {
    TECTONIC_REQUIRED_CACHE_SEED_DIRS
        .iter()
        .all(|relative| cache_dir.join(relative).is_dir())
}

pub(super) fn managed_tectonic_runtime_ready(tool_root: &Path) -> bool {
    tool_root.join(TECTONIC_BINARY_RELATIVE_PATH).exists()
        && tectonic_cache_dir_ready(&tool_root.join(TECTONIC_MANAGED_CACHE_RELATIVE_PATH))
        && tectonic_search_dir_ready(&tool_root.join(TECTONIC_MANAGED_SEARCH_RELATIVE_PATH))
        && tool_root
            .join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH)
            .join("cmex10.pfb")
            .exists()
        && tool_root.join("fontconfig/windows/fonts.conf").exists()
}

fn build_managed_tectonic_paths(tool_root: &Path) -> ResolvedTectonicPaths {
    let search_dir = tool_root.join(TECTONIC_MANAGED_SEARCH_RELATIVE_PATH);
    let pfb_dir = tool_root.join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH);
    let fontconfig_path = tool_root.join("fontconfig/windows");
    ResolvedTectonicPaths {
        engine_path: tool_root.join(TECTONIC_BINARY_RELATIVE_PATH),
        cache_dir: tool_root.join(TECTONIC_MANAGED_CACHE_RELATIVE_PATH),
        search_paths: vec![pfb_dir, search_dir],
        fontconfig_file: Some(fontconfig_path.join("fonts.conf")),
        fontconfig_path: Some(fontconfig_path),
        use_only_cached: true,
    }
}

fn summarize_process_output(stdout: &[u8], stderr: &[u8]) -> String {
    let stdout_text = String::from_utf8_lossy(stdout)
        .trim()
        .replace('\r', " ")
        .replace('\n', " | ");
    let stderr_text = String::from_utf8_lossy(stderr)
        .trim()
        .replace('\r', " ")
        .replace('\n', " | ");
    let mut parts = Vec::<String>::new();
    if !stdout_text.is_empty() {
        parts.push(format!("stdout={stdout_text}"));
    }
    if !stderr_text.is_empty() {
        parts.push(format!("stderr={stderr_text}"));
    }
    parts.join("; ")
}

fn ensure_tectonic_search_dir<F>(
    bundle_path: &Path,
    search_dir: &Path,
    mut on_progress: F,
) -> Result<(), String>
where
    F: FnMut(),
{
    if tectonic_search_dir_ready(search_dir) {
        return Ok(());
    }
    if !tar_tool_exists() {
        return Err("Bundled Tectonic search assets are not prepared and tar.exe is unavailable on this Windows system.".to_string());
    }
    fs::create_dir_all(search_dir).map_err(|e| e.to_string())?;
    let mut command = Command::new(command_from_path_or_name("tar"));
    configure_hidden_process(&mut command);
    let mut child = command
        .arg("-xf")
        .arg(bundle_path)
        .arg("-C")
        .arg(search_dir)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|e| format!("tectonic.bundle_extract_spawn_failed: {e}"))?;
    let mut next_progress_at = Instant::now() + WARMUP_HEARTBEAT_INTERVAL;
    loop {
        match child.try_wait() {
            Ok(Some(_status)) => break,
            Ok(None) => {
                if Instant::now() >= next_progress_at {
                    on_progress();
                    next_progress_at = Instant::now() + WARMUP_HEARTBEAT_INTERVAL;
                }
                thread::sleep(Duration::from_millis(250));
            }
            Err(error) => {
                return Err(format!("tectonic.bundle_extract_wait_failed: {error}"));
            }
        }
    }
    let output = child
        .wait_with_output()
        .map_err(|error| format!("tectonic.bundle_extract_wait_failed: {error}"))?;
    if output.status.success() || tectonic_search_dir_ready(search_dir) {
        return Ok(());
    }
    Err(format!(
        "Bundled Tectonic search assets are incomplete after extraction from {}. {}",
        bundle_path.to_string_lossy(),
        summarize_process_output(&output.stdout, &output.stderr),
    ))
}

fn ensure_tectonic_cache_seeded(source_root: &Path, cache_dir: &Path) -> Result<(), String> {
    let cache_seed_dir = source_root.join(TECTONIC_BUNDLED_CACHE_SEED_RELATIVE_PATH);
    if !TECTONIC_REQUIRED_CACHE_SEED_DIRS
        .iter()
        .all(|relative| cache_seed_dir.join(relative).is_dir())
    {
        return Err(
            "tectonic.cache_seed_missing: bundled Tectonic cache seed is incomplete".to_string(),
        );
    }
    copy_directory_contents_if_needed(&cache_seed_dir, cache_dir)?;
    Ok(())
}

fn emit_tectonic_warmup_progress_message<F>(
    on_progress: &mut F,
    percent: f64,
    stage: &str,
    current_item: Option<&str>,
    message: &str,
) where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    on_progress(percent, stage, current_item, Some(message));
}

fn emit_tectonic_warmup_progress<F>(
    on_progress: &mut F,
    percent: f64,
    stage: &str,
    current_item: Option<&str>,
) where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    emit_tectonic_warmup_progress_message(on_progress, percent, stage, current_item, stage);
}

pub(super) fn format_warmup_heartbeat_message(stage: &str, elapsed: Duration) -> String {
    format!("{stage} ({}s)", elapsed.as_secs())
}

fn emit_tectonic_warmup_heartbeat<F>(
    on_progress: &mut F,
    percent: f64,
    stage: &str,
    current_item: Option<&str>,
    started_at: Instant,
) where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    let message = format_warmup_heartbeat_message(stage, started_at.elapsed());
    emit_tectonic_warmup_progress_message(
        on_progress,
        percent,
        stage,
        current_item,
        message.as_str(),
    );
}

fn ensure_bundled_tectonic_runtime_with_progress<F>(
    app_data_dir: &Path,
    mut on_progress: F,
) -> Result<Option<ResolvedTectonicPaths>, String>
where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    let Some(source_root) = choose_bundled_tectonic_source_root() else {
        return Ok(None);
    };

    let tool_root = managed_tectonic_tool_root(app_data_dir);
    let source_root_text = source_root.to_string_lossy().to_string();
    emit_tectonic_warmup_progress(
        &mut on_progress,
        8.0,
        "locating_assets",
        Some(source_root_text.as_str()),
    );
    if managed_tectonic_runtime_ready(&tool_root) {
        let paths = build_managed_tectonic_paths(&tool_root);
        let ready_item = paths.engine_path.to_string_lossy().to_string();
        emit_tectonic_warmup_progress(&mut on_progress, 100.0, "ready", Some(ready_item.as_str()));
        return Ok(Some(paths));
    }

    let engine_path = tool_root.join(TECTONIC_BINARY_RELATIVE_PATH);
    let engine_item = engine_path.to_string_lossy().to_string();
    emit_tectonic_warmup_progress(
        &mut on_progress,
        20.0,
        "copying_engine",
        Some(engine_item.as_str()),
    );
    copy_asset_if_needed(
        &source_root.join(TECTONIC_BINARY_RELATIVE_PATH),
        &engine_path,
    )?;

    let bundle_item = tool_root
        .join(TECTONIC_BUNDLE_RELATIVE_PATH)
        .to_string_lossy()
        .to_string();
    emit_tectonic_warmup_progress(
        &mut on_progress,
        38.0,
        "validating_bundle",
        Some(bundle_item.as_str()),
    );
    let mut bundle_stage = String::from("validating_bundle");
    let mut bundle_stage_started_at = Instant::now();
    let bundle_path = ensure_runtime_bundle(
        &tool_root,
        &source_root,
        TECTONIC_BUNDLE_RELATIVE_PATH,
        TECTONIC_REQUIRED_BUNDLE_ENTRIES,
        |stage, current_item| {
            let item = current_item.or(Some(bundle_item.as_str()));
            if bundle_stage != stage {
                bundle_stage.clear();
                bundle_stage.push_str(stage);
                bundle_stage_started_at = Instant::now();
                emit_tectonic_warmup_progress(&mut on_progress, 38.0, stage, item);
            } else {
                emit_tectonic_warmup_heartbeat(
                    &mut on_progress,
                    38.0,
                    stage,
                    item,
                    bundle_stage_started_at,
                );
            }
        },
    )?;

    let cache_dir = tool_root.join(TECTONIC_MANAGED_CACHE_RELATIVE_PATH);
    let cache_item = cache_dir.to_string_lossy().to_string();
    emit_tectonic_warmup_progress(
        &mut on_progress,
        58.0,
        "seeding_cache",
        Some(cache_item.as_str()),
    );
    ensure_tectonic_cache_seeded(&source_root, &cache_dir)?;

    let pfb_dir = tool_root.join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH);
    copy_directory_contents_if_needed(
        &source_root.join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH),
        &pfb_dir,
    )?;

    let search_dir = tool_root.join(TECTONIC_MANAGED_SEARCH_RELATIVE_PATH);
    let search_item = search_dir.to_string_lossy().to_string();
    emit_tectonic_warmup_progress(
        &mut on_progress,
        84.0,
        "extracting_search",
        Some(search_item.as_str()),
    );
    let search_started_at = Instant::now();
    ensure_tectonic_search_dir(&bundle_path, &search_dir, || {
        emit_tectonic_warmup_heartbeat(
            &mut on_progress,
            84.0,
            "extracting_search",
            Some(search_item.as_str()),
            search_started_at,
        );
    })?;

    emit_tectonic_warmup_progress(
        &mut on_progress,
        96.0,
        "writing_fontconfig",
        Some(search_item.as_str()),
    );
    write_fontconfig_config(
        &tool_root,
        &[
            PathBuf::from("C:/Windows/Fonts"),
            search_dir.clone(),
            pfb_dir.clone(),
        ],
    )?;

    let paths = build_managed_tectonic_paths(&tool_root);
    let ready_item = paths.engine_path.to_string_lossy().to_string();
    emit_tectonic_warmup_progress(&mut on_progress, 100.0, "ready", Some(ready_item.as_str()));
    Ok(Some(paths))
}

pub(super) fn resolve_tectonic_paths_with_progress<F>(
    runtime_root: &Path,
    app_data_dir: &Path,
    mut on_progress: F,
) -> Result<Option<ResolvedTectonicPaths>, String>
where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    if let Some(paths) =
        ensure_bundled_tectonic_runtime_with_progress(app_data_dir, &mut on_progress)?
    {
        return Ok(Some(paths));
    }
    emit_tectonic_warmup_progress(&mut on_progress, 12.0, "locating_assets", Some("tectonic"));
    if latex_tool_exists("tectonic") {
        let cache_dir = runtime_root
            .join(TECTONIC_RESOURCE_SUBDIR)
            .join(TECTONIC_MANAGED_CACHE_RELATIVE_PATH);
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
        emit_tectonic_warmup_progress(&mut on_progress, 100.0, "ready", Some("tectonic"));
        return Ok(Some(ResolvedTectonicPaths {
            engine_path: PathBuf::from("tectonic"),
            cache_dir,
            search_paths: Vec::new(),
            fontconfig_file: None,
            fontconfig_path: None,
            use_only_cached: false,
        }));
    }
    Ok(None)
}

pub(super) fn resolve_tectonic_paths(
    runtime_root: &Path,
    app_data_dir: &Path,
) -> Result<Option<ResolvedTectonicPaths>, String> {
    resolve_tectonic_paths_with_progress(
        runtime_root,
        app_data_dir,
        |_percent, _stage, _current_item, _message| {},
    )
}

fn build_tectonic_warmup_info(paths: &ResolvedTectonicPaths) -> TectonicWarmupInfo {
    TectonicWarmupInfo {
        ready: true,
        engine_path: paths.engine_path.to_string_lossy().to_string(),
        cache_dir: paths.cache_dir.to_string_lossy().to_string(),
        search_paths: paths
            .search_paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        use_only_cached: paths.use_only_cached,
    }
}

pub(crate) fn ensure_tectonic_runtime_warmup_with_progress<F>(
    runtime_root: &Path,
    app_data_dir: &Path,
    mut on_progress: F,
) -> Result<TectonicWarmupInfo, String>
where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    let paths = resolve_tectonic_paths_with_progress(runtime_root, app_data_dir, &mut on_progress)?
        .ok_or_else(|| TECTONIC_NOT_FOUND_DIAGNOSTIC.to_string())?;
    Ok(build_tectonic_warmup_info(&paths))
}

pub(crate) fn ensure_tectonic_runtime_warmup(
    runtime_root: &Path,
    app_data_dir: &Path,
) -> Result<TectonicWarmupInfo, String> {
    ensure_tectonic_runtime_warmup_with_progress(
        runtime_root,
        app_data_dir,
        |_percent, _stage, _current_item, _message| {},
    )
}

#[cfg(test)]
#[path = "native_runtime_latex_warmup_tests.rs"]
mod tests;
