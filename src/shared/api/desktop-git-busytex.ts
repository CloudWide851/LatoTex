import { invoke } from "@tauri-apps/api/core";
import type {
  AnalysisPyodideCacheInfo,
  BusyTexCacheInfo,
  BusyTexInstallPackageResult,
  DrawioCacheInfo,
  GitAvailability,
  GitBranchInfo,
  GitCommitFileEntry,
  GitCommitInfo,
  GitDiffResponse,
  GitDownloadStart,
  GitDownloadStatus,
  GitStatus,
} from "../types/app";

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
  cacheOnly?: boolean;
}): Promise<BusyTexInstallPackageResult> {
  return invoke<BusyTexInstallPackageResult>("busytex_install_missing_package", { input });
}

export function analysisPyodidePrepare(policy: "install-first" | "appdata-only"): Promise<AnalysisPyodideCacheInfo> {
  return invoke<AnalysisPyodideCacheInfo>("analysis_pyodide_prepare", { input: { policy } });
}

export function drawioCachePrepare(policy: "install-first" | "appdata-only"): Promise<DrawioCacheInfo> {
  return invoke<DrawioCacheInfo>("drawio_cache_prepare", { input: { policy } });
}






