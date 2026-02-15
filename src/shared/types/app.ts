export type WorkspacePage = "latex" | "analysis" | "library" | "git" | "settings";

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
  modelId: string;
};

export type ModelProtocol = {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKeySet: boolean;
};

export type ModelCatalogItem = {
  id: string;
  protocolId: string;
  displayName: string;
  requestName: string;
};

export type ProtocolHealth = {
  protocolId: string;
  ok: boolean;
  message: string;
};

export type AppSettings = {
  activeProjectId: string | null;
  modelProtocols: ModelProtocol[];
  modelCatalog: ModelCatalogItem[];
  agentBindings: AgentModelBinding[];
  uiPrefs?: {
    language?: "en-US" | "zh-CN";
    skipDeleteConfirm?: boolean;
    panelLayout?: PanelLayoutPrefs;
  };
};

export type PanelLayoutPrefs = {
  shell?: number[];
  latex?: number[];
  analysis?: number[];
  library?: number[];
  git?: number[];
  settings?: number[];
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

export type ModelProtocolInput = {
  id: string;
  displayName: string;
  baseUrl: string;
  apiKey?: string;
};

export type ModelCatalogItemInput = {
  id: string;
  protocolId: string;
  displayName: string;
  requestName: string;
};

export type FsScope = "workspace" | "library";
export type FsAction = "create_file" | "create_folder" | "rename" | "copy" | "move" | "delete";

export type FsOperationInput = {
  projectId: string;
  scope: FsScope;
  action: FsAction;
  path: string;
  targetPath?: string;
  content?: string;
};

export type FsOperationResult = {
  ok: boolean;
  message: string;
};

export type GitStatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
};

export type GitStatus = {
  isRepo: boolean;
  branch: string;
  upstream?: string;
  ahead: number;
  behind: number;
  changes: GitStatusEntry[];
};

export type GitBranchInfo = {
  name: string;
  current: boolean;
};

export type GitCommitInfo = {
  hash: string;
  shortHash: string;
  author: string;
  date: string;
  subject: string;
};

export type GitAvailability = {
  installed: boolean;
  version?: string;
};

export type GitDownloadStart = {
  taskId: string;
  fileName: string;
  downloadUrl: string;
};

export type GitDownloadStatus = {
  taskId: string;
  status: string;
  fileName: string;
  downloadedBytes: number;
  totalBytes: number;
  speedBps: number;
  progressPercent: number;
  installerPath: string;
  error?: string;
};
