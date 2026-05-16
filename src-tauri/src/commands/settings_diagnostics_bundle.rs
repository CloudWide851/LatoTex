use crate::models::RuntimeDiagnosticsBundleExport;
use crate::state::AppState;
use chrono::Utc;
use serde::Serialize;
use std::fs;
use std::fs::File;
use std::io::Write;
use std::path::{Path, PathBuf};
use tauri::State;
use zip::{write::SimpleFileOptions, ZipWriter};

const LOG_TAIL_LIMIT: usize = 160;
const LOG_LINE_LIMIT: usize = 320;

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct DiagnosticsManifest {
    schema: &'static str,
    created_at: String,
    app_name: String,
    app_version: String,
    install_mode: String,
    runtime_root: String,
    logs_dir: String,
    session_log_file: String,
    downloads_dir: String,
    privacy: Vec<&'static str>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct LogSummary {
    current_log_file: String,
    current_log_size_bytes: u64,
    available_log_files: usize,
    tail: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct RuntimeDoctorSnapshot {
    runtime_root_exists: bool,
    logs_dir_exists: bool,
    downloads_dir_exists: bool,
    database_exists: bool,
    current_log_exists: bool,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ResourceStatus {
    current_exe: String,
    drawio_packaged: bool,
    share_page_packaged: bool,
    cloudflared_packaged: bool,
    uv_packaged: bool,
    tectonic_packaged: bool,
}

fn sanitize_log_line(line: &str) -> String {
    let lower = line.to_ascii_lowercase();
    let sensitive = [
        "api_key",
        "apikey",
        "authorization",
        "bearer ",
        "password",
        "secret",
        "token",
        "x-api-key",
    ];
    if sensitive.iter().any(|needle| lower.contains(needle)) {
        return "[redacted sensitive log line]".to_string();
    }
    let mut out = line.chars().take(LOG_LINE_LIMIT).collect::<String>();
    if line.chars().count() > LOG_LINE_LIMIT {
        out.push_str("...");
    }
    out
}

fn read_log_tail(path: &Path) -> Vec<String> {
    let Ok(raw) = fs::read_to_string(path) else {
        return Vec::new();
    };
    let mut lines = raw
        .lines()
        .filter(|line| !line.trim().is_empty())
        .map(sanitize_log_line)
        .collect::<Vec<_>>();
    if lines.len() > LOG_TAIL_LIMIT {
        lines.split_off(lines.len() - LOG_TAIL_LIMIT)
    } else {
        lines
    }
}

fn count_log_files(logs_dir: &Path) -> usize {
    let Ok(entries) = fs::read_dir(logs_dir) else {
        return 0;
    };
    entries
        .flatten()
        .filter(|entry| {
            entry.path().is_file()
                && entry
                    .file_name()
                    .to_string_lossy()
                    .to_ascii_lowercase()
                    .ends_with(".log")
        })
        .count()
}

fn write_json_entry<T: Serialize>(
    zip: &mut ZipWriter<File>,
    name: &str,
    value: &T,
    options: SimpleFileOptions,
) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(value).map_err(|e| e.to_string())?;
    zip.start_file(name, options).map_err(|e| e.to_string())?;
    zip.write_all(&payload).map_err(|e| e.to_string())
}

fn resource_status() -> ResourceStatus {
    let current_exe = std::env::current_exe().unwrap_or_else(|_| PathBuf::new());
    let exe_dir = current_exe.parent().unwrap_or_else(|| Path::new(""));
    let resources_root = exe_dir.join("resources");
    ResourceStatus {
        current_exe: current_exe.to_string_lossy().to_string(),
        drawio_packaged: resources_root.join("core/drawio/index.html").exists(),
        share_page_packaged: resources_root.join("core/share-page/index.html").exists(),
        cloudflared_packaged: resources_root
            .join("tools/cloudflared-windows-amd64.exe")
            .exists(),
        uv_packaged: resources_root.join("tools/uv/windows-x64/uv.exe").exists(),
        tectonic_packaged: resources_root
            .join("tools/tectonic/windows-x64/tectonic.exe")
            .exists(),
    }
}

#[tauri::command]
pub fn runtime_diagnostics_bundle_export(
    state: State<'_, AppState>,
) -> Result<RuntimeDiagnosticsBundleExport, String> {
    fs::create_dir_all(&state.downloads_dir).map_err(|e| e.to_string())?;
    let created_at = Utc::now().to_rfc3339();
    let file_stamp = created_at.replace([':', '.'], "-").replace('+', "Z");
    let file_name = format!("latotex-diagnostics-{file_stamp}.zip");
    let output_path = state.downloads_dir.join(&file_name);
    let file = File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);

    let manifest = DiagnosticsManifest {
        schema: "latotex.diagnostics-bundle.v1",
        created_at: created_at.clone(),
        app_name: state.app_name.clone(),
        app_version: state.app_version.clone(),
        install_mode: state.install_mode.clone(),
        runtime_root: state.runtime_root.to_string_lossy().to_string(),
        logs_dir: state.logs_dir.to_string_lossy().to_string(),
        session_log_file: state.session_log_path.to_string_lossy().to_string(),
        downloads_dir: state.downloads_dir.to_string_lossy().to_string(),
        privacy: vec![
            "No source files, PDFs, API keys, full prompts, or raw terminal output are included.",
            "Runtime log lines are truncated and sensitive-looking lines are redacted.",
        ],
    };
    write_json_entry(&mut zip, "manifest.json", &manifest, options)?;

    let current_log_size = fs::metadata(&state.session_log_path)
        .map(|metadata| metadata.len())
        .unwrap_or(0);
    let log_summary = LogSummary {
        current_log_file: state
            .session_log_path
            .file_name()
            .map(|value| value.to_string_lossy().to_string())
            .unwrap_or_default(),
        current_log_size_bytes: current_log_size,
        available_log_files: count_log_files(&state.logs_dir),
        tail: read_log_tail(&state.session_log_path),
    };
    write_json_entry(&mut zip, "runtime-log-summary.json", &log_summary, options)?;

    let doctor = RuntimeDoctorSnapshot {
        runtime_root_exists: state.runtime_root.exists(),
        logs_dir_exists: state.logs_dir.exists(),
        downloads_dir_exists: state.downloads_dir.exists(),
        database_exists: state.db_path.exists(),
        current_log_exists: state.session_log_path.exists(),
    };
    write_json_entry(&mut zip, "doctor-snapshot.json", &doctor, options)?;
    write_json_entry(
        &mut zip,
        "resource-status.json",
        &resource_status(),
        options,
    )?;

    zip.finish().map_err(|e| e.to_string())?;
    let size_bytes = fs::metadata(&output_path).map_err(|e| e.to_string())?.len();
    state.log(
        "INFO",
        &format!(
            "runtime_diagnostics_bundle_export: path={}, bytes={}",
            output_path.to_string_lossy(),
            size_bytes
        ),
    );
    Ok(RuntimeDiagnosticsBundleExport {
        path: output_path.to_string_lossy().to_string(),
        file_name,
        size_bytes,
        created_at,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sanitize_log_line_redacts_sensitive_lines_and_truncates_long_lines() {
        assert_eq!(
            sanitize_log_line("provider Authorization: Bearer secret-token"),
            "[redacted sensitive log line]"
        );

        let long_line = "x".repeat(LOG_LINE_LIMIT + 20);
        let sanitized = sanitize_log_line(&long_line);
        assert_eq!(sanitized.chars().count(), LOG_LINE_LIMIT + 3);
        assert!(sanitized.ends_with("..."));
    }

    #[test]
    fn read_log_tail_filters_empty_lines_redacts_and_bounds_tail() {
        let dir = std::env::temp_dir().join(format!(
            "latotex-diagnostics-tail-test-{}",
            std::time::SystemTime::now()
                .duration_since(std::time::UNIX_EPOCH)
                .unwrap()
                .as_nanos()
        ));
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join("session.log");
        let mut lines = (0..(LOG_TAIL_LIMIT + 8))
            .map(|index| format!("INFO line {index}"))
            .collect::<Vec<_>>();
        lines.insert(4, "api_key=secret".to_string());
        lines.insert(5, "".to_string());
        fs::write(&path, lines.join("\n")).unwrap();

        let tail = read_log_tail(&path);

        assert_eq!(tail.len(), LOG_TAIL_LIMIT);
        assert!(tail.iter().all(|line| !line.trim().is_empty()));
        assert!(!tail.iter().any(|line| line.contains("secret")));
        assert!(tail.iter().any(|line| line.contains("INFO line")));
        let _ = fs::remove_dir_all(dir);
    }

    #[test]
    fn diagnostics_manifest_documents_privacy_boundary() {
        let manifest = DiagnosticsManifest {
            schema: "latotex.diagnostics-bundle.v1",
            created_at: "2026-05-16T00:00:00Z".to_string(),
            app_name: "LatoTex".to_string(),
            app_version: "0.1.0-test".to_string(),
            install_mode: "test".to_string(),
            runtime_root: "runtime".to_string(),
            logs_dir: "logs".to_string(),
            session_log_file: "session.log".to_string(),
            downloads_dir: "downloads".to_string(),
            privacy: vec![
                "No source files, PDFs, API keys, full prompts, or raw terminal output are included.",
                "Runtime log lines are truncated and sensitive-looking lines are redacted.",
            ],
        };
        let payload = serde_json::to_value(&manifest).unwrap();
        let privacy = payload
            .get("privacy")
            .and_then(|value| value.as_array())
            .unwrap()
            .iter()
            .map(|value| value.as_str().unwrap_or_default())
            .collect::<Vec<_>>()
            .join("\n");

        assert!(privacy.contains("No source files"));
        assert!(privacy.contains("API keys"));
        assert!(privacy.contains("redacted"));
        assert!(!payload.as_object().unwrap().contains_key("sourceFiles"));
        assert!(!payload.as_object().unwrap().contains_key("rawTerminalOutput"));
    }
}
