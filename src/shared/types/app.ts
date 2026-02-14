export type WorkspacePage = "latex" | "analysis" | "library" | "settings";

export type ProjectSummary = {
  id: string;
  name: string;
  rootPath: string;
  updatedAt: string;
};

export type ResourceNode = {
  name: string;
  relativePath: string;
  kind: "file" | "directory";
  children: ResourceNode[];
};

export type ProjectSnapshot = {
  summary: ProjectSummary;
  tree: ResourceNode[];
  mainFile: string;
};

export type FileReadResponse = {
  relativePath: string;
  content: string;
};

export type SwarmEvent = {
  seq: number;
  id: string;
  runId: string;
  projectId: string;
  role: string;
  kind: string;
  payload: Record<string, unknown>;
  createdAt: string;
};

export type EventBatch = {
  nextCursor: number;
  events: SwarmEvent[];
};

export type AgentModelBinding = {
  role: string;
  provider: string;
  model: string;
};

export type ProviderConfig = {
  provider: string;
  baseUrl: string;
  apiKeySet: boolean;
};

export type AppSettings = {
  activeProjectId: string | null;
  providers: ProviderConfig[];
  agentBindings: AgentModelBinding[];
  uiPrefs?: {
    language?: "en-US" | "zh-CN";
  };
};

export type ProviderHealth = {
  provider: string;
  ok: boolean;
  message: string;
};

export type RuntimeLogInfo = {
  sessionLogFile: string;
  logsDir: string;
  installMode: string;
  version: string;
};

export type CompileRecord = {
  id: string;
  projectId: string;
  mainFile: string;
  status: string;
  diagnostics: string[];
  durationMs: number;
  createdAt: string;
};
