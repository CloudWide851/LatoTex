import type { CodeLanguageInfo } from "../utils/codeLanguage";

export type WorkspacePage = "latex" | "analysis" | "draw" | "library" | "git" | "settings";

export type EditorTab = {
  id: string;
  path: string;
  title: string;
  pinned: boolean;
  preview: boolean;
  language: CodeLanguageInfo;
  languageTag: string;
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
  directoryRole?: "pythonVenv";
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
  sessionName?: string | null;
  sessionCreatedAt?: string | null;
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
  pdfState?: "empty" | "ready" | "uploading" | "error" | string | null;
  pdfUpdatedAt?: string | null;
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
  source?: "tex" | "pdf" | string;
  sessionName?: string;
  sessionCreatedAt?: string;
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

export type AgentExecuteStartAccepted = {
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
    previewDefaultZoom?: number;
    paperBriefEngine?: "auto" | "pdfjs" | "python";
    panelLayout?: PanelLayoutPrefs;
    featureModelBindings?: FeatureModelBindings;
    channels?: ChannelPrefs;
    closeBehavior?: "ask" | "tray" | "exit";
    closeBehaviorRemember?: boolean;
    backgroundImagePath?: string;
    backgroundImagePaths?: string[];
    backgroundBlurPx?: number;
    analysisEnvRootsByProject?: Record<string, string>;
    librarySelectedPathByProject?: Record<string, string>;
    libraryViewModeByProject?: Record<string, "bib" | "pdf" | "compare">;
  };
};

export type FeatureModelBindings = {
  latexAgentModelId?: string;
  analysisAgentModelId?: string;
  gitSummaryModelId?: string;
  translationModelId?: string;
  completionModelId?: string;
};

export type ChannelPrefs = {
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
};

export type TelegramPollInput = {
  offset?: number;
  limit?: number;
  timeoutSecs?: number;
};

export type TelegramUpdateItem = {
  updateId: number;
  messageId: number;
  chatId: string;
  username: string;
  text: string;
};

export type TelegramPollResult = {
  nextOffset: number;
  updates: TelegramUpdateItem[];
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

export type RuntimeMemorySnapshot = {
  processId: number;
  rssBytes: number;
  privateBytes?: number | null;
  webviewRssBytes?: number | null;
  webviewPrivateBytes?: number | null;
  webviewProcessCount?: number | null;
  totalRssBytes?: number | null;
  totalPrivateBytes?: number | null;
  sampledAt: string;
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

export type RuntimeLogSession = {
  fileName: string;
  modifiedAt: string;
  sizeBytes: number;
  isCurrent: boolean;
};

export type RuntimeLogSessionListResponse = {
  sessions: RuntimeLogSession[];
};

export type AppBackgroundImage = {
  path: string;
};

export type AppBackgroundImagePayload = {
  path: string;
  mime: string;
  bytes: number[];
};

export * from "./app-extended";

