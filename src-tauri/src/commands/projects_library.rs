use crate::models::{
    Ack, FsOperationInput, FsOperationResult, LibraryCitationIndexStatus,
    LibraryCitationResolveInput, LibraryCitationResolveResponse, LibraryCitationSummaryInput,
    LibraryCitationSummaryResponse, LibraryLinkImportInput, LibraryLinkImportResponse,
    LibraryPdfPreviewInput, LibraryPdfPreviewResponse, LibraryPdfResumeResponse, LibraryRefInput,
    LibraryZoteroSyncInput, LibraryZoteroSyncResponse, ProjectRefInput,
};
use crate::state::AppState;
use crate::storage;
use rfd::FileDialog;
use tauri::{async_runtime::spawn_blocking, State};

#[tauri::command]
pub async fn library_rescan(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Ack, String> {
    state.log("INFO", &format!("library_rescan: {}", input.project_id));
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::rescan_library(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_import_pdf(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<Option<crate::models::LibraryPdfImportResponse>, String> {
    state.log("INFO", &format!("library_import_pdf: {}", input.project_id));
    let selected = FileDialog::new().add_filter("PDF", &["pdf"]).pick_file();
    match selected {
        Some(path) => {
            let db_path = state.db_path.clone();
            let project_id = input.project_id;
            spawn_blocking(move || storage::import_library_pdf(&db_path, &project_id, &path))
                .await
                .map_err(|e| e.to_string())?
                .map(Some)
        }
        None => Ok(None),
    }
}

#[tauri::command]
pub async fn library_import_link(
    state: State<'_, AppState>,
    input: LibraryLinkImportInput,
) -> Result<LibraryLinkImportResponse, String> {
    state.log(
        "INFO",
        &format!("library_import_link: {}", input.project_id),
    );
    let app_state = state.inner().clone();
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let queue_project_id = project_id.clone();
    let link = input.link.trim().to_string();
    let scope = input.scope.clone();
    let owner_id = input.owner_id.clone();
    let api_key = input.api_key.clone();
    let mut result = spawn_blocking(move || {
        storage::import_library_link(
            &db_path,
            &project_id,
            &link,
            scope.as_deref(),
            owner_id.as_deref(),
            api_key.as_deref(),
        )
    })
    .await
    .map_err(|e| e.to_string())??;
    result.pdf_preview =
        storage::queue_library_pdf_download(&app_state, &queue_project_id, &result.relative_path)?;
    Ok(result)
}

#[tauri::command]
pub async fn library_resume_pdf_downloads(
    state: State<'_, AppState>,
    input: LibraryRefInput,
) -> Result<LibraryPdfResumeResponse, String> {
    state.log(
        "INFO",
        &format!("library_resume_pdf_downloads: {}", input.project_id),
    );
    let project_id = input.project_id;
    let app_state = state.inner().clone();
    spawn_blocking(move || storage::resume_library_pdf_downloads(&app_state, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub fn library_zotero_sync(
    state: State<'_, AppState>,
    input: LibraryZoteroSyncInput,
) -> Result<LibraryZoteroSyncResponse, String> {
    let scope = input.scope.as_deref().unwrap_or("users").trim().to_string();
    state.log(
        "INFO",
        &format!(
            "library_zotero_sync: project={}, scope={}, owner={}",
            input.project_id, scope, input.owner_id
        ),
    );
    storage::sync_zotero_library(
        &state.db_path,
        &input.project_id,
        Some(&scope),
        input.owner_id.trim(),
        input.api_key.trim(),
    )
}

#[tauri::command]
pub fn library_citation_summary(
    state: State<'_, AppState>,
    input: LibraryCitationSummaryInput,
) -> Result<LibraryCitationSummaryResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_summary: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    storage::library_citation_summary(&state.db_path, &input.project_id, &input.relative_path)
}

#[tauri::command]
pub async fn library_citation_summary_remote(
    state: State<'_, AppState>,
    input: LibraryCitationSummaryInput,
) -> Result<LibraryCitationSummaryResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_summary_remote: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    spawn_blocking(move || {
        storage::library_citation_summary_remote(&db_path, &project_id, &relative_path)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_resolve_pdf_preview(
    state: State<'_, AppState>,
    input: LibraryPdfPreviewInput,
) -> Result<LibraryPdfPreviewResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_resolve_pdf_preview: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    let app_state = state.inner().clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let bust_cache = input.bust_cache.unwrap_or(false);
    spawn_blocking(move || {
        storage::library_resolve_pdf_preview_runtime(
            &app_state,
            &project_id,
            &relative_path,
            bust_cache,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_citation_resolve(
    state: State<'_, AppState>,
    input: LibraryCitationResolveInput,
) -> Result<LibraryCitationResolveResponse, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_resolve: project={}, path={}, query={}",
            input.project_id,
            input.relative_path.as_deref().unwrap_or("-"),
            input.query.as_deref().unwrap_or("-")
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    let relative_path = input.relative_path;
    let query = input.query;
    let include_remote = input.include_remote.unwrap_or(false);
    spawn_blocking(move || {
        storage::library_citation_resolve(
            &db_path,
            &project_id,
            relative_path.as_deref(),
            query.as_deref(),
            include_remote,
        )
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_citation_index_status(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<LibraryCitationIndexStatus, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_index_status: project={}",
            input.project_id
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::library_citation_index_status(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn library_citation_index_rebuild(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<LibraryCitationIndexStatus, String> {
    state.log(
        "INFO",
        &format!(
            "library_citation_index_rebuild: project={}",
            input.project_id
        ),
    );
    let db_path = state.db_path.clone();
    let project_id = input.project_id;
    spawn_blocking(move || storage::library_citation_index_rebuild(&db_path, &project_id))
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn fs_operation(
    state: State<'_, AppState>,
    input: FsOperationInput,
) -> Result<FsOperationResult, String> {
    state.log(
        "INFO",
        &format!(
            "fs_operation: action={}, scope={}, path={}, project={}",
            input.action, input.scope, input.path, input.project_id
        ),
    );
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::fs_operation(&db_path, input))
        .await
        .map_err(|e| e.to_string())?
}
