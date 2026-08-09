mod commands;
mod logging;
mod models;
mod native_smoke;
mod outbound_http;
mod remote_network;
mod research_agent;
mod secure;
mod single_instance;
mod smoke;
mod state;
mod storage;

use commands::agent_control::{
    agent_binding_delete, agent_binding_upsert, agent_control_catalog, agent_graph_delete,
    agent_graph_upsert, agent_profile_delete, agent_profile_upsert,
};
use commands::agent_rebuttal_workflow::latex_rebuttal_reply_start;
use commands::agent_runtime::{
    agent_runtime_detect, agent_runtime_list, agent_runtime_list_cached,
    agent_runtime_pick_executable, agent_runtime_refresh_all, agent_runtime_set_enabled,
    agent_runtime_update, agent_runtime_update_cancel,
};
use commands::agent_workflows::{
    chat_workflow_start, completion_latex_start, git_summary_workflow_start, latex_edit_start,
    latex_paper_analyze_start, latex_reference_check_start, latex_review_fix_start,
};
use commands::analysis::{
    analysis_export_artifact, analysis_list_reports, analysis_save_report, reference_check,
};
use commands::analysis_context::analysis_context_load;
use commands::channels_dingtalk::{
    channels_dingtalk_poll, channels_dingtalk_send, channels_dingtalk_test,
};
use commands::channels_email::{
    channels_email_fetch_submission, channels_email_password_save_verified, channels_email_test,
};
use commands::channels_telegram::{
    channels_telegram_poll, channels_telegram_send, channels_telegram_test,
};
use commands::channels_telegram_secure::{
    channels_telegram_token_clear, channels_telegram_token_save_verified,
};
use commands::docx::{docx_read, docx_write};
use commands::git::{
    git_branches, git_check_installed, git_checkout, git_commit, git_commit_files, git_diff_file,
    git_download_cancel, git_download_installer_start, git_download_status, git_fetch,
    git_init_repo, git_log, git_pull, git_push, git_run_installer, git_stage, git_status,
    git_unstage,
};
use commands::health::{
    app_exit, app_smoke_config, app_smoke_finish, app_smoke_progress, health_check,
    runtime_clear_volatile_cache_and_restart, tray_set_labels, window_sync_icon,
};
use commands::knowledge::{
    knowledge_archive, knowledge_embedding_job_status, knowledge_embedding_pause,
    knowledge_embedding_rebuild, knowledge_embedding_resume, knowledge_embedding_status,
    knowledge_fetch, knowledge_graph_expand, knowledge_list, knowledge_mutation_preview,
    knowledge_reindex, knowledge_search, knowledge_search_cancel, knowledge_topic_list,
    knowledge_topic_mutate, knowledge_unarchive, research_answer_validate,
};
use commands::local_resources::{handle_local_resource_request, LOCAL_RESOURCE_SCHEME};
use commands::markdown_runtime::{markdown_run_code, markdown_run_code_capabilities};
use commands::native_runtime::{
    analysis_env_pick_directory, analysis_env_prepare, analysis_env_prepare_start,
    analysis_env_prepare_status, analysis_env_status, analysis_run_python, latex_compile_native,
    latex_compile_start, latex_compile_status,
};
use commands::plugins::{
    plugin_install, plugin_installed_list, plugin_marketplace_catalog, plugin_set_enabled,
    plugin_uninstall, plugin_validate_manifest,
};
use commands::projects::{
    draw_export_asset, file_read, file_read_binary, file_write, file_write_binary, fs_operation,
    library_citation_index_rebuild, library_citation_index_status, library_citation_resolve,
    library_citation_summary, library_citation_summary_remote, library_import_link,
    library_import_pdf, library_rescan, library_resolve_pdf_preview, library_resume_pdf_downloads,
    library_tree, library_zotero_sync, open_external_link, project_create, project_delete,
    project_init_from_folder, project_integrity_repair, project_integrity_status, project_list,
    project_open, project_prepare_search_index, project_search_content,
    project_search_content_incremental, workspace_export_asset, workspace_export_pdf,
    workspace_open_terminal, workspace_reveal_in_system, workspace_tree,
};
use commands::projects_translation::{
    library_extract_paper_context, library_translate_document, library_translate_start,
    library_translate_status,
};
use commands::research_agent::{
    research_capability_registry, research_change_checkpoint_list, research_change_checkpoint_undo,
    research_chat_store_get, research_chat_store_migrate, research_chat_store_replace,
    research_claim_assess, research_claim_assessment_list, research_evidence_list,
    research_evidence_upsert, research_network_policy_get, research_network_policy_update,
    research_plan_approval_list, research_plan_approval_resolve, research_plan_approve,
    research_plan_execute, research_plan_save, research_resource_lock_list,
    research_resource_lock_release, research_run_cancel, research_run_list, research_run_pause,
    research_run_resume, research_runs_recover, research_task_create, research_ui_command_list,
    research_ui_command_resolve, research_workspace_get,
};
use commands::runtime_assets::{
    runtime_asset_install, runtime_asset_list, runtime_asset_remove, runtime_asset_verify,
};
use commands::scientific_commands::scientific_command_execute;
use commands::settings::{
    model_api_key_get, model_api_key_save_verified, model_api_key_set, model_test,
    model_test_draft, protocol_test, runtime_diagnostics_bundle_export,
    runtime_log_clear_current_session, runtime_log_info, runtime_log_list_sessions,
    runtime_log_read, runtime_log_write, runtime_memory_snapshot, runtime_system_font_probe,
    settings_get, settings_pick_background_image, settings_read_background_image,
    settings_remove_background_image, settings_update,
};
use commands::share::{
    share_session_create, share_session_owner_auth, share_session_password_reveal,
    share_session_status, share_session_stop,
};
use commands::submission_pack::submission_pack_build;
use commands::swarm::{
    agent_approval_list, agent_approval_resolve, agent_execute_cancel, agent_execute_start,
    agent_mcp_validate, agent_permission_grant_revoke, agent_permission_grants_list,
    agent_runs_recover, agent_skill_catalog, agent_skill_validate, events_subscribe,
    latex_compile_record,
};
use commands::terminal::{
    terminal_activate_research_env, terminal_cancel_start, terminal_read, terminal_resize,
    terminal_start, terminal_stop, terminal_write,
};
use commands::toolchains::{
    toolchain_install, toolchain_list, toolchain_pick_directory, toolchain_register_local,
    toolchain_remove, toolchain_verify,
};
use tauri::{
    menu::MenuBuilder,
    tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent},
    AppHandle, Manager,
};

