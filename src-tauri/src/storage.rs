use crate::models::{
    Ack, AgentModelBinding, AppSettings, CompileRecord, CompileRecordInput, EventBatch, EventQuery,
    FileReadBinaryResponse, FileReadResponse, FileWriteInput, FsOperationInput, FsOperationResult,
    LibraryCitationSummaryResponse, LibraryPdfPreviewResponse, ModelCatalogItem,
    ModelCatalogItemInput, ModelProtocol, ModelProtocolInput, ProjectIntegrityStatus,
    ProjectSearchHit, ProjectSearchInput, ProjectSnapshot, ProjectSummary, ResourceNode,
    SettingsUpdateInput, SwarmEvent, UiPrefs,
};
use crate::secure;
use chrono::Utc;
use rusqlite::{params, Connection, OptionalExtension};
use serde_json::{json, Value};
use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use uuid::Uuid;

include!("storage/storage_bootstrap.rs");
include!("storage/project_snapshot_tree.rs");
include!("storage/workspace_files_search.rs");
include!("storage/events_settings_models.rs");
include!("storage/agent_cache_time.rs");
include!("storage/library_import_zotero.rs");
include!("storage/library_import_preview.rs");
include!("storage/library_pdf_preview_cache.rs");
include!("storage/library_translation_engine.rs");
include!("storage/workspace_ops_compile.rs");
include!("storage/remote_metadata_fetch.rs");
