use super::native_runtime_common::{
    command_from_path_or_name, configure_hidden_process, safe_relative_path,
    sanitize_log_lines, try_version_command,
};
use super::native_runtime_latex_tectonic::{ensure_runtime_bundle, write_fontconfig_config};
use crate::models::{LatexCompileInput, LatexCompileResponse, TectonicWarmupInfo};
use crate::storage;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use std::time::Instant;
use uuid::Uuid;

const TECTONIC_RESOURCE_SUBDIR: &str = "tools/tectonic";
const TECTONIC_BINARY_RELATIVE_PATH: &str = "windows-x64/tectonic.exe";
const TECTONIC_BUNDLE_RELATIVE_PATH: &str = "bundles/tlextras-2022.0r0.tar";
const TECTONIC_MANAGED_CACHE_RELATIVE_PATH: &str = "cache";
const TECTONIC_BUNDLED_CACHE_SEED_RELATIVE_PATH: &str = "cache-seed";
const TECTONIC_MANAGED_SEARCH_RELATIVE_PATH: &str = "search/windows-x64";
const TECTONIC_BUNDLED_PFB_RELATIVE_PATH: &str = "pfb";
const TECTONIC_NOT_FOUND_DIAGNOSTIC: &str = "Tectonic was not found. Install Tectonic and retry.";
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

struct ResolvedTectonicPaths {
    engine_path: PathBuf,
    cache_dir: PathBuf,
    search_paths: Vec<PathBuf>,
    fontconfig_file: Option<PathBuf>,
    fontconfig_path: Option<PathBuf>,
    use_only_cached: bool,
}

struct CompileCommandRun {
    engine: String,
    success: bool,
    stdout: String,
    stderr: String,
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

fn ensure_tectonic_search_dir(bundle_path: &Path, search_dir: &Path) -> Result<(), String> {
    if tectonic_search_dir_ready(search_dir) {
        return Ok(());
    }
    if !tar_tool_exists() {
        return Err("Bundled Tectonic search assets are not prepared and tar.exe is unavailable on this Windows system.".to_string());
    }
    fs::create_dir_all(search_dir).map_err(|e| e.to_string())?;
    let mut command = Command::new(command_from_path_or_name("tar"));
    configure_hidden_process(&mut command);
    let output = command
        .arg("-xf")
        .arg(bundle_path)
        .arg("-C")
        .arg(search_dir)
        .output()
        .map_err(|e| format!("tectonic.bundle_extract_spawn_failed: {e}"))?;
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
    if !TECTONIC_REQUIRED_CACHE_SEED_DIRS.iter().all(|relative| cache_seed_dir.join(relative).is_dir())
    {
        return Err("tectonic.cache_seed_missing: bundled Tectonic cache seed is incomplete".to_string());
    }
    copy_directory_contents_if_needed(&cache_seed_dir, cache_dir)?;
    Ok(())
}

fn ensure_bundled_tectonic_runtime(app_data_dir: &Path) -> Result<Option<ResolvedTectonicPaths>, String> {
    let Some(source_root) = choose_bundled_tectonic_source_root() else {
        return Ok(None);
    };

    let tool_root = managed_tectonic_tool_root(app_data_dir);
    let engine_path = tool_root.join(TECTONIC_BINARY_RELATIVE_PATH);
    let cache_dir = tool_root.join(TECTONIC_MANAGED_CACHE_RELATIVE_PATH);
    let search_dir = tool_root.join(TECTONIC_MANAGED_SEARCH_RELATIVE_PATH);
    let pfb_dir = tool_root.join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH);

