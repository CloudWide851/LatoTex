import { invoke } from "@tauri-apps/api/core";
import type {
  Ack,
  AgentModelBinding,
  AppSettings,
  BusyTexCacheInfo,
  CompileRecord,
  EventBatch,
  FileReadBinaryResponse,
  FileReadResponse,
  FsOperationInput,
  FsOperationResult,
  GitAvailability,
  GitBranchInfo,
  GitCommitInfo,
  GitDiffResponse,
  GitDownloadStart,
  GitDownloadStatus,
  GitStatus,
  LibraryCitationSummary,
  ModelCatalogItemInput,
  ModelProtocolInput,
  PanelLayoutPrefs,
  ProjectSearchHit,
  ProtocolHealth,
  ProjectSnapshot,
  ProjectSummary,
  RuntimeLogInfo,
  RuntimeLogReadResponse,
  ResourceNode,
  WorkspaceExportPdfResponse,
} from "../types/app";
import type { HealthCheckResponse } from "../types/health";

export function getHealthCheck(): Promise<HealthCheckResponse> {
  return invoke<HealthCheckResponse>("health_check");
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

export function projectSearchContent(
  projectId: string,
  query: string,
  limit = 200
): Promise<ProjectSearchHit[]> {
  return invoke<ProjectSearchHit[]>("project_search_content", {
    input: { projectId, query, limit }
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

export function libraryCitationSummary(
  projectId: string,
  relativePath: string,
): Promise<LibraryCitationSummary> {
  return invoke<LibraryCitationSummary>("library_citation_summary", {
    input: { projectId, relativePath },
  });
}

export function runAgent(input: {
  projectId: string;
  role: string;
  prompt: string;
  contextRefs: string[];
  modelOverride?: string;
}) {
  return invoke<{ runId: string; status: string; output: string }>("agent_run", { input });
}

export function getEvents(cursor?: number, limit = 200): Promise<EventBatch> {
  return invoke<EventBatch>("events_subscribe", { query: { cursor, limit } });
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
    language?: "en-US" | "zh-CN";
    skipDeleteConfirm?: boolean;
    theme?: "light" | "dark" | "system";
    busytexCachePolicy?: "install-first" | "appdata-only";
    busytexCacheDir?: string;
    panelLayout?: PanelLayoutPrefs;
  };
}): Promise<AppSettings> {
  return invoke<AppSettings>("settings_update", { input });
}

export function testProtocol(protocolId: string): Promise<ProtocolHealth> {
  return invoke<ProtocolHealth>("protocol_test", { input: { protocolId } });
}

export function runtimeLogWrite(level: string, message: string) {
  return invoke("runtime_log_write", { input: { level, message } });
}

export function runtimeLogInfo(): Promise<RuntimeLogInfo> {
  return invoke<RuntimeLogInfo>("runtime_log_info");
}

export function runtimeLogRead(limit = 500): Promise<RuntimeLogReadResponse> {
  return invoke<RuntimeLogReadResponse>("runtime_log_read", { input: { limit } });
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
  contextLines = 3
): Promise<GitDiffResponse> {
  return invoke<GitDiffResponse>("git_diff_file", {
    input: { projectId, path, staged, contextLines }
  });
}

export function busytexCachePrepare(policy: "install-first" | "appdata-only"): Promise<BusyTexCacheInfo> {
  return invoke<BusyTexCacheInfo>("busytex_cache_prepare", { input: { policy } });
}
