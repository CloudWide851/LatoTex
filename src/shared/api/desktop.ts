import { invoke } from "@tauri-apps/api/core";
import type {
  Ack,
  AnalysisAssetInput,
  AnalysisExportArtifactResponse,
  AnalysisListReportsResponse,
  AnalysisSaveReportResponse,
  AgentExecuteStartAccepted,
  AgentTeamMode,
  AgentModelBinding,
  AppBackgroundImage,
  AppBackgroundImagePayload,
  AppSettings,
  AnalysisPyodideCacheInfo,
  DrawioCacheInfo,
  BusyTexCacheInfo,
  BusyTexInstallPackageResult,
  ChannelPrefs,
  CompileRecord,
  CredentialSaveResult,
  EventBatch,
  FileReadBinaryResponse,
  FileReadResponse,
  FsOperationInput,
  FsOperationResult,
  GitAvailability,
  GitBranchInfo,
  GitCommitFileEntry,
  GitCommitInfo,
  GitDiffResponse,
  GitDownloadStart,
  GitDownloadStatus,
  GitStatus,
  LibraryCitationSummary,
  LibraryPdfPreview,
  LibraryTranslateResult,
  LibraryTranslateStartResult,
  LibraryTranslateStatus,
  LibraryZoteroSyncResult,
  ModelCatalogItemInput,
  ModelDraftTestInput,
  ModelApiKeyValue,
  ModelTestResult,
  ModelProtocolInput,
  PanelLayoutPrefs,
  ProjectDeleteResponse,
  ProjectIntegrityStatus,
  ProjectSearchHit,
  ReferenceCheckResponse,
  ProtocolTestInput,
  ProtocolHealth,
  ProjectSnapshot,
  ProjectSummary,
  RuntimeLogInfo,
  RuntimeLogSessionListResponse,
  RuntimeMemorySnapshot,
  RuntimeLogReadFilters,
  RuntimeLogReadResponse,
  ResourceNode,
  ShareSessionInfo,
  TelegramPollInput,
  TelegramPollResult,
  WorkspaceExportPdfResponse,
} from "../types/app";
import type { HealthCheckResponse } from "../types/health";

export function getHealthCheck(): Promise<HealthCheckResponse> {
  return invoke<HealthCheckResponse>("health_check");
}

export function windowSyncIcon(): Promise<Ack> {
  return invoke<Ack>("window_sync_icon");
}

export function listProjects(): Promise<ProjectSummary[]> {
  return invoke<ProjectSummary[]>("project_list");
}

export function createProject(name: string): Promise<ProjectSnapshot> {
  return invoke<ProjectSnapshot>("project_create", { input: { name } });
}

export function initProjectFromFolder(): Promise<ProjectSnapshot | null> {
  return invoke<ProjectSnapshot | null>("project_init_from_folder");
}

export function openProject(projectId: string): Promise<ProjectSnapshot> {
  return invoke<ProjectSnapshot>("project_open", { input: { projectId } });
}

export function deleteProject(
  projectId: string,
  mode: "unregister" | "trashRoot",
): Promise<ProjectDeleteResponse> {
  return invoke<ProjectDeleteResponse>("project_delete", { input: { projectId, mode } });
}

export function projectIntegrityStatus(projectId: string): Promise<ProjectIntegrityStatus> {
  return invoke<ProjectIntegrityStatus>("project_integrity_status", { input: { projectId } });
}

export function projectIntegrityRepair(projectId: string): Promise<ProjectIntegrityStatus> {
  return invoke<ProjectIntegrityStatus>("project_integrity_repair", { input: { projectId } });
}

export function projectSearchContent(
  projectId: string,
  query: string,
  limit = 200
): Promise<ProjectSearchHit[]> {
  return invoke<ProjectSearchHit[]>("project_search_content", {
    input: { projectId, query, limit }
  });
}

export function referenceCheck(
  queries: string[],
  limit = 5,
): Promise<ReferenceCheckResponse> {
  return invoke<ReferenceCheckResponse>("reference_check", {
    input: { queries, limit },
  });
}

