use super::markdown_runtime::{command_output_with_timeout, run_python};
use super::toolchains::{find_local_toolchain_executable, find_managed_toolchain_executable};
use crate::models::MarkdownRunCodeInput;
use crate::state::AppState;
use crate::storage;
use std::ffi::OsString;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;

fn scientific_script_args(language: &str, script: &Path) -> Result<Vec<OsString>, String> {
    let args = match language {
        "r" => vec![
            OsString::from("--vanilla"),
            script.as_os_str().to_os_string(),
        ],
        "matlab" => {
            let escaped = script
                .to_string_lossy()
                .replace('\\', "/")
                .replace('\'', "''");
            vec![
                OsString::from("-batch"),
                OsString::from(format!("run('{escaped}')")),
            ]
        }
        "octave" => vec![
            OsString::from("--no-gui"),
            OsString::from("--quiet"),
            script.as_os_str().to_os_string(),
        ],
        "julia" => vec![
            OsString::from("--startup-file=no"),
            OsString::from("--history-file=no"),
            script.as_os_str().to_os_string(),
        ],
        _ => return Err("markdown.run.language_unsupported".to_string()),
    };
    Ok(args)
}

fn scientific_runner_candidates(language: &str) -> &'static [&'static str] {
    match language {
        "r" => &["bin/Rscript.exe", "Rscript.exe"],
        "matlab" => &["matlab.exe", "bin/matlab.exe"],
        "octave" => &["octave-cli.exe", "bin/octave-cli.exe", "octave.exe"],
        "julia" => &["julia.exe", "bin/julia.exe"],
        _ => &[],
    }
}

pub(super) fn scientific_capability(runtime_root: &Path, language: &str) -> Option<PathBuf> {
    match language {
        "r" | "matlab" | "octave" | "julia" => {
            let candidates = scientific_runner_candidates(language);
            find_managed_toolchain_executable(&[language], candidates, runtime_root)
                .or_else(|| find_local_toolchain_executable(language))
        }
        "quarto" => find_local_toolchain_executable("quarto"),
        "jupyter" => find_managed_toolchain_executable(
            &["python"],
            &["python.exe", "Scripts/python.exe", "bin/python.exe"],
            runtime_root,
        )
        .or_else(|| find_local_toolchain_executable("python")),
        _ => None,
    }
}

pub(super) fn run_scientific_interpreter(
    state: &AppState,
    input: &MarkdownRunCodeInput,
    language: &str,
    run_dir: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let runner = scientific_capability(&state.runtime_root, language)
        .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let extension = match language {
        "r" => "R",
        "matlab" | "octave" => "m",
        "julia" => "jl",
        _ => return Err("markdown.run.language_unsupported".to_string()),
    };
    let script = run_dir.join(format!("snippet.{extension}"));
    fs::write(&script, &input.code).map_err(|_| "markdown.run.stage_failed".to_string())?;
    let mut command = Command::new(&runner);
    command
        .current_dir(project_root)
        .args(scientific_script_args(language, &script)?);
    let (stdout, stderr, exit_code) = command_output_with_timeout(command)?;
    Ok((
        stdout,
        stderr,
        exit_code,
        runner.to_string_lossy().to_string(),
    ))
}

pub(super) fn run_quarto(
    state: &AppState,
    input: &MarkdownRunCodeInput,
    run_dir: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let project_root = storage::load_project_root(&state.db_path, &input.project_id)?;
    let runner = scientific_capability(&state.runtime_root, "quarto")
        .ok_or_else(|| "markdown.run.toolchain_missing".to_string())?;
    let source = run_dir.join("document.qmd");
    let output_dir = run_dir.join("output");
    fs::create_dir_all(&output_dir).map_err(|_| "markdown.run.stage_failed".to_string())?;
    fs::write(&source, &input.code).map_err(|_| "markdown.run.stage_failed".to_string())?;
    let mut command = Command::new(&runner);
    command
        .current_dir(project_root)
        .arg("render")
        .arg(&source)
        .arg("--output-dir")
        .arg(&output_dir);
    let (stdout, stderr, exit_code) = command_output_with_timeout(command)?;
    Ok((
        stdout,
        stderr,
        exit_code,
        runner.to_string_lossy().to_string(),
    ))
}

