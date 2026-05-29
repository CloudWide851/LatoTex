import type { CodeLanguageInfo } from "../utils/codeLanguage";
import type { PluginCatalogSource } from "../plugins/pluginTypes";

export type WorkspacePage = "latex" | "analysis" | "draw" | "library" | "git" | "plugins" | "settings";

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

export type WorkspaceExportAssetResponse = {
  savedPath: string;
  fileName: string;
};

export type TerminalStartResponse = {
  sessionId: string;
  cwd: string;
  shell: string;
  venvPath?: string | null;
  envSource?: string | null;
  status: string;
};

export type TerminalOutputChunk = {
  seq: number;
  stream: "stdout" | "stderr" | string;
  text: string;
};

export type TerminalReadResponse = {
  cursor: number;
  chunks: TerminalOutputChunk[];
  exitCode?: number | null;
  status: "running" | "exited" | string;
};

export type MarkdownRunCodeResponse = {
  language: string;
  status: "completed" | "failed" | string;
  stdout: string;
  stderr: string;
  exitCode?: number | null;
  durationMs: number;
  truncated: boolean;
  runner: string;
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
  syncSeq?: number | null;
  syncEventCount?: number | null;
  lastSyncAt?: string | null;
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

export type AgentTeamMode = "auto" | "force" | "off";

export type AgentRunsRecoverResponse = {
  recoveredRunIds: string[];
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
    themePreset?: "default" | "graphite" | "paper" | "forest" | "ocean" | "rose" | "amber" | "highContrast";
    previewDefaultZoom?: number;
    paperBriefEngine?: "auto" | "pdfjs" | "python";
    busytexCachePolicy?: "install-first" | "appdata-only";
    terminalShell?: "powershell" | "cmd" | "system";
    panelLayout?: PanelLayoutPrefs;
    featureModelBindings?: FeatureModelBindings;
    channels?: ChannelPrefs;
    closeBehavior?: "ask" | "tray" | "exit";
    closeBehaviorRemember?: boolean;
    backgroundImagePath?: string;
    backgroundImagePaths?: string[];
    backgroundBlurPx?: number;
    backgroundCropByPath?: Record<string, BackgroundCropRect>;
    editorBackgroundColor?: string;
    interfaceDensity?: "compact" | "comfortable" | "spacious";
    accentColor?: "emerald" | "blue" | "violet" | "rose" | "amber" | "custom";
    accentCustomColor?: string;
    scrollbarColorMode?: "accent" | "custom";
    scrollbarWidthPx?: number;
    scrollbarThumbColor?: string;
    scrollbarTrackColor?: string;
    glassOpacity?: number;
    glassBlurPx?: number;
    motionLevel?: "full" | "reduced" | "none";
    fontScale?: number;
    pdfPageGapPx?: number;
    logFontSizePx?: number;
    panelRadiusPx?: number;
    panelBorderContrast?: "soft" | "normal" | "strong";
    memoryGuardPrefs?: MemoryGuardPrefs;
    analysisEnvRootsByProject?: Record<string, string>;
    librarySelectedPathByProject?: Record<string, string>;
    libraryViewModeByProject?: Record<string, "bib" | "pdf" | "compare">;
    workspaceExplorerDefaultExpanded?: boolean;
    libraryExplorerDefaultExpanded?: boolean;
    workspaceExplorerExpandedPathsByProject?: Record<string, string[]>;
    libraryExplorerExpandedPathsByProject?: Record<string, string[]>;
    sidebarPageOrder?: WorkspacePage[];
    agentToolPrefs?: AgentToolPrefs;
    agentPermissionPrefs?: AgentPermissionPrefs;
    agentTeamPrefs?: AgentTeamPrefs;
    pluginCatalogSources?: PluginCatalogSource[];
    docxAutoSaveEnabled?: boolean;
    mcpServers?: McpServerConfig[];
    enabledSkills?: string[];
    hiddenSkills?: string[];
  };
};

export type BackgroundCropRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

export type AgentTeamRolePrefs = {
  id: string;
  name: string;
  description?: string;
  identityPrompt?: string;
  modelId?: string;
  phase?: "plan" | "research" | "edit" | "review" | "final";
  canWrite?: boolean;
  toolAccess?: string[];
  mcpServerIds?: string[];
  skillIds?: string[];
  color?: string;
  enabled?: boolean;
};

export type AgentTeamConfig = {
  id: string;
  name: string;
  enabled?: boolean;
  callsites?: string[];
  parallelism?: number;
  requirePlanApproval?: boolean;
  roles?: AgentTeamRolePrefs[];
};

export type AgentTeamPrefs = {
  enabled?: boolean;
  defaultTeamId?: string;
  teams?: AgentTeamConfig[];
};

export type AgentToolPrefs = {
  webSearchEnabled?: boolean;
  workspaceReadEnabled?: boolean;
  pythonEnabled?: boolean;
  mcpEnabled?: boolean;
  writeRequiresConfirmation?: boolean;
};

export type PermissionMode = "allow" | "ask" | "deny";

export type AgentPermissionPrefs = {
  webSearch?: PermissionMode;
  workspaceRead?: PermissionMode;
  python?: PermissionMode;
  mcp?: PermissionMode;
  skills?: PermissionMode;
  pluginCommands?: PermissionMode;
  nonLatexWrites?: PermissionMode;
  mcpServerModes?: Record<string, PermissionMode>;
  pluginModes?: Record<string, PermissionMode>;
};

export type MemoryGuardPrefs = {
  enabled?: boolean;
  highWatermarkMb?: number;
  criticalWatermarkMb?: number;
  sampleIntervalSec?: number;
  criticalAction?: "release" | "sleep";
};

export type McpServerConfig = {
  id: string;
  command: string;
  args?: string[];
  env?: Record<string, string>;
  enabled?: boolean;
};

export type McpValidationResult = {
  ok: boolean;
  message: string;
  tools: string[];
};

export type SkillValidationResult = {
  ok: boolean;
  skillId: string;
  message: string;
  source: "builtIn" | "configured" | "custom" | string;
  manifestPath?: string | null;
  details?: string[];
};

export type TelegramTestInput = {
  token: string;
  chatId?: string;
  text: string;
};

export type FeatureModelBindings = {
  latexAgentModelId?: string;
  analysisAgentModelId?: string;
  gitSummaryModelId?: string;
  chatAgentModelId?: string;
  translationModelId?: string;
  completionModelId?: string;
};

export type ChannelPrefs = {
  telegramEnabled?: boolean;
  telegramBotToken?: string;
  telegramChatId?: string;
  dingtalkEnabled?: boolean;
  dingtalkClientId?: string;
  dingtalkClientSecret?: string;
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

export type DingTalkPollInput = {
  limit?: number;
};

export type DingTalkUpdateItem = {
  conversationId: string;
  senderId: string;
  senderName: string;
  text: string;
  replyToken?: string | null;
};

export type DingTalkPollResult = {
  updates: DingTalkUpdateItem[];
  status: string;
};

export type DingTalkSendInput = {
  replyToken?: string | null;
  webhook?: string | null;
  text: string;
};

export type DingTalkTestInput = {
  clientId: string;
  clientSecret: string;
};

export type PanelLayoutPrefs = {
  shell?: number[];
  latex?: number[];
  latexTerminal?: number[];
  analysis?: number[];
  library?: number[];
  libraryBib?: number[];
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

export type RuntimeDiagnosticsBundleExport = {
  path: string;
  fileName: string;
  sizeBytes: number;
  createdAt: string;
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

