use super::native_runtime_common::{
    command_from_path_or_name, configure_hidden_process, safe_relative_path,
    sanitize_log_lines, try_version_command,
};
use crate::models::{LatexCompileInput, LatexCompileResponse};
use crate::state::AppState;
use crate::storage;
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::Instant;
use tauri::State;
use uuid::Uuid;

const TECTONIC_RESOURCE_SUBDIR: &str = "tools/tectonic";
const TECTONIC_BINARY_RELATIVE_PATH: &str = "windows-x64/tectonic.exe";
const TECTONIC_NOT_FOUND_DIAGNOSTIC: &str =
    "Tectonic was not found. Install Tectonic and retry.";

struct ResolvedTectonicPaths {
    engine_path: PathBuf,
    cache_dir: PathBuf,
}

fn latex_tool_exists(name: &str) -> bool {
    try_version_command(&command_from_path_or_name(name), &["--version"]).is_some()
}

fn bundled_tectonic_assets_exist(root: &Path) -> bool {
    root.join(TECTONIC_BINARY_RELATIVE_PATH).exists()
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

fn ensure_bundled_tectonic_runtime(
    runtime_root: &Path,
) -> Result<Option<ResolvedTectonicPaths>, String> {
    let Some(source_root) = choose_bundled_tectonic_source_root() else {
        return Ok(None);
    };

    let tool_root = runtime_root.join(TECTONIC_RESOURCE_SUBDIR);
    let engine_path = tool_root.join(TECTONIC_BINARY_RELATIVE_PATH);
    let cache_dir = tool_root.join("cache");

    copy_asset_if_needed(
        &source_root.join(TECTONIC_BINARY_RELATIVE_PATH),
        &engine_path,
    )?;
    fs::create_dir_all(&cache_dir).map_err(|e| e.to_string())?;

    Ok(Some(ResolvedTectonicPaths {
        engine_path,
        cache_dir,
    }))
}

fn resolve_tectonic_paths(runtime_root: &Path) -> Result<Option<ResolvedTectonicPaths>, String> {
    if let Some(paths) = ensure_bundled_tectonic_runtime(runtime_root)? {
        return Ok(Some(paths));
    }
    if latex_tool_exists("tectonic") {
        return Ok(Some(ResolvedTectonicPaths {
            engine_path: PathBuf::from("tectonic"),
            cache_dir: runtime_root.join(TECTONIC_RESOURCE_SUBDIR).join("cache"),
        }));
    }
    Ok(None)
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

fn copy_if_exists(source: &Path, target: &Path) -> Result<Option<String>, String> {
    if !source.exists() {
        return Ok(None);
    }
    if let Some(parent) = target.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    fs::copy(source, target).map_err(|e| e.to_string())?;
    Ok(Some(target.to_string_lossy().replace('\\', "/")))
}

fn run_compile_command(
    runtime_root: &Path,
    prefer_engine: Option<&str>,
    run_root: &Path,
    main_path: &str,
) -> Result<(String, std::process::Output, Option<std::process::Output>), String> {
    if prefer_engine.is_some_and(|value| !value.eq_ignore_ascii_case("tectonic")) {
        return Err("compile.engine.missing".to_string());
    }
    let Some(paths) = resolve_tectonic_paths(runtime_root)? else {
        return Err(TECTONIC_NOT_FOUND_DIAGNOSTIC.to_string());
    };
    let mut command = Command::new(&paths.engine_path);
    command.arg("-X").arg("compile");
    command.arg(main_path);
    command.env("TECTONIC_CACHE_DIR", &paths.cache_dir);
    configure_hidden_process(&mut command);
    command.current_dir(run_root);
    let output = command
        .output()
        .map_err(|e| format!("compile.spawn_failed: {e}"))?;
    Ok(("tectonic".to_string(), output, None))
}

fn compile_blocking(
    db_path: &Path,
    runtime_root: &Path,
    input: LatexCompileInput,
) -> Result<LatexCompileResponse, String> {
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    let compile_root = project_root.join(".latotex/build/native");
    let run_id = Uuid::new_v4().to_string();
    let run_root = compile_root.join(&run_id);
    fs::create_dir_all(&run_root).map_err(|e| e.to_string())?;

    write_compile_workspace(
        &run_root,
        &input.file_map,
        &input.main_path,
        &input.entry_content,
    )?;

    let normalized_main = safe_relative_path(&input.main_path)?;
    let main_pdf = run_root.join(&normalized_main).with_extension("pdf");
    let main_log = run_root.join(&normalized_main).with_extension("log");
    let artifact_root = project_root.join(".latotex/build/native-output");
    let artifact_pdf = artifact_root.join(&normalized_main).with_extension("pdf");
    let artifact_log = artifact_root.join(&normalized_main).with_extension("log");

    let started = Instant::now();
    let (engine, first_output, second_output) = match run_compile_command(
        runtime_root,
        input.prefer_engine.as_deref(),
        &run_root,
        &normalized_main.to_string_lossy(),
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
    let mut combined_log = String::new();
    combined_log.push_str(&String::from_utf8_lossy(&first_output.stdout));
    combined_log.push('\n');
    combined_log.push_str(&String::from_utf8_lossy(&first_output.stderr));
    if let Some(extra) = &second_output {
        combined_log.push('\n');
        combined_log.push_str(&String::from_utf8_lossy(&extra.stdout));
        combined_log.push('\n');
        combined_log.push_str(&String::from_utf8_lossy(&extra.stderr));
    }
    if main_log.exists() {
        let log_text = fs::read_to_string(&main_log).unwrap_or_default();
        if !log_text.is_empty() {
            combined_log.push('\n');
            combined_log.push_str(&log_text);
        }
    }

    let diagnostics = sanitize_log_lines(&combined_log);
    let success = main_pdf.exists()
        && first_output.status.success()
        && second_output
            .as_ref()
            .map(|item| item.status.success())
            .unwrap_or(true);

    let pdf_relative_path = copy_if_exists(&main_pdf, &artifact_pdf)?.map(|full| {
        full.replace(project_root.to_string_lossy().as_ref(), "")
            .trim_start_matches('/')
            .to_string()
    });
    let log_relative_path = copy_if_exists(&main_log, &artifact_log)?.map(|full| {
        full.replace(project_root.to_string_lossy().as_ref(), "")
            .trim_start_matches('/')
            .to_string()
    });
    let pdf_bytes = if success {
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
        engine,
        diagnostics,
        duration_ms,
        pdf_relative_path,
        log_relative_path,
        pdf_bytes,
        used_fallback_fonts: Vec::new(),
        recovered_packages: Vec::new(),
    })
}

#[tauri::command]
pub async fn latex_compile_native(
    state: State<'_, AppState>,
    input: LatexCompileInput,
) -> Result<LatexCompileResponse, String> {
    let project_id = input.project_id.clone();
    let main_path = input.main_path.clone();
    let reason = input.reason.clone().unwrap_or_else(|| "manual".to_string());
    state.log(
        "INFO",
        &format!(
            "latex_compile_native: project={}, file={}, reason={}",
            input.project_id, input.main_path, reason
        ),
    );

    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let response =
        tauri::async_runtime::spawn_blocking(move || compile_blocking(&db_path, &runtime_root, input))
            .await
            .map_err(|e| e.to_string())??;
    state.log(
        if response.status == "success" {
            "INFO"
        } else {
            "ERROR"
        },
        &format!(
            "latex_compile_native.result: project={}, file={}, status={}, engine={}, duration_ms={}, diagnostics={}",
            project_id,
            main_path,
            response.status,
            response.engine,
            response.duration_ms,
            response.diagnostics.join(" | ")
        ),
    );
    Ok(response)
}