fn notebook_python_source(raw: &str) -> Result<String, String> {
    let value: serde_json::Value =
        serde_json::from_str(raw).map_err(|_| "markdown.run.notebook_invalid".to_string())?;
    let language = value
        .pointer("/metadata/kernelspec/language")
        .and_then(serde_json::Value::as_str)
        .or_else(|| {
            value
                .pointer("/metadata/language_info/name")
                .and_then(serde_json::Value::as_str)
        })
        .unwrap_or("python");
    if !language.eq_ignore_ascii_case("python") {
        return Err("markdown.run.notebook_language_unsupported".to_string());
    }
    let cells = value
        .get("cells")
        .and_then(serde_json::Value::as_array)
        .ok_or_else(|| "markdown.run.notebook_invalid".to_string())?;
    if cells.len() > 128 {
        return Err("markdown.run.notebook_too_many_cells".to_string());
    }
    let mut output = String::new();
    for (index, cell) in cells.iter().enumerate() {
        if cell.get("cell_type").and_then(serde_json::Value::as_str) != Some("code") {
            continue;
        }
        let source = match cell.get("source") {
            Some(serde_json::Value::String(value)) => value.clone(),
            Some(serde_json::Value::Array(lines)) => lines
                .iter()
                .map(|line| line.as_str().unwrap_or_default())
                .collect::<String>(),
            _ => return Err("markdown.run.notebook_invalid".to_string()),
        };
        output.push_str(&format!("\n# %% [cell {}]\n", index + 1));
        output.push_str(&source);
        if !source.ends_with('\n') {
            output.push('\n');
        }
    }
    if output.trim().is_empty() {
        return Err("markdown.run.notebook_empty".to_string());
    }
    Ok(output)
}

pub(super) fn run_jupyter_staged(
    state: &AppState,
    input: &MarkdownRunCodeInput,
    run_dir: &Path,
) -> Result<(Vec<u8>, Vec<u8>, Option<i32>, String), String> {
    let staged = MarkdownRunCodeInput {
        project_id: input.project_id.clone(),
        relative_path: input.relative_path.clone(),
        language: "python".to_string(),
        code: notebook_python_source(&input.code)?,
    };
    run_python(state, &staged, run_dir)
}

#[cfg(test)]
mod tests {
    use super::{notebook_python_source, scientific_script_args};
    use std::path::Path;

    #[test]
    fn scientific_runner_arguments_are_structured() {
        let script = Path::new(r"C:\safe-runtime\snippet.m");
        let matlab = scientific_script_args("matlab", script).expect("matlab args");
        assert_eq!(matlab[0], "-batch");
        assert_eq!(
            matlab[1].to_string_lossy(),
            "run('C:/safe-runtime/snippet.m')"
        );
        let r = scientific_script_args("r", Path::new("snippet.R")).expect("r args");
        assert_eq!(r[0], "--vanilla");
        assert_eq!(r[1], "snippet.R");
    }

    #[test]
    fn notebook_staging_accepts_python_code_cells_only() {
        let source = notebook_python_source(
            r##"{"metadata":{"kernelspec":{"language":"python"}},"cells":[{"cell_type":"markdown","source":["# Title"]},{"cell_type":"code","source":["print(1)\n"]}]}"##,
        )
        .expect("python notebook");
        assert!(source.contains("print(1)"));
        assert!(notebook_python_source(
            r#"{"metadata":{"kernelspec":{"language":"julia"}},"cells":[]}"#
        )
        .is_err());
    }
}
