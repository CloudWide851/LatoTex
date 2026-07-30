use super::markdown_runtime::execute_code_blocking;
use super::plugins::read_registry;
use super::plugins_builtin_science::science_catalog;
use super::toolchains::find_local_toolchain_executable;
use crate::models::{MarkdownRunCodeInput, ScientificCommandInput, ScientificCommandResponse};
use crate::state::AppState;
use crate::storage;
use latotex_workspace::resolve_workspace_target_path;
use std::path::{Path, PathBuf};
use std::process::Command;
use tauri::{async_runtime::spawn_blocking, State};

const RUN_FILE: &str = "scientific.runFile";
const RUN_SELECTION: &str = "scientific.runSelection";
const OPEN_EXTERNAL: &str = "scientific.openExternal";

fn plugin_runtime(plugin_id: &str) -> Option<&'static str> {
    match plugin_id {
        "latotex.science.matlab" => Some("matlab"),
        "latotex.science.octave" => Some("octave"),
        "latotex.science.r" => Some("r"),
        "latotex.science.julia" => Some("julia"),
        "latotex.science.quarto" => Some("quarto"),
        "latotex.science.jupyter" => Some("jupyter"),
        "latotex.science.zotero" => Some("zotero"),
        "latotex.science.spss" => Some("spss"),
        "latotex.science.sas" => Some("sas"),
        "latotex.science.stata" => Some("stata"),
        "latotex.science.imagej" => Some("imagej"),
        "latotex.science.qgis" => Some("qgis"),
        _ => None,
    }
}

fn allowed_extensions(runtime: &str, command_id: &str) -> &'static [&'static str] {
    match (runtime, command_id) {
        ("matlab" | "octave", RUN_FILE | RUN_SELECTION) => &["m"],
        ("r", RUN_FILE) => &["r"],
        ("r", RUN_SELECTION) => &["r", "rmd"],
        ("julia", RUN_FILE | RUN_SELECTION) => &["jl"],
        ("quarto", RUN_FILE) => &["qmd"],
        ("jupyter", RUN_FILE) => &["ipynb"],
        ("zotero", OPEN_EXTERNAL) => &["bib", "ris"],
        ("spss", OPEN_EXTERNAL) => &["sav", "zsav", "sps"],
        ("sas", OPEN_EXTERNAL) => &["sas", "sas7bdat"],
        ("stata", OPEN_EXTERNAL) => &["dta", "do", "ado"],
        ("imagej", OPEN_EXTERNAL) => &["tif", "tiff", "png", "jpg", "jpeg", "gif"],
        ("qgis", OPEN_EXTERNAL) => &["qgz", "qgs", "gpkg", "shp", "geojson"],
        _ => &[],
    }
}

fn validate_command_shape(input: &ScientificCommandInput) -> Result<&'static str, String> {
    let runtime = plugin_runtime(input.plugin_id.trim())
        .ok_or_else(|| "scientific.plugin_unsupported".to_string())?;
    if !matches!(
        input.command_id.trim(),
        RUN_FILE | RUN_SELECTION | OPEN_EXTERNAL
    ) {
        return Err("scientific.command_unsupported".to_string());
    }
    let extension = Path::new(input.relative_path.trim())
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default()
        .to_ascii_lowercase();
    if !allowed_extensions(runtime, input.command_id.trim()).contains(&extension.as_str()) {
        return Err("scientific.file_type_unsupported".to_string());
    }
    if input.command_id.trim() == RUN_SELECTION && input.code.trim().is_empty() {
        return Err("scientific.selection_empty".to_string());
    }
    Ok(runtime)
}

fn ensure_enabled_builtin_plugin(runtime_root: &Path, plugin_id: &str) -> Result<(), String> {
    let installed = read_registry(runtime_root)?
        .into_iter()
        .find(|plugin| plugin.manifest.id == plugin_id && plugin.enabled)
        .ok_or_else(|| "scientific.plugin_disabled".to_string())?;
    let expected = science_catalog()
        .into_iter()
        .find(|entry| entry.manifest.id == plugin_id)
        .ok_or_else(|| "scientific.plugin_unsupported".to_string())?;
    if installed.source != "builtin" {
        return Err("scientific.plugin_invalid".to_string());
    }
    let installed_value = serde_json::to_value(installed.manifest)
        .map_err(|_| "scientific.plugin_invalid".to_string())?;
    let expected_value = serde_json::to_value(expected.manifest)
        .map_err(|_| "scientific.plugin_invalid".to_string())?;
    if installed_value != expected_value {
        return Err("scientific.plugin_invalid".to_string());
    }
    Ok(())
}

