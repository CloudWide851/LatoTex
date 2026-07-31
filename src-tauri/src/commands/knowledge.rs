use crate::models::{
    EmbeddingRuntimeStatus, KnowledgeArchiveInput, KnowledgeArchiveResponse,
    KnowledgeEmbeddingJobStatus, KnowledgeFetchInput, KnowledgeFetchResponse, KnowledgeGraphInput,
    KnowledgeGraphResponse, KnowledgeItem, KnowledgeListInput, KnowledgeMutationPreview,
    KnowledgeMutationPreviewInput, KnowledgeRefInput, KnowledgeSearchCancelInput,
    KnowledgeSearchInput, KnowledgeSearchResponse, KnowledgeTopic, KnowledgeTopicListInput,
    KnowledgeTopicMutationInput, ProjectRefInput, ResearchAnswerEnvelope, ResearchAnswerValidation,
};
use crate::state::AppState;
use crate::storage;
use tauri::{async_runtime::spawn_blocking, State};

fn is_pdf(path: &str) -> bool {
    path.trim().to_ascii_lowercase().ends_with(".pdf")
}

fn queue_knowledge_embedding_background(
    db_path: std::path::PathBuf,
    runtime_root: std::path::PathBuf,
    project_id: String,
    enabled: bool,
) {
    if !enabled {
        return;
    }
    let installed = storage::load_project_root(&db_path, &project_id)
        .and_then(|project_root| storage::embedding_runtime_status(&project_root, &runtime_root))
        .map(|status| status.installed)
        .unwrap_or(false);
    if !installed {
        return;
    }
    let should_start = storage::queue_knowledge_embeddings(&db_path, &project_id)
        .map(|(_, should_start)| should_start)
        .unwrap_or(false);
    if should_start {
        let _ = std::thread::Builder::new()
            .name("knowledge-embedding-index".to_string())
            .spawn(move || {
                let _ = storage::rebuild_knowledge_embeddings(&db_path, &runtime_root, &project_id);
            });
    }
}

#[tauri::command]
pub async fn knowledge_archive(
    state: State<'_, AppState>,
    input: KnowledgeArchiveInput,
) -> Result<KnowledgeArchiveResponse, String> {
    state.log(
        "INFO",
        &format!(
            "knowledge_archive: project={}, path={}",
            input.project_id, input.relative_path
        ),
    );
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let app_data_dir = state.app_data_dir.clone();
    spawn_blocking(move || {
        let pages = if is_pdf(&input.relative_path) {
            Some(storage::extract_workspace_pdf_pages_for_knowledge(
                &db_path,
                &runtime_root,
                &app_data_dir,
                &input.project_id,
                &input.relative_path,
            )?)
        } else {
            None
        };
        let item = storage::archive_knowledge_item(
            &db_path,
            &input.project_id,
            &input.relative_path,
            pages,
        )?;
        let project_root = storage::load_project_root(&db_path, &input.project_id)?;
        let embedding = storage::embedding_runtime_status(&project_root, &runtime_root)?;
        let preferences = storage::knowledge_preference_snapshot(&db_path).unwrap_or_default();
        queue_knowledge_embedding_background(
            db_path.clone(),
            runtime_root.clone(),
            input.project_id.clone(),
            preferences.background_index_enabled,
        );
        Ok(KnowledgeArchiveResponse {
            item,
            semantic_available: embedding.available,
            semantic_reminder: !embedding.installed && preferences.semantic_model_reminder_enabled,
        })
    })
    .await
    .map_err(|_| "knowledge.archive.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_reindex(
    state: State<'_, AppState>,
    input: KnowledgeRefInput,
) -> Result<KnowledgeArchiveResponse, String> {
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    let app_data_dir = state.app_data_dir.clone();
    spawn_blocking(move || {
        let items = storage::list_knowledge_items(
            &db_path,
            &KnowledgeListInput {
                project_id: input.project_id.clone(),
                source_kind: None,
                index_state: None,
            },
        )?;
        let item = items
            .into_iter()
            .find(|item| item.item_id == input.item_id)
            .ok_or_else(|| "knowledge.item.not_found".to_string())?;
        let pages = if is_pdf(&item.relative_path) {
            Some(storage::extract_workspace_pdf_pages_for_knowledge(
                &db_path,
                &runtime_root,
                &app_data_dir,
                &input.project_id,
                &item.relative_path,
            )?)
        } else {
            None
        };
        let item = storage::archive_knowledge_item(
            &db_path,
            &input.project_id,
            &item.relative_path,
            pages,
        )?;
        let project_root = storage::load_project_root(&db_path, &input.project_id)?;
        let embedding = storage::embedding_runtime_status(&project_root, &runtime_root)?;
        let preferences = storage::knowledge_preference_snapshot(&db_path).unwrap_or_default();
        queue_knowledge_embedding_background(
            db_path.clone(),
            runtime_root.clone(),
            input.project_id.clone(),
            preferences.background_index_enabled,
        );
        Ok(KnowledgeArchiveResponse {
            item,
            semantic_available: embedding.available,
            semantic_reminder: !embedding.installed && preferences.semantic_model_reminder_enabled,
        })
    })
    .await
    .map_err(|_| "knowledge.archive.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_unarchive(
    state: State<'_, AppState>,
    input: KnowledgeRefInput,
) -> Result<crate::models::Ack, String> {
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || {
        let response =
            storage::unarchive_knowledge_item(&db_path, &input.project_id, &input.item_id)?;
        let preferences = storage::knowledge_preference_snapshot(&db_path).unwrap_or_default();
        queue_knowledge_embedding_background(
            db_path,
            runtime_root,
            input.project_id,
            preferences.background_index_enabled,
        );
        Ok(response)
    })
    .await
    .map_err(|_| "knowledge.index.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_list(
    state: State<'_, AppState>,
    input: KnowledgeListInput,
) -> Result<Vec<KnowledgeItem>, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::list_knowledge_items(&db_path, &input))
        .await
        .map_err(|_| "knowledge.index.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_search(
    state: State<'_, AppState>,
    input: KnowledgeSearchInput,
) -> Result<KnowledgeSearchResponse, String> {
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || storage::search_knowledge_scoped(&db_path, &runtime_root, &input))
        .await
        .map_err(|_| "knowledge.search.failed".to_string())?
}

