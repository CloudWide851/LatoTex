export type WorkspacePage = "latex" | "analysis" | "library" | "git" | "settings";

export type EditorTab = {
  id: string;
  path: string;
  title: string;
  pinned: boolean;
  preview: boolean;
  lastAccessed: number;
};

export type CloseTabsAction =
  | "close"
  | "closeLeft"
  | "closeRight"
  | "closeOthers"
  | "closeAll"
  | "closeSaved";

export type UnsavedChangeItem = {
  path: string;
  tabId?: string;
};

export type PendingNavigationIntent =
  | "switchFile"
  | "switchProject"
  | "closeWindow"
  | "closeTabs";

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

export type FileReadBinaryResponse = {
  relativePath: string;
  bytes: number[];
};

export type WorkspaceExportPdfResponse = {
  savedPath: string;
  fileName: string;
};

export type ShareSessionInfo = {
  active: boolean;
  sessionId?: string | null;
  projectId?: string | null;
  targetPath?: string | null;
  mode?: "local" | "remote" | string | null;
  localUrl?: string | null;
  tunnelUrl?: string | null;
  localJoinUrl?: string | null;
  remoteJoinUrl?: string | null;
  activeJoinUrl?: string | null;
  passwordRequired?: boolean | null;
  password?: string | null;
  expiresAt?: string | null;
  status?: "starting" | "ready" | "failed" | "stopping" | string | null;
  tunnelState?: "pending" | "ready" | "failed" | string | null;
  tunnelError?: string | null;
  participants?: ShareParticipantInfo[];
};

export type ShareParticipantInfo = {
  participantId: string;
  username: string;
  lastSeenAt: string;
  lastAction?: string | null;
};

export type ShareCommentItem = {
  id: string;
  username: string;
  text: string;
  quote?: string;
  page?: number;
  start?: number;
  end?: number;
  createdAt?: string;
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

export type AgentRunStartAccepted = {
  runId: string;
  status: string;
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
  capabilities?: {
    apiMode?: string;
    reasoningMode?: string;
    autoRepair?: boolean;
  };
};

export type ProtocolHealth = {
  protocolId: string;
  ok: boolean;
  message: string;
};

export type ProtocolTestInput = {
  protocolId: string;
  baseUrl: string;
  apiKey?: string;
};

export type ModelTestResult = {
  modelId: string;
  ok: boolean;
  message: string;
};

export type ModelApiKeyValue = {
  modelId: string;
  apiKey: string;
  source: "none" | "keyring" | "fallback_db" | "hybrid" | string;
  diagnosticCode?: string | null;
};

export type CredentialSaveResult = {
  ok: boolean;
  stage: "write" | string;
  message: string;
  storageBackend: "none" | "keyring" | "fallback_db" | "hybrid" | string;
  diagnosticCode?: string | null;
  readbackSource?: string | null;
  readbackAttempts?: number | null;
};

export type ModelDraftTestInput = {
  protocolId: string;
  baseUrl: string;
  requestName: string;
  apiKey: string;
};

export type AppSettings = {
  activeProjectId: string | null;
  modelProtocols: ModelProtocol[];
  modelCatalog: ModelCatalogItem[];
  agentBindings: AgentModelBinding[];
  uiPrefs?: {
    language?: "en-US" | "zh-CN";
    skipDeleteConfirm?: boolean;
    closeToTrayNoticeEnabled?: boolean;
    theme?: "light" | "dark" | "system";
    busytexCachePolicy?: "install-first" | "appdata-only";
    busytexCacheDir?: string;
    previewDefaultZoom?: number;
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
  runtimeRoot: string;
  installMode: string;
  version: string;
};

export type RuntimeLogEntry = {
  timestamp: string;
  level: string;
  message: string;
  raw: string;
};

export type RuntimeLogReadResponse = {
  entries: RuntimeLogEntry[];
};

export type RuntimeLogReadFilters = {
  limit?: number;
  level?: string;
  keyword?: string;
  fromTime?: string;
  toTime?: string;
};

export type LibraryCitationSummary = {
  sourcePath: string;
  bibPath?: string | null;
  citationKey?: string | null;
  title?: string | null;
  authors: string[];
  publishedAt?: string | null;
  doi?: string | null;
  arxivId?: string | null;
  source?: string | null;
  urls: string[];
};

export type LibraryPdfPreview = {
  relativePath?: string | null;
  sourceUrl?: string | null;
  cached: boolean;
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

export type ReferenceEvidence = {
  title: string;
  url: string;
  snippet: string;
};

export type ReferenceCheckItem = {
  query: string;
  ok: boolean;
  message: string;
  results: ReferenceEvidence[];
};

export type ReferenceCheckResponse = {
  items: ReferenceCheckItem[];
};

export type AnalysisAssetInput = {
  fileName: string;
  dataUrl: string;
};

export type AnalysisSaveReportResponse = {
  runId: string;
  runDir: string;
  reportRelativePath: string;
  assetRelativePaths: string[];
};

export type AnalysisReportItem = {
  runId: string;
  reportRelativePath: string;
  assetRelativePaths: string[];
  updatedAtUnixMs: number;
};

export type AnalysisListReportsResponse = {
  reports: AnalysisReportItem[];
};

export type AnalysisExportArtifactResponse = {
  savedPath: string;
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
  capabilities?: {
    apiMode?: string;
    reasoningMode?: string;
    autoRepair?: boolean;
  };
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

export type ProjectSearchHit = {
  relativePath: string;
  lineNumber: number;
  snippet: string;
};

export type ProjectIntegrityStatus = {
  projectId: string;
  missingRequired: string[];
};

export type GitStatusEntry = {
  path: string;
  indexStatus: string;
  worktreeStatus: string;
  addedLines: number;
  removedLines: number;
  ignored: boolean;
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

export type GitCommitFileEntry = {
  path: string;
  status: string;
  addedLines: number;
  removedLines: number;
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

export type GitDiffLine = {
  kind: "added" | "removed" | "context" | "meta";
  oldLine?: number;
  newLine?: number;
  text: string;
};

export type GitDiffHunk = {
  header: string;
  lines: GitDiffLine[];
};

export type GitDiffResponse = {
  path: string;
  staged: boolean;
  addedLines: number;
  removedLines: number;
  hunks: GitDiffHunk[];
};

export type BusyTexCacheInfo = {
  policy: string;
  requestedDir: string;
  actualDir: string;
  installDirWritable: boolean;
  usingFallback: boolean;
};

export type Ack = {
  ok: boolean;
  message: string;
};

export type GitInitProgress = {
  phase: "idle" | "checking" | "initializing" | "refreshing" | "done" | "error";
  message: string;
};