fn validated_target(state: &AppState, input: &ScientificCommandInput) -> Result<PathBuf, String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let target = resolve_workspace_target_path(&project_root, Some(&input.relative_path))
        .map_err(|_| "scientific.path_invalid".to_string())?;
    target
        .is_file()
        .then_some(target)
        .ok_or_else(|| "scientific.file_required".to_string())
}

fn execute_scientific_command(
    state: &AppState,
    input: ScientificCommandInput,
) -> Result<ScientificCommandResponse, String> {
    let runtime = validate_command_shape(&input)?;
    ensure_enabled_builtin_plugin(&state.runtime_root, input.plugin_id.trim())?;
    let target = validated_target(state, &input)?;
    let command_id = input.command_id.trim().to_string();
    if command_id == OPEN_EXTERNAL {
        let executable = find_local_toolchain_executable(runtime)
            .ok_or_else(|| "scientific.toolchain_missing".to_string())?;
        Command::new(executable)
            .arg(target)
            .spawn()
            .map_err(|_| "scientific.open_failed".to_string())?;
        return Ok(ScientificCommandResponse {
            command_id,
            status: "opened".to_string(),
            message: "scientific.opened".to_string(),
            output: None,
        });
    }
    let output = execute_code_blocking(
        state,
        MarkdownRunCodeInput {
            project_id: input.project_id,
            relative_path: Some(input.relative_path),
            language: runtime.to_string(),
            code: input.code,
        },
    )?;
    Ok(ScientificCommandResponse {
        command_id,
        status: output.status.clone(),
        message: if output.status == "completed" {
            "scientific.run_completed".to_string()
        } else {
            "scientific.run_failed".to_string()
        },
        output: Some(output),
    })
}

#[tauri::command]
pub async fn scientific_command_execute(
    state: State<'_, AppState>,
    input: ScientificCommandInput,
) -> Result<ScientificCommandResponse, String> {
    state.log(
        "INFO",
        &format!(
            "scientific_command_execute: plugin={}, command={}, project={}, path={}",
            input.plugin_id, input.command_id, input.project_id, input.relative_path
        ),
    );
    let snapshot = state.inner().clone();
    spawn_blocking(move || execute_scientific_command(&snapshot, input))
        .await
        .map_err(|_| "scientific.task_failed".to_string())?
}

#[cfg(test)]
mod tests {
    use super::{plugin_runtime, validate_command_shape};
    use crate::models::ScientificCommandInput;

    fn input(plugin_id: &str, command_id: &str, path: &str) -> ScientificCommandInput {
        ScientificCommandInput {
            project_id: "project".to_string(),
            plugin_id: plugin_id.to_string(),
            command_id: command_id.to_string(),
            relative_path: path.to_string(),
            code: "disp(1)".to_string(),
        }
    }

    #[test]
    fn scientific_commands_bind_builtin_ids_to_fixed_runtimes() {
        assert_eq!(plugin_runtime("latotex.science.matlab"), Some("matlab"));
        assert_eq!(plugin_runtime("publisher.custom"), None);
    }

    #[test]
    fn scientific_commands_reject_mismatched_paths_and_empty_selection() {
        assert!(validate_command_shape(&input(
            "latotex.science.matlab",
            "scientific.runFile",
            "analysis.m"
        ))
        .is_ok());
        assert!(validate_command_shape(&input(
            "latotex.science.matlab",
            "scientific.runFile",
            "../analysis.py"
        ))
        .is_err());
        let mut empty = input("latotex.science.r", "scientific.runSelection", "analysis.R");
        empty.code.clear();
        assert!(validate_command_shape(&empty).is_err());
    }
}