export function analysisSaveReport(input: {
  projectId: string;
  runId?: string;
  title?: string;
  reportHtml: string;
  assets?: AnalysisAssetInput[];
}): Promise<AnalysisSaveReportResponse> {
  return invoke<AnalysisSaveReportResponse>("analysis_save_report", {
    input: {
      projectId: input.projectId,
      runId: input.runId,
      title: input.title,
      reportHtml: input.reportHtml,
      assets: input.assets ?? [],
    },
  });
}

export function analysisListReports(projectId: string): Promise<AnalysisListReportsResponse> {
  return invoke<AnalysisListReportsResponse>("analysis_list_reports", {
    input: { projectId },
  });
}

export function analysisExportArtifact(
  projectId: string,
  relativePath: string,
  defaultFileName?: string,
): Promise<AnalysisExportArtifactResponse | null> {
  return invoke<AnalysisExportArtifactResponse | null>("analysis_export_artifact", {
    input: { projectId, relativePath, defaultFileName },
  });
}

export function getWorkspaceTree(projectId: string): Promise<ResourceNode[]> {
  return invoke<ResourceNode[]>("workspace_tree", { input: { projectId } });
}

export function workspaceRevealInSystem(projectId: string, relativePath?: string) {
  return invoke("workspace_reveal_in_system", {
    input: { projectId, relativePath }
  });
}

export function workspaceOpenTerminal(projectId: string, relativePath?: string) {
  return invoke("workspace_open_terminal", {
    input: { projectId, relativePath }
  });
}

export function shareSessionCreate(
  projectId: string,
  targetPath: string,
  mode: "local" | "remote" = "remote",
  sessionName?: string,
): Promise<ShareSessionInfo> {
  return invoke<ShareSessionInfo>("share_session_create", {
    input: { projectId, targetPath, mode, sessionName },
  });
}

export function shareSessionStatus(): Promise<ShareSessionInfo> {
  return invoke<ShareSessionInfo>("share_session_status");
}

export function shareSessionStop(): Promise<Ack> {
  return invoke<Ack>("share_session_stop");
}

export function channelsTelegramPoll(input: TelegramPollInput = {}): Promise<TelegramPollResult> {
  return invoke<TelegramPollResult>("channels_telegram_poll", { input });
}

export function channelsTelegramSend(input: {
  chatId?: string;
  text: string;
  replyToMessageId?: number;
}): Promise<Ack> {
  return invoke<Ack>("channels_telegram_send", { input });
}

export function openExternalLink(url: string): Promise<Ack> {
  return invoke<Ack>("open_external_link", {
    input: { url },
  });
}

export function readFile(projectId: string, relativePath: string): Promise<FileReadResponse> {
  return invoke<FileReadResponse>("file_read", { input: { projectId, relativePath } });
}

export function readFileBinary(
  projectId: string,
  relativePath: string,
): Promise<FileReadBinaryResponse> {
  return invoke<FileReadBinaryResponse>("file_read_binary", {
    input: { projectId, relativePath },
  });
}

export function writeFile(projectId: string, relativePath: string, content: string) {
  return invoke("file_write", { input: { projectId, relativePath, content } });
}

export function writeFileBinary(
  projectId: string,
  relativePath: string,
  bytes: Uint8Array | number[],
): Promise<Ack> {
  return invoke<Ack>("file_write_binary", {
    input: {
      projectId,
      relativePath,
      bytes: Array.from(bytes),
    },
  });
}

export function workspaceExportPdf(
  projectId: string,
  defaultFileName: string,
  bytes: Uint8Array | number[],
): Promise<WorkspaceExportPdfResponse | null> {
  return invoke<WorkspaceExportPdfResponse | null>("workspace_export_pdf", {
    input: {
      projectId,
      defaultFileName,
      bytes: Array.from(bytes),
    },
  });
}

export function fsOperation(input: FsOperationInput): Promise<FsOperationResult> {
  return invoke<FsOperationResult>("fs_operation", { input });
}

