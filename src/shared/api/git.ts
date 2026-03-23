import type {
  GitAvailability,
  GitBranchInfo,
  GitCommitFileEntry,
  GitCommitInfo,
  GitDiffResponse,
  GitDownloadStart,
  GitDownloadStatus,
  GitStatus,
} from "../types/app";
import { invokeCommand } from "./core";

export function gitStatus(projectId: string): Promise<GitStatus> {
  return invokeCommand<GitStatus>("git_status", { input: { projectId } });
}

export function gitCheckInstalled(): Promise<GitAvailability> {
  return invokeCommand<GitAvailability>("git_check_installed");
}

export function gitInitRepo(projectId: string) {
  return invokeCommand("git_init_repo", { input: { projectId } });
}

export function gitDownloadInstallerStart(): Promise<GitDownloadStart> {
  return invokeCommand<GitDownloadStart>("git_download_installer_start");
}

export function gitDownloadStatus(taskId: string): Promise<GitDownloadStatus> {
  return invokeCommand<GitDownloadStatus>("git_download_status", { input: { taskId } });
}

export function gitDownloadCancel(taskId: string) {
  return invokeCommand("git_download_cancel", { input: { taskId } });
}

export function gitRunInstaller(taskId: string) {
  return invokeCommand("git_run_installer", { input: { taskId } });
}

export function gitBranches(projectId: string): Promise<GitBranchInfo[]> {
  return invokeCommand<GitBranchInfo[]>("git_branches", { input: { projectId } });
}

export function gitLog(projectId: string, limit = 50): Promise<GitCommitInfo[]> {
  return invokeCommand<GitCommitInfo[]>("git_log", { input: { projectId, limit } });
}

export function gitCommitFiles(projectId: string, revision: string): Promise<GitCommitFileEntry[]> {
  return invokeCommand<GitCommitFileEntry[]>("git_commit_files", { input: { projectId, revision } });
}

export function gitStage(projectId: string, paths: string[]) {
  return invokeCommand("git_stage", { input: { projectId, paths } });
}

export function gitUnstage(projectId: string, paths: string[]) {
  return invokeCommand("git_unstage", { input: { projectId, paths } });
}

export function gitCommit(projectId: string, message: string) {
  return invokeCommand("git_commit", { input: { projectId, message } });
}

export function gitCheckout(projectId: string, branch: string, create = false) {
  return invokeCommand("git_checkout", { input: { projectId, branch, create } });
}

export function gitFetch(projectId: string, remote?: string) {
  return invokeCommand("git_fetch", { input: { projectId, remote } });
}

export function gitPull(projectId: string, remote?: string, branch?: string) {
  return invokeCommand("git_pull", { input: { projectId, remote, branch } });
}

export function gitPush(projectId: string, remote?: string, branch?: string) {
  return invokeCommand("git_push", { input: { projectId, remote, branch } });
}

export function gitDiffFile(
  projectId: string,
  path: string,
  staged = false,
  contextLines = 3,
  revision?: string,
): Promise<GitDiffResponse> {
  return invokeCommand<GitDiffResponse>("git_diff_file", {
    input: { projectId, path, staged, contextLines, revision },
  });
}
