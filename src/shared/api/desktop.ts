import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  CompileRecord,
  EventBatch,
  FileReadResponse,
  ProjectSnapshot,
  ProjectSummary,
  ProviderHealth,
  ResourceNode
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

export function openProject(projectId: string): Promise<ProjectSnapshot> {
  return invoke<ProjectSnapshot>("project_open", { input: { projectId } });
}

export function getWorkspaceTree(projectId: string): Promise<ResourceNode[]> {
  return invoke<ResourceNode[]>("workspace_tree", { input: { projectId } });
}

export function readFile(projectId: string, relativePath: string): Promise<FileReadResponse> {
  return invoke<FileReadResponse>("file_read", { input: { projectId, relativePath } });
}

export function writeFile(projectId: string, relativePath: string, content: string) {
  return invoke("file_write", { input: { projectId, relativePath, content } });
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
  providers: Array<{ provider: string; baseUrl: string; apiKey?: string }>;
  agentBindings: Array<{ role: string; provider: string; model: string }>;
}): Promise<AppSettings> {
  return invoke<AppSettings>("settings_update", { input });
}

export function testProvider(provider: string): Promise<ProviderHealth> {
  return invoke<ProviderHealth>("provider_test", { input: { provider } });
}