    copy_asset_if_needed(
        &source_root.join(TECTONIC_BINARY_RELATIVE_PATH),
        &engine_path,
    )?;
    let bundle_path = ensure_runtime_bundle(
        &tool_root,
        &source_root,
        TECTONIC_BUNDLE_RELATIVE_PATH,
        TECTONIC_REQUIRED_BUNDLE_ENTRIES,
    )?;
    ensure_tectonic_cache_seeded(&source_root, &cache_dir)?;
    copy_directory_contents_if_needed(
        &source_root.join(TECTONIC_BUNDLED_PFB_RELATIVE_PATH),
        &pfb_dir,
    )?;
    ensure_tectonic_search_dir(&bundle_path, &search_dir)?;
    let (fontconfig_file, fontconfig_path) = write_fontconfig_config(
        &tool_root,
        &[
            PathBuf::from("C:/Windows/Fonts"),
            search_dir.clone(),
            pfb_dir.clone(),
        ],
    )?;

    Ok(Some(ResolvedTectonicPaths {
        engine_path,
        cache_dir,
        search_paths: vec![pfb_dir, search_dir],
        fontconfig_file: Some(fontconfig_file),
        fontconfig_path: Some(fontconfig_path),
        use_only_cached: true,
    }))
}

fn resolve_tectonic_paths(
    runtime_root: &Path,
    app_data_dir: &Path,
) -> Result<Option<ResolvedTectonicPaths>, String> {
    if let Some(paths) = ensure_bundled_tectonic_runtime(app_data_dir)? {
        return Ok(Some(paths));
    }
    if latex_tool_exists("tectonic") {
        let cache_dir = runtime_root
            .join(TECTONIC_RESOURCE_SUBDIR)
            .join(TECTONIC_MANAGED_CACHE_RELATIVE_PATH);
        fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;
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

pub fn ensure_tectonic_runtime_warmup(
    runtime_root: &Path,
    app_data_dir: &Path,
) -> Result<TectonicWarmupInfo, String> {
    let paths = resolve_tectonic_paths(runtime_root, app_data_dir)?
        .ok_or_else(|| TECTONIC_NOT_FOUND_DIAGNOSTIC.to_string())?;
    Ok(TectonicWarmupInfo {
        ready: true,
        engine_path: paths.engine_path.to_string_lossy().to_string(),
        cache_dir: paths.cache_dir.to_string_lossy().to_string(),
        search_paths: paths
            .search_paths
            .iter()
            .map(|path| path.to_string_lossy().to_string())
            .collect(),
        use_only_cached: paths.use_only_cached,
    })
}

fn write_compile_workspace(
    root: &Path,
    file_map: &HashMap<String, String>,
    main_path: &str,
    entry_content: &str,
) -> Result<(), String> {
    for (relative, content) in file_map {
        let target = root.join(safe_relative_path(relative)?);
        if let Some(parent) = target.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        fs::write(target, content).map_err(|e| e.to_string())?;
    }
    let main_target = root.join(safe_relative_path(main_path)?);
    if let Some(parent) = main_target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(main_target, entry_content).map_err(|e| e.to_string())?;
    Ok(())
}

fn to_project_relative_path(project_root: &Path, path: &Path) -> Option<String> {
    path.strip_prefix(project_root).ok().map(|relative| {
        relative
            .to_string_lossy()
            .replace('\\', "/")
            .trim_start_matches('/')
            .to_string()
    })
}

fn copy_if_exists(source: &Path, target: &Path) -> Result<Option<()>, String> {
    if !source.exists() {
        return Ok(None);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(Some(()))
}

fn persist_compile_log(
    main_log: &Path,
    artifact_log: &Path,
    combined_log: &str,
) -> Result<Option<()>, String> {
    if main_log.exists() {
        return copy_if_exists(main_log, artifact_log);
    }
    if combined_log.trim().is_empty() {
        return Ok(None);
    }
    if let Some(parent) = artifact_log.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::write(artifact_log, combined_log).map_err(|e| e.to_string())?;
    Ok(Some(()))
}

fn spawn_reader<R>(
    reader: R,
    is_stdout: bool,
    sender: mpsc::Sender<(bool, String)>,
) -> std::thread::JoinHandle<()>
where
    R: std::io::Read + Send + 'static,
{
    std::thread::spawn(move || {
        let mut buffer = BufReader::new(reader);
        let mut line = String::new();
        loop {
            line.clear();
            match buffer.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let normalized = line.trim().to_string();
                    if !normalized.is_empty() {
                        let _ = sender.send((is_stdout, normalized));
                    }
                }
                Err(_) => break,
            }
        }
    })
}

fn run_compile_command_with_progress<F>(
    runtime_root: &Path,
    app_data_dir: &Path,
    prefer_engine: Option<&str>,
    run_root: &Path,
    main_path: &str,
    mut on_progress: F,
) -> Result<CompileCommandRun, String>
where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    if prefer_engine.is_some_and(|value| !value.eq_ignore_ascii_case("tectonic")) {
        return Err("compile.engine.missing".to_string());
    }
    let Some(paths) = resolve_tectonic_paths(runtime_root, app_data_dir)? else {
        return Err(TECTONIC_NOT_FOUND_DIAGNOSTIC.to_string());
    };

    let engine_path_text = paths.engine_path.to_string_lossy().to_string();
    on_progress(
        28.0,
        "starting_tectonic",
        Some(main_path),
        Some(&engine_path_text),
    );

    let mut command = Command::new(&paths.engine_path);
    command.arg("-X").arg("compile");
    command.arg(main_path);
    if paths.use_only_cached {
        command.arg("--only-cached");
    }
    for search_path in &paths.search_paths {
        command.arg("-Z");
        command.arg(format!("search-path={}", search_path.to_string_lossy()));
    }
    command.env("TECTONIC_CACHE_DIR", &paths.cache_dir);
    if let Some(fontconfig_file) = &paths.fontconfig_file {
        command.env("FONTCONFIG_FILE", fontconfig_file);
    }
    if let Some(fontconfig_path) = &paths.fontconfig_path {
        command.env("FONTCONFIG_PATH", fontconfig_path);
    }
    command.stdout(Stdio::piped());
    command.stderr(Stdio::piped());
    configure_hidden_process(&mut command);
    command.current_dir(run_root);
    let mut child = command
        .spawn()
        .map_err(|e| format!("compile.spawn_failed: {e}"))?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "compile.stdout_unavailable".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "compile.stderr_unavailable".to_string())?;
    let (tx, rx) = mpsc::channel::<(bool, String)>();
    let stdout_handle = spawn_reader(stdout, true, tx.clone());
    let stderr_handle = spawn_reader(stderr, false, tx);
    let mut stdout_lines = Vec::<String>::new();
    let mut stderr_lines = Vec::<String>::new();

    loop {
        match rx.recv_timeout(Duration::from_millis(140)) {
            Ok((is_stdout, line)) => {
                if is_stdout {
                    stdout_lines.push(line.clone());
                } else {
                    stderr_lines.push(line.clone());
                }
                on_progress(64.0, "compiling", Some(main_path), Some(&line));
            }
            Err(mpsc::RecvTimeoutError::Timeout) => {
                if child.try_wait().map_err(|e| e.to_string())?.is_some() {
                    break;
                }
            }
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    let status = child.wait().map_err(|e| e.to_string())?;
    let _ = stdout_handle.join();
    let _ = stderr_handle.join();
    while let Ok((is_stdout, line)) = rx.try_recv() {
        if is_stdout {
            stdout_lines.push(line.clone());
        } else {
            stderr_lines.push(line.clone());
        }
        on_progress(64.0, "compiling", Some(main_path), Some(&line));
    }

    Ok(CompileCommandRun {
        engine: "tectonic".to_string(),
        success: status.success(),
        stdout: stdout_lines.join("\n"),
        stderr: stderr_lines.join("\n"),
    })
}

pub(crate) fn compile_blocking_with_progress<F>(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    input: LatexCompileInput,
    mut on_progress: F,
) -> Result<LatexCompileResponse, String>
where
    F: FnMut(f64, &str, Option<&str>, Option<&str>),
{
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    let compile_root = project_root.join(".latotex/build/native");
    let run_id = Uuid::new_v4().to_string();
    let run_root = compile_root.join(&run_id);
    fs::create_dir_all(&run_root).map_err(|e| e.to_string())?;

    on_progress(6.0, "warming_resources", Some(&input.main_path), None);
    ensure_tectonic_runtime_warmup(runtime_root, app_data_dir)?;

    on_progress(16.0, "materializing_workspace", Some(&input.main_path), None);
    write_compile_workspace(
        &run_root,
        &input.file_map,
        &input.main_path,
        &input.entry_content,
    )?;

    let normalized_main = safe_relative_path(&input.main_path)?;
    let normalized_main_text = normalized_main.to_string_lossy().to_string();
    let main_pdf = run_root.join(&normalized_main).with_extension("pdf");
    let main_log = run_root.join(&normalized_main).with_extension("log");
    let artifact_root = project_root.join(".latotex/build/native-output");
    let artifact_pdf = artifact_root.join(&normalized_main).with_extension("pdf");
    let artifact_log = artifact_root.join(&normalized_main).with_extension("log");

    let started = Instant::now();
    let run = match run_compile_command_with_progress(
        runtime_root,
        app_data_dir,
        input.prefer_engine.as_deref(),
        &run_root,
        &normalized_main_text,
        |percent, stage, current_item, latest_log_line| {
            on_progress(percent, stage, current_item, latest_log_line)
        },
    ) {
        Ok(value) => value,
        Err(error) => {
            return Ok(LatexCompileResponse {
                status: "error".to_string(),
                engine: "missing".to_string(),
                diagnostics: vec![error],
                duration_ms: 0,
                pdf_relative_path: None,
                log_relative_path: None,
                pdf_bytes: None,
                used_fallback_fonts: Vec::new(),
                recovered_packages: Vec::new(),
            })
        }
    };
    let duration_ms = started.elapsed().as_millis() as u64;

    let artifact_pdf_text = artifact_pdf.to_string_lossy().to_string();
    on_progress(90.0, "writing_artifacts", Some(&artifact_pdf_text), None);

    let mut combined_log = String::new();
    combined_log.push_str(&run.stdout);
    combined_log.push('\n');
    combined_log.push_str(&run.stderr);
    if main_log.exists() {
        let log_text = fs::read_to_string(&main_log).unwrap_or_default();
        if !log_text.is_empty() {
            combined_log.push('\n');
            combined_log.push_str(&log_text);
        }
    }

    let diagnostics = sanitize_log_lines(&combined_log);
    let success = main_pdf.exists() && run.success;

    let pdf_relative_path = copy_if_exists(&main_pdf, &artifact_pdf)?
        .and_then(|_| to_project_relative_path(&project_root, &artifact_pdf));
    let log_relative_path = persist_compile_log(&main_log, &artifact_log, &combined_log)?
        .and_then(|_| to_project_relative_path(&project_root, &artifact_log));
    let pdf_bytes = if success && input.include_pdf_bytes.unwrap_or(false) {
        Some(fs::read(&main_pdf).map_err(|e| e.to_string())?)
    } else {
        None
    };

    Ok(LatexCompileResponse {
        status: if success {
            "success".to_string()
        } else {
            "error".to_string()
        },
        engine: run.engine,
        diagnostics,
        duration_ms,
        pdf_relative_path,
        log_relative_path,
        pdf_bytes,
        used_fallback_fonts: Vec::new(),
        recovered_packages: Vec::new(),
    })
}

pub(crate) fn compile_blocking(
    db_path: &Path,
    runtime_root: &Path,
    app_data_dir: &Path,
    input: LatexCompileInput,
) -> Result<LatexCompileResponse, String> {
    compile_blocking_with_progress(
        db_path,
        runtime_root,
        app_data_dir,
        input,
        |_percent, _stage, _current_item, _latest_log_line| {},
    )
}