#[tauri::command]
pub fn knowledge_search_cancel(
    input: KnowledgeSearchCancelInput,
) -> Result<crate::models::Ack, String> {
    storage::cancel_knowledge_search_run(&input.run_id)
}

#[tauri::command]
pub async fn knowledge_fetch(
    state: State<'_, AppState>,
    input: KnowledgeFetchInput,
) -> Result<KnowledgeFetchResponse, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::fetch_knowledge_evidence(&db_path, &input))
        .await
        .map_err(|_| "knowledge.evidence.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_graph_expand(
    state: State<'_, AppState>,
    input: KnowledgeGraphInput,
) -> Result<KnowledgeGraphResponse, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::knowledge_graph(&db_path, &input))
        .await
        .map_err(|_| "knowledge.graph.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_topic_list(
    state: State<'_, AppState>,
    input: KnowledgeTopicListInput,
) -> Result<Vec<KnowledgeTopic>, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::list_knowledge_topics(&db_path, &input))
        .await
        .map_err(|_| "knowledge.topic.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_topic_mutate(
    state: State<'_, AppState>,
    input: KnowledgeTopicMutationInput,
) -> Result<crate::models::Ack, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::mutate_knowledge_topic(&db_path, &input))
        .await
        .map_err(|_| "knowledge.topic.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_mutation_preview(
    state: State<'_, AppState>,
    input: KnowledgeMutationPreviewInput,
) -> Result<KnowledgeMutationPreview, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::preview_knowledge_mutation(&db_path, &input))
        .await
        .map_err(|_| "knowledge.approval.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_embedding_status(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<EmbeddingRuntimeStatus, String> {
    let db_path = state.db_path.clone();
    let runtime_root = state.runtime_root.clone();
    spawn_blocking(move || {
        let project_root = storage::load_project_root(&db_path, &input.project_id)?;
        storage::embedding_runtime_status(&project_root, &runtime_root)
    })
    .await
    .map_err(|_| "knowledge.index.failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_embedding_job_status(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<KnowledgeEmbeddingJobStatus, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::knowledge_embedding_job_status(&db_path, &input.project_id))
        .await
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?
}

#[tauri::command]
pub async fn knowledge_embedding_rebuild(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<KnowledgeEmbeddingJobStatus, String> {
    let queue_db_path = state.db_path.clone();
    let project_id = input.project_id;
    let queue_project_id = project_id.clone();
    let (status, should_start) = spawn_blocking(move || {
        storage::queue_knowledge_embeddings(&queue_db_path, &queue_project_id)
    })
    .await
    .map_err(|_| "knowledge.embedding.index_failed".to_string())??;
    if should_start {
        let db_path = state.db_path.clone();
        let runtime_root = state.runtime_root.clone();
        tauri::async_runtime::spawn(async move {
            let _ = spawn_blocking(move || {
                storage::rebuild_knowledge_embeddings(&db_path, &runtime_root, &project_id)
            })
            .await;
        });
    }
    Ok(status)
}

#[tauri::command]
pub async fn knowledge_embedding_resume(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<KnowledgeEmbeddingJobStatus, String> {
    knowledge_embedding_rebuild(state, input).await
}

#[tauri::command]
pub async fn knowledge_embedding_pause(
    state: State<'_, AppState>,
    input: ProjectRefInput,
) -> Result<KnowledgeEmbeddingJobStatus, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::pause_knowledge_embeddings(&db_path, &input.project_id))
        .await
        .map_err(|_| "knowledge.embedding.index_failed".to_string())?
}

#[tauri::command]
pub async fn research_answer_validate(
    state: State<'_, AppState>,
    input: ResearchAnswerEnvelope,
) -> Result<ResearchAnswerValidation, String> {
    let db_path = state.db_path.clone();
    spawn_blocking(move || storage::validate_research_answer(&db_path, &input))
        .await
        .map_err(|_| "knowledge.citation.validation_failed".to_string())?
}
