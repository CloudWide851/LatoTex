use crate::models::{
    Ack, AgentModelBinding, AppSettings, CompileRecord, CompileRecordInput,
    DrawExportAssetResponse, EventBatch, EventQuery, FileReadBinaryResponse, FileReadResponse,
    FileWriteInput, FsOperationInput, FsOperationResult, LibraryCitationDuplicateKey,
    LibraryCitationIndexIssue, LibraryCitationIndexStatus, LibraryCitationResolveResponse,
    LibraryCitationSummaryResponse, LibraryLinkImportResponse, LibraryPdfImportResponse,
    LibraryPdfPreviewResponse, LibraryPdfResumeResponse, ModelCatalogItem, ModelCatalogItemInput,
    ModelProtocol, ModelProtocolInput, ProjectDeleteResponse, ProjectIntegrityStatus,
    ProjectSearchBatch, ProjectSearchHit, ProjectSearchIncrementalInput, ProjectSearchInput,
    ProjectSnapshot, ProjectSummary, ProjectTemplate, ResourceNode, SettingsUpdateInput,
    SwarmEvent, UiPrefs,
};
use crate::secure;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension, TransactionBehavior};
use serde_json::{json, Value};
use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use uuid::Uuid;

include!("storage/storage_bootstrap.rs");
include!("storage/project_templates.rs");
include!("storage/project_snapshot_tree.rs");
include!("storage/search_index.rs");
include!("storage/search_index_queries.rs");
include!("storage/knowledge_index.rs");
include!("storage/knowledge_search_control.rs");
include!("storage/knowledge_search_ranking.rs");
include!("storage/knowledge_search.rs");
include!("storage/knowledge_search_multi.rs");
include!("storage/knowledge_embeddings.rs");
include!("storage/knowledge_embedding_control.rs");
include!("storage/knowledge_embedding_search.rs");
include!("storage/knowledge_graph.rs");
include!("storage/knowledge_topics.rs");
include!("storage/knowledge_mutations.rs");
include!("storage/knowledge_preferences.rs");
include!("storage/workspace_fs_policy.rs");
include!("storage/workspace_files_search.rs");
include!("storage/events_settings_models.rs");
include!("storage/agent_runs.rs");
include!("storage/agent_approvals.rs");
include!("storage/agent_control_validation.rs");
include!("storage/agent_control_seed.rs");
include!("storage/agent_control.rs");
include!("storage/agent_control_delete.rs");
include!("storage/agent_runtime.rs");
include!("storage/agent_cache_time.rs");
include!("storage/research_store.rs");
include!("storage/research_store_schema.rs");
include!("storage/research_store_operations.rs");
include!("storage/research_network_policy.rs");
include!("storage/research_resource_locks.rs");
include!("storage/research_run_leases.rs");
include!("storage/research_plan_runs.rs");
include!("storage/research_change_checkpoints.rs");
include!("storage/research_capability_audit.rs");
include!("storage/research_ui_commands.rs");
include!("storage/research_evidence.rs");
include!("storage/research_claim_validation.rs");
include!("storage/research_fulltext.rs");
include!("storage/research_review.rs");
include!("storage/research_review_workspace.rs");
include!("storage/library_remote_endpoints.rs");
include!("storage/library_import_zotero.rs");
include!("storage/library_import_preview.rs");
include!("storage/library_citation_resolver.rs");
include!("storage/library_pdf_preview_core.rs");
include!("storage/library_pdf_remote_download.rs");
include!("storage/library_pdf_preview_cache.rs");
include!("storage/library_pdf_download_queue.rs");
include!("storage/library_translation_engine.rs");
include!("storage/workspace_ops_compile.rs");
include!("storage/remote_metadata_fetch.rs");
#[cfg(test)]
include!("storage/search_index_tests.rs");
#[cfg(test)]
include!("storage/workspace_ops_compile_tests.rs");
#[cfg(test)]
include!("storage/research_store_tests.rs");
#[cfg(test)]
include!("storage/research_reliability_tests.rs");
#[cfg(test)]
include!("storage/research_evidence_review_tests.rs");
