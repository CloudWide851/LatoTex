import type {
  ProjectIntegrityStatus,
  ProjectSearchHit,
  ProjectSearchScope,
  ProjectSnapshot,
  ProjectSummary,
} from "../types/app";
import { invokeCommand } from "./core";

export function listProjects(): Promise<ProjectSummary[]> {
  return invokeCommand<ProjectSummary[]>("project_list");
}

export function createProject(name: string): Promise<ProjectSnapshot> {
  return invokeCommand<ProjectSnapshot>("project_create", { input: { name } });
}

export function initProjectFromFolder(): Promise<ProjectSnapshot | null> {
  return invokeCommand<ProjectSnapshot | null>("project_init_from_folder");
}

export function openProject(projectId: string): Promise<ProjectSnapshot> {
  return invokeCommand<ProjectSnapshot>("project_open", { input: { projectId } });
}

export function projectIntegrityStatus(projectId: string): Promise<ProjectIntegrityStatus> {
  return invokeCommand<ProjectIntegrityStatus>("project_integrity_status", {
    input: { projectId },
  });
}

export function projectIntegrityRepair(projectId: string): Promise<ProjectIntegrityStatus> {
  return invokeCommand<ProjectIntegrityStatus>("project_integrity_repair", {
    input: { projectId },
  });
}

export function projectSearchContent(
  projectId: string,
  query: string,
  limit = 200,
  scopes?: ProjectSearchScope[],
): Promise<ProjectSearchHit[]> {
  return invokeCommand<ProjectSearchHit[]>("project_search_content", {
    input: { projectId, query, limit, scopes },
  });
}

export function projectPrepareSearchIndex(projectId: string): Promise<{ ok: boolean; message: string }> {
  return invokeCommand<{ ok: boolean; message: string }>("project_prepare_search_index", {
    input: { projectId },
  });
}