const TRAY_MENU_SHOW_ID: &str = "tray_show_main";
const TRAY_MENU_EXIT_ID: &str = "tray_exit_app";
const TRAY_ID: &str = "latotex-tray";

fn show_main_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    if commands::agent_mcp_proxy::run_if_requested() {
        return;
    }
    smoke::write_boot_marker();
    if native_smoke::run_native_smoke_fallback_if_requested() {
        return;
    }
    let smoke_mode = smoke::enabled();
    if !smoke_mode && !single_instance::acquire_or_focus_existing() {
        return;
    }
    let mut context = tauri::generate_context!();
    if smoke_mode {
        context.config_mut().app.windows.clear();
    }
    smoke::write_progress("tauri.builder.start", "ok", None);
    tauri::Builder::default()
        .register_asynchronous_uri_scheme_protocol(
            LOCAL_RESOURCE_SCHEME,
            |ctx, request, responder| {
                let response = if let Some(state) = ctx.app_handle().try_state::<state::AppState>()
                {
                    handle_local_resource_request(&state, &request)
                } else {
                    tauri::http::Response::builder()
                        .status(tauri::http::StatusCode::INTERNAL_SERVER_ERROR)
                        .header(
                            tauri::http::header::CONTENT_TYPE,
                            "text/plain; charset=utf-8",
                        )
                        .body(b"resource.state.unavailable".to_vec())
                        .unwrap_or_else(|_| tauri::http::Response::new(Vec::new()))
                };
                responder.respond(response);
            },
        )
        .setup(move |app| {
            smoke::write_progress("tauri.setup.start", "ok", None);
            let app_state = state::AppState::bootstrap(app.handle()).map_err(|e| {
                smoke::write_progress(
                    "tauri.setup.error",
                    "error",
                    Some(serde_json::json!({ "message": e })),
                );
                std::io::Error::new(std::io::ErrorKind::Other, e)
            })?;
            app.manage(app_state);
            let tray_menu = MenuBuilder::new(app)
                .text(TRAY_MENU_SHOW_ID, "Show LatoTex")
                .separator()
                .text(TRAY_MENU_EXIT_ID, "Exit")
                .build()?;
            let mut tray_builder = TrayIconBuilder::with_id(TRAY_ID)
                .menu(&tray_menu)
                .tooltip("LatoTex")
                .show_menu_on_left_click(false);
            if let Some(icon) = app.default_window_icon() {
                tray_builder = tray_builder.icon(icon.clone());
            }
            let _ = tray_builder.build(app)?;
            smoke::write_progress("tauri.setup.done", "ok", None);
            if smoke_mode {
                native_smoke::create_smoke_main_window(app.handle());
            }
            Ok(())
        })
        .on_menu_event(|app, event| match event.id().as_ref() {
            TRAY_MENU_SHOW_ID => show_main_window(app),
            TRAY_MENU_EXIT_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|app, event| {
            if event.id().as_ref() != TRAY_ID {
                return;
            }
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                ..
            } = event
            {
                show_main_window(app);
            }
        })
        .invoke_handler(tauri::generate_handler![
            health_check,
            window_sync_icon,
            app_exit,
            app_smoke_config,
            app_smoke_finish,
            app_smoke_progress,
            tray_set_labels,
            project_list,
            project_create,
            project_delete,
            project_init_from_folder,
            project_open,
            project_integrity_status,
            project_integrity_repair,
            project_search_content,
            project_search_content_incremental,
            project_prepare_search_index,
            knowledge_archive,
            knowledge_reindex,
            knowledge_unarchive,
            knowledge_list,
            knowledge_search,
            knowledge_search_cancel,
            knowledge_fetch,
            knowledge_graph_expand,
            knowledge_topic_list,
            knowledge_topic_mutate,
            knowledge_mutation_preview,
            knowledge_embedding_status,
            knowledge_embedding_job_status,
            knowledge_embedding_rebuild,
            knowledge_embedding_pause,
            knowledge_embedding_resume,
            research_answer_validate,
            reference_check,
            analysis_save_report,
            analysis_list_reports,
            analysis_export_artifact,
            analysis_context_load,
            workspace_reveal_in_system,
            workspace_open_terminal,
            open_external_link,
            workspace_tree,
            file_read,
            file_read_binary,
            file_write,
            file_write_binary,
            docx_read,
            docx_write,
            draw_export_asset,
            workspace_export_asset,
            workspace_export_pdf,
            library_tree,
            library_rescan,
            library_import_pdf,
            library_import_link,
            library_resume_pdf_downloads,
            library_translate_document,
            library_extract_paper_context,
            library_translate_start,
            library_translate_status,
            library_zotero_sync,
            library_citation_resolve,
            library_citation_index_status,
            library_citation_index_rebuild,
            library_citation_summary,
            library_citation_summary_remote,
            library_resolve_pdf_preview,
            share_session_create,
            share_session_owner_auth,
            share_session_password_reveal,
            share_session_status,
            share_session_stop,
            submission_pack_build,
            channels_telegram_poll,
            channels_telegram_send,
            channels_telegram_test,
            channels_telegram_token_save_verified,
            channels_telegram_token_clear,
            channels_dingtalk_poll,
            channels_dingtalk_send,
            channels_dingtalk_test,
            channels_email_password_save_verified,
            channels_email_test,
            channels_email_fetch_submission,
            fs_operation,
            latex_compile_record,
            agent_execute_start,
            agent_control_catalog,
            agent_profile_upsert,
            agent_profile_delete,
            agent_runtime_list,
            agent_runtime_list_cached,
            agent_runtime_refresh_all,
            agent_runtime_detect,
            agent_runtime_pick_executable,
            agent_runtime_set_enabled,
            agent_runtime_update,
            agent_runtime_update_cancel,
            agent_binding_upsert,
            agent_binding_delete,
            agent_graph_upsert,
            agent_graph_delete,
            agent_execute_cancel,
            agent_runs_recover,
            agent_approval_list,
            agent_approval_resolve,
            agent_permission_grants_list,
            agent_permission_grant_revoke,
            agent_mcp_validate,
            agent_skill_catalog,
            agent_skill_validate,
            latex_edit_start,
            latex_review_fix_start,
            latex_reference_check_start,
            latex_paper_analyze_start,
            latex_rebuttal_reply_start,
            chat_workflow_start,
            completion_latex_start,
            git_summary_workflow_start,
            events_subscribe,
            settings_get,
            settings_update,
            settings_pick_background_image,
            settings_read_background_image,
            settings_remove_background_image,
            protocol_test,
            model_test,
            model_test_draft,
            model_api_key_set,
            model_api_key_get,
            model_api_key_save_verified,
            runtime_log_write,
            runtime_log_info,
            runtime_log_list_sessions,
            runtime_log_read,
            runtime_diagnostics_bundle_export,
            runtime_memory_snapshot,
            runtime_system_font_probe,
            runtime_log_clear_current_session,
            runtime_clear_volatile_cache_and_restart,
            git_status,
            git_check_installed,
            git_init_repo,
            git_download_installer_start,
            git_download_status,
            git_download_cancel,
            git_run_installer,
            git_branches,
            git_log,
            git_commit_files,
            git_stage,
            git_unstage,
            git_commit,
            git_checkout,
            git_diff_file,
            git_fetch,
            git_pull,
            git_push,
            latex_compile_native,
            latex_compile_start,
            latex_compile_status,
            analysis_env_pick_directory,
            analysis_env_prepare,
            analysis_env_prepare_start,
            analysis_env_prepare_status,
            analysis_env_status,
            analysis_run_python,
            terminal_start,
            terminal_cancel_start,
            terminal_activate_research_env,
            terminal_write,
            terminal_read,
            terminal_resize,
            terminal_stop,
            markdown_run_code,
            markdown_run_code_capabilities,
            scientific_command_execute,
            plugin_marketplace_catalog,
            plugin_installed_list,
            plugin_install,
            plugin_uninstall,
            plugin_set_enabled,
            plugin_validate_manifest,
            toolchain_list,
            toolchain_pick_directory,
            toolchain_register_local,
            toolchain_install,
            toolchain_verify,
            toolchain_remove,
            runtime_asset_list,
            runtime_asset_install,
            runtime_asset_verify,
            runtime_asset_remove,
            research_workspace_get,
            research_network_policy_get,
            research_network_policy_update,
            research_task_create,
            research_plan_save,
            research_plan_approve,
            research_chat_store_get,
            research_chat_store_replace,
            research_chat_store_migrate,
            research_capability_registry,
            research_change_checkpoint_list,
            research_change_checkpoint_undo,
            research_resource_lock_list,
            research_resource_lock_release,
            research_plan_execute,
            research_run_list,
            research_run_pause,
            research_run_cancel,
            research_run_resume,
            research_runs_recover,
            research_ui_command_list,
            research_ui_command_resolve,
            research_plan_approval_list,
            research_plan_approval_resolve,
            research_evidence_upsert,
            research_evidence_list,
            research_claim_assess,
            research_claim_assessment_list,
        ])
        .run(context)
        .expect("error while running tauri application");
}
