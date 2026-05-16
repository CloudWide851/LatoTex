#[path = "projects_core.rs"]
mod projects_core;
#[path = "projects_files.rs"]
mod projects_files;
#[path = "projects_library.rs"]
mod projects_library;
#[path = "projects_search.rs"]
mod projects_search;
#[path = "projects_system.rs"]
mod projects_system;

pub use projects_core::{
    file_read, project_create, project_init_from_folder, project_integrity_repair,
    project_integrity_status, project_list, project_open, workspace_tree,
};
pub use projects_files::{
    draw_export_asset, file_read_binary, file_write, file_write_binary, library_tree,
    workspace_export_asset, workspace_export_pdf,
};
pub use projects_library::{
    fs_operation, library_citation_index_rebuild, library_citation_index_status,
    library_citation_resolve, library_citation_summary, library_citation_summary_remote,
    library_import_link, library_import_pdf, library_rescan, library_resolve_pdf_preview,
    library_resume_pdf_downloads, library_zotero_sync,
};
pub use projects_search::{
    project_prepare_search_index, project_search_content, project_search_content_incremental,
    workspace_reveal_in_system,
};
pub use projects_system::{open_external_link, workspace_open_terminal};
