#[path = "submission_pack_collect.rs"]
mod submission_pack_collect;
#[path = "submission_pack_core.rs"]
mod submission_pack_core;
#[cfg(test)]
#[path = "submission_pack_tests.rs"]
mod submission_pack_tests;

use crate::models::{SubmissionPackBuildInput, SubmissionPackBuildResponse};
use crate::state::AppState;
use tauri::{async_runtime::spawn_blocking, State};

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
