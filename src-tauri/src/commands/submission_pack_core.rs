use super::submission_pack_collect::{collect_pack_files, issue};
use super::submission_pack_profiles::{canonical_profile_id, parse_profile};
use crate::models::{
    SubmissionPackBuildInput, SubmissionPackBuildResponse, SubmissionPackFile, SubmissionPackIssue,
    SubmissionPackIssueInput, SubmissionPackSkippedFile,
};
use crate::storage;
use serde::Serialize;
use std::fs;
use std::io::{self, Read};
use std::path::Path;
use zip::{write::SimpleFileOptions, ZipWriter};

const PACK_SCHEMA: &str = "latotex.submission-pack.v1";

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct SubmissionPackManifest {
    schema: &'static str,
    generated_at: String,
    app_version: &'static str,
    profile_id: String,
    main_path: String,
    status: String,
    zip_path: Option<String>,
    blockers: Vec<SubmissionPackIssue>,
    warnings: Vec<SubmissionPackIssue>,
    included_files: Vec<SubmissionPackFile>,
    skipped_files: Vec<SubmissionPackSkippedFile>,
}

fn from_gate_issue(input: &SubmissionPackIssueInput) -> SubmissionPackIssue {
    issue(
        &input.id,
        &input.severity,
        input.count,
        input.detail.clone(),
    )
}

fn write_manifest(
    root: &Path,
    relative_path: &str,
    manifest: &SubmissionPackManifest,
) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    storage::atomic_write_under_root(
        root,
        relative_path,
        &payload,
        storage::WORKSPACE_TEXT_FILE_LIMIT,
    )
    .map(|_| ())
}

fn write_zip(
    root: &Path,
    output_relative: &str,
    files: &[SubmissionPackFile],
) -> Result<(), String> {
    storage::atomic_write_stream_under_root(
        root,
        output_relative,
        storage::WORKSPACE_SUBMISSION_TOTAL_LIMIT,
        |output| {
            let mut zip = ZipWriter::new(output);
            let options =
                SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
            for item in files {
                let source = storage::safe_join(root, &item.path)?;
                if storage::workspace_path_is_link_or_reparse(&source)? {
                    return Err("workspace.path.reparse_denied".to_string());
                }
                let metadata = storage::ensure_workspace_binary_file(&source)?;
                if metadata.len() != item.size_bytes {
                    return Err("submissionPack.sourceChanged".to_string());
                }
                let mut input = fs::File::open(&source)
                    .map_err(|_| "workspace.path.unavailable".to_string())?;
                zip.start_file(&item.path, options)
                    .map_err(|_| "submissionPack.zipWriteFailed".to_string())?;
                let mut limited = Read::take(&mut input, storage::WORKSPACE_BINARY_FILE_LIMIT + 1);
                let copied = io::copy(&mut limited, &mut zip)
                    .map_err(|_| "submissionPack.zipWriteFailed".to_string())?;
                if copied != item.size_bytes || copied > storage::WORKSPACE_BINARY_FILE_LIMIT {
                    return Err("workspace.file_read.too_large".to_string());
                }
            }
            zip.finish()
                .map_err(|_| "submissionPack.zipWriteFailed".to_string())?;
            Ok(())
        },
    )
    .map(|_| ())
}

pub(super) fn build_submission_pack(
    db_path: &Path,
    input: SubmissionPackBuildInput,
) -> Result<SubmissionPackBuildResponse, String> {
    let project_root = storage::load_project_root(db_path, &input.project_id)?;
    let profile = parse_profile(&input.profile_id);
    let profile_id = canonical_profile_id(profile).to_string();
    let (included_files, skipped_files, mut blockers, mut warnings) =
        collect_pack_files(&project_root, &input.main_path, profile);

    for gate_issue in &input.gate_issues {
        if gate_issue.severity == "error" {
            blockers.push(from_gate_issue(gate_issue));
        } else if gate_issue.severity == "warning" {
            warnings.push(from_gate_issue(gate_issue));
        }
    }
    if !input.compile_diagnostics.is_empty() {
        blockers.push(issue(
            "compileDiagnostics",
            "error",
            Some(input.compile_diagnostics.len().min(u32::MAX as usize) as u32),
            input.compile_diagnostics.first().cloned(),
        ));
    }
    blockers.sort_by(|a, b| a.id.cmp(&b.id).then(a.detail.cmp(&b.detail)));
    warnings.sort_by(|a, b| a.id.cmp(&b.id).then(a.detail.cmp(&b.detail)));

    let generated_at = storage::now_iso();
    let folder_stamp = generated_at.replace([':', '.'], "-").replace('+', "Z");
    let output_relative_dir = format!(".latotex/submissions/{folder_stamp}-{profile_id}");
    let output_dir = storage::prepare_workspace_mutation_path(&project_root, &output_relative_dir)?;
    fs::create_dir_all(&output_dir).map_err(|_| "workspace.operation.failed".to_string())?;
    let manifest_relative = format!("{output_relative_dir}/submission-manifest.json");
    let zip_relative = format!("{output_relative_dir}/source.zip");
    let status = if blockers.is_empty() {
        "ready"
    } else {
        "blocked"
    }
    .to_string();

    if status == "ready" {
        write_zip(&project_root, &zip_relative, &included_files)?;
    }

    let manifest = SubmissionPackManifest {
        schema: PACK_SCHEMA,
        generated_at,
        app_version: env!("CARGO_PKG_VERSION"),
        profile_id: profile_id.clone(),
        main_path: input.main_path.replace('\\', "/"),
        status: status.clone(),
        zip_path: if status == "ready" {
            Some(zip_relative.clone())
        } else {
            None
        },
        blockers: blockers.clone(),
        warnings: warnings.clone(),
        included_files: included_files.clone(),
        skipped_files: skipped_files.clone(),
    };
    write_manifest(&project_root, &manifest_relative, &manifest)?;

    Ok(SubmissionPackBuildResponse {
        status,
        profile_id,
        manifest_path: manifest_relative,
        zip_path: manifest.zip_path,
        blockers,
        warnings,
        included_files,
        skipped_files,
    })
}
