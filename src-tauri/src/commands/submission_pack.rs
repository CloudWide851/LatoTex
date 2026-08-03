#[path = "submission_pack_collect.rs"]
mod submission_pack_collect;
#[path = "submission_pack_core.rs"]
mod submission_pack_core;
#[path = "submission_pack_profiles.rs"]
mod submission_pack_profiles;
#[cfg(test)]
#[path = "submission_pack_tests.rs"]
mod submission_pack_tests;

use crate::models::{SubmissionPackBuildInput, SubmissionPackBuildResponse};
use crate::state::AppState;
use tauri::{async_runtime::spawn_blocking, State};

pub(crate) fn preview_submission_pack(
    db_path: &std::path::Path,
    project_id: &str,
    main_path: &str,
    profile_id: &str,
) -> Result<serde_json::Value, String> {
    let project_root = crate::storage::load_project_root(db_path, project_id)?;
    let profile = submission_pack_profiles::parse_profile(profile_id);
    let canonical_profile = submission_pack_profiles::canonical_profile_id(profile);
    let (included_files, skipped_files, mut blockers, mut warnings) =
        submission_pack_collect::collect_pack_files(&project_root, main_path, profile);
    blockers.sort_by(|left, right| left.id.cmp(&right.id).then(left.detail.cmp(&right.detail)));
    warnings.sort_by(|left, right| left.id.cmp(&right.id).then(left.detail.cmp(&right.detail)));
    Ok(serde_json::json!({
        "status": if blockers.is_empty() { "ready" } else { "blocked" },
        "profileId": canonical_profile,
        "mainPath": main_path.replace('\\', "/"),
        "blockers": blockers,
        "warnings": warnings,
        "includedFiles": included_files,
        "skippedFiles": skipped_files,
    }))
}

#[tauri::command]
pub async fn submission_pack_build(
    state: State<'_, AppState>,
    input: SubmissionPackBuildInput,
) -> Result<SubmissionPackBuildResponse, String> {
    state.log(
        "INFO",
        &format!(
            "submission_pack_build: project={}, main={}, profile={}",
            input.project_id, input.main_path, input.profile_id
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || submission_pack_core::build_submission_pack(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}