export function getLibraryTree(projectId: string): Promise<ResourceNode[]> {
  return invoke<ResourceNode[]>("library_tree", { input: { projectId } });
}

export function rescanLibrary(projectId: string) {
  return invoke("library_rescan", { input: { projectId } });
}

export function importLibraryPdf(projectId: string): Promise<Ack | null> {
  return invoke<Ack | null>("library_import_pdf", { input: { projectId } });
}

export function importLibraryLink(projectId: string, link: string): Promise<Ack> {
  return invoke<Ack>("library_import_link", { input: { projectId, link } });
}

export function syncLibraryZotero(input: {
  projectId: string;
  ownerId: string;
  apiKey: string;
  scope?: "users" | "groups";
}): Promise<LibraryZoteroSyncResult> {
  return invoke<LibraryZoteroSyncResult>("library_zotero_sync", {
    input: {
      projectId: input.projectId,
      ownerId: input.ownerId,
      apiKey: input.apiKey,
      scope: input.scope ?? "users",
    },
  });
}

export function translateLibraryDocument(input: {
  projectId: string;
  relativePath: string;
  targetLanguage?: string;
  modelOverride?: string;
}): Promise<LibraryTranslateResult> {
  return invoke<LibraryTranslateResult>("library_translate_document", {
    input: {
      projectId: input.projectId,
      relativePath: input.relativePath,
      targetLanguage: input.targetLanguage,
      modelOverride: input.modelOverride,
    },
  });
}


export function translateLibraryDocumentStart(input: {
  projectId: string;
  relativePath: string;
  targetLanguage?: string;
  modelOverride?: string;
}): Promise<LibraryTranslateStartResult> {
  return invoke<LibraryTranslateStartResult>("library_translate_start", {
    input: {
      projectId: input.projectId,
      relativePath: input.relativePath,
      targetLanguage: input.targetLanguage,
      modelOverride: input.modelOverride,
    },
  });
}

export function translateLibraryDocumentStatus(taskId: string): Promise<LibraryTranslateStatus> {
  return invoke<LibraryTranslateStatus>("library_translate_status", {
    input: { taskId },
  });
}

export function libraryCitationSummary(
  projectId: string,
  relativePath: string,
): Promise<LibraryCitationSummary> {
  return invoke<LibraryCitationSummary>("library_citation_summary", {
    input: { projectId, relativePath },
  });
}

export function libraryResolvePdfPreview(
  projectId: string,
  relativePath: string,
): Promise<LibraryPdfPreview> {
  return invoke<LibraryPdfPreview>("library_resolve_pdf_preview", {
    input: { projectId, relativePath },
  });
}

export function executeWorkflowStart(input: {
  projectId: string;
  workflowId: string;
  callsite: string;
  prompt: string;
  contextRefs: string[];
  modelOverride?: string;
  bypassCache?: boolean;
  teamMode?: AgentTeamMode;
  harnessProfileId?: string;
}): Promise<AgentExecuteStartAccepted> {
  return invoke<AgentExecuteStartAccepted>("agent_execute_start", {
    input: {
      projectId: input.projectId,
      workflowId: input.workflowId,
      callsite: input.callsite,
      prompt: input.prompt,
      contextRefs: input.contextRefs,
      modelOverride: input.modelOverride,
      bypassCache: input.bypassCache ?? false,
      teamMode: input.teamMode ?? "auto",
      harnessProfileId: input.harnessProfileId,
    },
  });
}

export function executeWorkflowCancel(runId: string) {
  return invoke<Ack>("agent_execute_cancel", { input: { runId } });
}
export function getEvents(
  cursor?: number,
  limit = 200,
  runId?: string,
  waitMs?: number,
  excludeKinds?: string[],
): Promise<EventBatch> {
  return invoke<EventBatch>("events_subscribe", { query: { cursor, limit, runId, waitMs, excludeKinds } });
}

export function setTrayLabels(showLabel: string, exitLabel: string, tooltip: string) {
  return invoke<Ack>("tray_set_labels", {
    input: {
      showLabel,
      exitLabel,
      tooltip,
    },
  });
}

