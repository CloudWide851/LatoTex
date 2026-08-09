import type { CodeLanguageInfo } from "../utils/codeLanguage";
import type { PluginCatalogSource } from "../plugins/pluginTypes";
import type { ChannelPrefs } from "./channels";

export type WorkspacePage =
  | "overview"
  | "library"
  | "latex"
  | "analysis"
  | "submission"
  | "agents"
  | "draw"
  | "git"
  | "plugins"
  | "settings";

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
  knowledgeState?: "pending" | "indexing" | "ready" | "stale" | "failed" | null;
  knowledgeLocked?: boolean | null;
  children: ResourceNode[];
};

export type ProjectSnapshot = {
  summary: ProjectSummary;
  tree: ResourceNode[];
  mainFile: string;
};

export type ProjectDeleteResponse = {
  deletedProjectId: string;
  rootPath: string;
  trashedRoot: boolean;
  nextActiveProjectId: string | null;
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

export type {
  TerminalActivateResponse,
  TerminalFailure,
  TerminalLaunchKind,
  TerminalOutputChunk,
  TerminalReadResponse,
  TerminalStartResponse,
  TerminalStatus,
} from "./terminal";

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

export type MarkdownRunCodeCapability = {
  language: string;
  available: boolean;
  runner?: string | null;
  message: string;
};

export type ScientificCommandResponse = {
  commandId: string;
  status: "completed" | "failed" | "opened" | string;
  message: string;
  output?: MarkdownRunCodeResponse | null;
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

export type ShareOwnerAuth = {
  participantId: string;
  participantToken: string;
};

export type ShareSessionCreateResult = {
  session: ShareSessionInfo;
  ownerAuth: ShareOwnerAuth;
  password: string;
};

export type ShareSessionPasswordResult = {
  password: string;
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

export type AgentApprovalCapability = {
  capability: string;
  resource: string;
};

export type AgentApprovalRequest = {
  approvalId: string;
  runId: string;
  projectId: string;
  workflowId: string;
  capabilities: AgentApprovalCapability[];
  status: string;
  createdAt: string;
  expiresAt: string;
};

export type AgentApprovalDecision = "allow_once" | "allow_project" | "deny";

export type AgentPermissionGrant = {
  grantId: string;
  projectId: string;
  capability: string;
  resource: string;
  createdAt: string;
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

export type OnboardingStep = "open" | "compile" | "view";

export type OnboardingState = {
  version: number;
  status: "active" | "dismissed" | "completed";
  projectId?: string;
  completedSteps: OnboardingStep[];
};

export type KnowledgeSearchScope = "current" | "all";

export type KnowledgeGraphPrefs = {
  maxVisibleNodes?: number;
  showLabels?: boolean;
};

export type AppSettings = {
  activeProjectId: string | null;
  modelProtocols: ModelProtocol[];
  modelCatalog: ModelCatalogItem[];
  agentBindings: AgentModelBinding[];
  uiPrefs?: {
    language?: "en-US" | "zh-CN" | "es-ES" | "ja-JP";
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
    unpaywallContactEmail?: string;
    knowledgeSemanticModelReminderEnabled?: boolean;
    knowledgeDefaultScope?: KnowledgeSearchScope;
    knowledgeBackgroundIndexEnabled?: boolean;
    knowledgeGraphPrefs?: KnowledgeGraphPrefs;
    librarySelectedPathByProject?: Record<string, string>;
    libraryViewModeByProject?: Record<string, "bib" | "pdf" | "compare">;
    workspaceExplorerDefaultExpanded?: boolean;
    libraryExplorerDefaultExpanded?: boolean;
    workspaceExplorerScrollbarVisible?: boolean;
    libraryExplorerScrollbarVisible?: boolean;
    editorResizeRefreshDelayMs?: number;
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
    skillCatalogVersion?: number;
    onboarding?: OnboardingState;
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

export type ResearchSkillDescriptor = {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  hidden: boolean;
  source: "builtIn" | "configured" | "custom" | string;
  validation: SkillValidationResult;
};

export type FeatureModelBindings = {
  latexAgentModelId?: string;
  analysisAgentModelId?: string;
  gitSummaryModelId?: string;
  chatAgentModelId?: string;
  translationModelId?: string;
  completionModelId?: string;
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

export * from "./app-extended";
export * from "./analysis";
export * from "./analysisContext";
export * from "./channels";
export * from "./submissionPack";
export * from "./runtime";
export * from "./knowledge";

