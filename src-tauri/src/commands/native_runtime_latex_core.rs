use super::native_runtime_common::{configure_hidden_process, sanitize_log_lines};
use super::native_runtime_latex_warmup::{
    ensure_tectonic_runtime_warmup_with_progress, resolve_tectonic_paths,
    TECTONIC_NOT_FOUND_DIAGNOSTIC,
};
use crate::models::{LatexCompileInput, LatexCompileResponse};
use crate::storage;
use std::collections::HashMap;
use std::fs;
use std::io::{BufRead, BufReader};
use std::path::Path;
use std::process::{Command, Stdio};
use std::sync::mpsc;
use std::time::Duration;
use std::time::Instant;
use uuid::Uuid;

struct CompileCommandRun {
    engine: String,
    success: bool,
    stdout: String,
    stderr: String,
}

fn write_compile_workspace(
    root: &Path,
    file_map: &HashMap<String, String>,
    main_path: &str,
    entry_content: &str,
) -> Result<(), String> {
    let total_bytes = file_map
        .values()
        .map(|content| content.len() as u64)
        .sum::<u64>()
        .saturating_add(entry_content.len() as u64);
    if total_bytes > storage::WORKSPACE_COMPILE_TOTAL_LIMIT {
        return Err("compile.workspace.too_large".to_string());
    }
    for (relative, content) in file_map {
        storage::atomic_write_under_root(
            root,
            relative,
            content.as_bytes(),
            storage::WORKSPACE_TEXT_FILE_LIMIT,
        )?;
    }
    storage::atomic_write_under_root(
        root,
        main_path,
        entry_content.as_bytes(),
        storage::WORKSPACE_TEXT_FILE_LIMIT,
    )?;
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

fn copy_if_exists(
    source: &Path,
    project_root: &Path,
    target_relative: &str,
    limit: u64,
) -> Result<Option<()>, String> {
    if !source.exists() {
        return Ok(None);
    }
    if storage::workspace_path_is_link_or_reparse(source)? {
        return Err("workspace.path.reparse_denied".to_string());
    }
    let bytes = storage::read_file_with_limit(source, limit)?;
    storage::atomic_write_under_root(project_root, target_relative, &bytes, limit)?;
    Ok(Some(()))
}

fn persist_compile_log(
    main_log: &Path,
    project_root: &Path,
    artifact_relative: &str,
    combined_log: &str,
) -> Result<Option<()>, String> {
    if main_log.exists() {
        return copy_if_exists(
            main_log,
            project_root,
            artifact_relative,
            storage::WORKSPACE_TEXT_FILE_LIMIT,
        );
    }
    if combined_log.trim().is_empty() {
        return Ok(None);
    }
    storage::atomic_write_under_root(
        project_root,
        artifact_relative,
        combined_log.as_bytes(),
        storage::WORKSPACE_TEXT_FILE_LIMIT,
    )?;
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
    let run_id = Uuid::new_v4().to_string();
    let run_root = storage::prepare_workspace_mutation_path(
        &project_root,
        &format!(".latotex/build/native/{run_id}"),
    )?;
    fs::create_dir_all(&run_root).map_err(|_| "workspace.operation.failed".to_string())?;

    on_progress(
        6.0,
        "warming_resources",
        Some(&input.main_path),
        Some("warming_resources"),
    );
    ensure_tectonic_runtime_warmup_with_progress(
        runtime_root,
        app_data_dir,
        |percent, stage, current_item, message| {
            let mapped_percent = 6.0 + (percent.clamp(0.0, 100.0) * 0.1);
            on_progress(mapped_percent, stage, current_item, message);
        },
    )?;

    on_progress(
        16.0,
        "materializing_workspace",
        Some(&input.main_path),
        None,
    );
    write_compile_workspace(
        &run_root,
        &input.file_map,
        &input.main_path,
        &input.entry_content,
    )?;

    let normalized_main = storage::normalize_workspace_path(&input.main_path)?;
    let normalized_main_text = normalized_main.to_string_lossy().to_string();
    let main_pdf = run_root.join(&normalized_main).with_extension("pdf");
    let main_log = run_root.join(&normalized_main).with_extension("log");
    let artifact_root = project_root.join(".latotex/build/native-output");
    let artifact_pdf = artifact_root.join(&normalized_main).with_extension("pdf");
    let artifact_log = artifact_root.join(&normalized_main).with_extension("log");
    let artifact_pdf_relative = to_project_relative_path(&project_root, &artifact_pdf)
        .ok_or_else(|| "workspace.path.outside_root".to_string())?;
    let artifact_log_relative = to_project_relative_path(&project_root, &artifact_log)
        .ok_or_else(|| "workspace.path.outside_root".to_string())?;

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
        let log_text = storage::read_file_with_limit(&main_log, storage::WORKSPACE_TEXT_FILE_LIMIT)
            .ok()
            .and_then(|bytes| String::from_utf8(bytes).ok())
            .unwrap_or_default();
        if !log_text.is_empty() {
            combined_log.push('\n');
            combined_log.push_str(&log_text);
        }
    }

    let diagnostics = sanitize_log_lines(&combined_log);
    let success = main_pdf.exists() && run.success;

    let pdf_relative_path = copy_if_exists(
        &main_pdf,
        &project_root,
        &artifact_pdf_relative,
        storage::WORKSPACE_BINARY_FILE_LIMIT,
    )?
    .map(|_| artifact_pdf_relative);
    let log_relative_path = persist_compile_log(
        &main_log,
        &project_root,
        &artifact_log_relative,
        &combined_log,
    )?
    .map(|_| artifact_log_relative);
    let pdf_bytes = if success && input.include_pdf_bytes.unwrap_or(false) {
        Some(storage::read_file_with_limit(
            &main_pdf,
            storage::WORKSPACE_BINARY_FILE_LIMIT,
        )?)
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
