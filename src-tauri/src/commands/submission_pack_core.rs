use super::submission_pack_collect::{
    canonical_profile_id, collect_pack_files, issue, parse_profile, safe_join,
};
use crate::models::{
    SubmissionPackBuildInput, SubmissionPackBuildResponse, SubmissionPackFile, SubmissionPackIssue,
    SubmissionPackIssueInput, SubmissionPackSkippedFile,
};
use crate::storage;
use serde::Serialize;
use std::fs::{self, File};
use std::io::{Read, Write};
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

fn write_manifest(path: &Path, manifest: &SubmissionPackManifest) -> Result<(), String> {
    let payload = serde_json::to_vec_pretty(manifest).map_err(|e| e.to_string())?;
    fs::write(path, payload).map_err(|e| e.to_string())
}

fn write_zip(root: &Path, output_path: &Path, files: &[SubmissionPackFile]) -> Result<(), String> {
    let file = File::create(output_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let options = SimpleFileOptions::default().compression_method(zip::CompressionMethod::Deflated);
    let mut buffer = Vec::<u8>::new();
    for item in files {
        let source = root.join(&item.path);
        let mut input = File::open(&source).map_err(|e| e.to_string())?;
        buffer.clear();
        input.read_to_end(&mut buffer).map_err(|e| e.to_string())?;
        zip.start_file(&item.path, options)
            .map_err(|e| e.to_string())?;
        zip.write_all(&buffer).map_err(|e| e.to_string())?;
    }
    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
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
    let output_dir = safe_join(&project_root, &output_relative_dir)?;
    fs::create_dir_all(&output_dir).map_err(|e| e.to_string())?;
    let manifest_relative = format!("{output_relative_dir}/submission-manifest.json");
    let manifest_path = output_dir.join("submission-manifest.json");
    let zip_relative = format!("{output_relative_dir}/source.zip");
    let zip_path = output_dir.join("source.zip");
    let status = if blockers.is_empty() {
        "ready"
    } else {
        "blocked"
    }
    .to_string();

    if status == "ready" {
        write_zip(&project_root, &zip_path, &included_files)?;
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
    write_manifest(&manifest_path, &manifest)?;

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