export function recordCompile(input: {
  projectId: string;
  mainFile: string;
  status: string;
  diagnostics: string[];
  durationMs: number;
}): Promise<CompileRecord> {
  return invoke<CompileRecord>("latex_compile_record", { input });
}

export function getSettings(): Promise<AppSettings> {
  return invoke<AppSettings>("settings_get");
}

export function updateSettings(input: {
  activeProjectId: string | null;
  modelProtocols: ModelProtocolInput[];
  modelCatalog: ModelCatalogItemInput[];
  agentBindings: AgentModelBinding[];
  uiPrefs?: {
    language?: "en-US" | "zh-CN" | "es-ES" | "ja-JP";
    skipDeleteConfirm?: boolean;
    closeToTrayNoticeEnabled?: boolean;
    theme?: "light" | "dark" | "system";
    busytexCachePolicy?: "install-first" | "appdata-only";
    busytexCacheDir?: string;
    previewDefaultZoom?: number;
    panelLayout?: PanelLayoutPrefs;
    featureModelBindings?: {
      latexAgentModelId?: string;
      analysisAgentModelId?: string;
      translationModelId?: string;
      completionModelId?: string;
    };
    channels?: ChannelPrefs;
    closeBehavior?: "ask" | "tray" | "exit";
    closeBehaviorRemember?: boolean;
    backgroundImagePath?: string;
    backgroundImagePaths?: string[];
    backgroundBlurPx?: number;
  };
}): Promise<AppSettings> {
  return invoke<AppSettings>("settings_update", { input });
}

export function pickBackgroundImage(): Promise<AppBackgroundImage | null> {
  return invoke<AppBackgroundImage | null>("settings_pick_background_image");
}

export function readBackgroundImage(path: string): Promise<AppBackgroundImagePayload | null> {
  return invoke<AppBackgroundImagePayload | null>("settings_read_background_image", {
    input: { path },
  });
}
export function removeBackgroundImage(path: string): Promise<Ack> {
  return invoke<Ack>("settings_remove_background_image", {
    input: { path },
  });
}


export function testProtocol(input: ProtocolTestInput): Promise<ProtocolHealth> {
  return invoke<ProtocolHealth>("protocol_test", {
    input: {
      protocolId: input.protocolId,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
    },
  });
}

export function testModel(modelId: string): Promise<ModelTestResult> {
  return invoke<ModelTestResult>("model_test", { input: { modelId } });
}

export function testModelDraft(input: ModelDraftTestInput): Promise<ModelTestResult> {
  return invoke<ModelTestResult>("model_test_draft", {
    input: {
      protocolId: input.protocolId,
      baseUrl: input.baseUrl,
      requestName: input.requestName,
      apiKey: input.apiKey,
    },
  });
}

export function setModelApiKey(modelId: string, apiKey: string): Promise<Ack> {
  return invoke<Ack>("model_api_key_set", {
    input: { modelId, apiKey },
  });
}

export function getModelApiKey(modelId: string): Promise<ModelApiKeyValue> {
  return invoke<ModelApiKeyValue>("model_api_key_get", {
    input: { modelId },
  });
}

export function saveModelApiKeyVerified(input: {
  modelId: string;
  apiKey: string;
}): Promise<CredentialSaveResult> {
  return invoke<CredentialSaveResult>("model_api_key_save_verified", {
    input: {
      modelId: input.modelId,
      apiKey: input.apiKey,
    },
  });
}

export function runtimeLogWrite(level: string, message: string) {
  return invoke("runtime_log_write", { input: { level, message } });
}

export function runtimeLogInfo(): Promise<RuntimeLogInfo> {
  return invoke<RuntimeLogInfo>("runtime_log_info");
}

export function runtimeLogListSessions(): Promise<RuntimeLogSessionListResponse> {
  return invoke<RuntimeLogSessionListResponse>("runtime_log_list_sessions");
}

export function runtimeMemorySnapshot(): Promise<RuntimeMemorySnapshot> {
  return invoke<RuntimeMemorySnapshot>("runtime_memory_snapshot");
}

export function runtimeLogRead(filters: RuntimeLogReadFilters = {}): Promise<RuntimeLogReadResponse> {
  return invoke<RuntimeLogReadResponse>("runtime_log_read", { input: filters });
}

export function runtimeLogClearCurrentSession(confirmToken = "CLEAR_CURRENT_SESSION"): Promise<Ack> {
  return invoke<Ack>("runtime_log_clear_current_session", {
    input: { confirmToken },
  });
}

export function gitStatus(projectId: string): Promise<GitStatus> {
  return invoke<GitStatus>("git_status", { input: { projectId } });
}

export function gitCheckInstalled(): Promise<GitAvailability> {
  return invoke<GitAvailability>("git_check_installed");
}

export function gitInitRepo(projectId: string) {
  return invoke("git_init_repo", { input: { projectId } });
}

export function gitDownloadInstallerStart(): Promise<GitDownloadStart> {
  return invoke<GitDownloadStart>("git_download_installer_start");
}

export function gitDownloadStatus(taskId: string): Promise<GitDownloadStatus> {
  return invoke<GitDownloadStatus>("git_download_status", { input: { taskId } });
}

export function gitDownloadCancel(taskId: string) {
  return invoke("git_download_cancel", { input: { taskId } });
}

export function gitRunInstaller(taskId: string) {
  return invoke("git_run_installer", { input: { taskId } });
}

export function gitBranches(projectId: string): Promise<GitBranchInfo[]> {
  return invoke<GitBranchInfo[]>("git_branches", { input: { projectId } });
}

export function gitLog(projectId: string, limit = 50): Promise<GitCommitInfo[]> {
  return invoke<GitCommitInfo[]>("git_log", { input: { projectId, limit } });
}

export function gitCommitFiles(projectId: string, revision: string): Promise<GitCommitFileEntry[]> {
  return invoke<GitCommitFileEntry[]>("git_commit_files", { input: { projectId, revision } });
}

export function gitStage(projectId: string, paths: string[]) {
  return invoke("git_stage", { input: { projectId, paths } });
}

export function gitUnstage(projectId: string, paths: string[]) {
  return invoke("git_unstage", { input: { projectId, paths } });
}

export function gitCommit(projectId: string, message: string) {
  return invoke("git_commit", { input: { projectId, message } });
}

export function gitCheckout(projectId: string, branch: string, create = false) {
  return invoke("git_checkout", { input: { projectId, branch, create } });
}

export function gitFetch(projectId: string, remote?: string) {
  return invoke("git_fetch", { input: { projectId, remote } });
}

export function gitPull(projectId: string, remote?: string, branch?: string) {
  return invoke("git_pull", { input: { projectId, remote, branch } });
}

export function gitPush(projectId: string, remote?: string, branch?: string) {
  return invoke("git_push", { input: { projectId, remote, branch } });
}

export function gitDiffFile(
  projectId: string,
  path: string,
  staged = false,
  contextLines = 3,
  revision?: string
): Promise<GitDiffResponse> {
  return invoke<GitDiffResponse>("git_diff_file", {
    input: { projectId, path, staged, contextLines, revision }
  });
}

export function busytexCachePrepare(policy: "install-first" | "appdata-only"): Promise<BusyTexCacheInfo> {
  return invoke<BusyTexCacheInfo>("busytex_cache_prepare", { input: { policy } });
}

export function busytexInstallMissingPackage(input: {
  styleFile: string;
  policy?: "install-first" | "appdata-only";
}): Promise<BusyTexInstallPackageResult> {
  return invoke<BusyTexInstallPackageResult>("busytex_install_missing_package", { input });
}

export function analysisPyodidePrepare(policy: "install-first" | "appdata-only"): Promise<AnalysisPyodideCacheInfo> {
  return invoke<AnalysisPyodideCacheInfo>("analysis_pyodide_prepare", { input: { policy } });
}

export function drawioCachePrepare(policy: "install-first" | "appdata-only"): Promise<DrawioCacheInfo> {
  return invoke<DrawioCacheInfo>("drawio_cache_prepare", { input: { policy } });
}






