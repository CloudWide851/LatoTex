import type {
  CloseTabsAction,
  ChannelPrefs,
  AppSettings,
  EditorTab,
  FsAction,
  FsScope,
  ResourceNode,
  AgentTeamMode,
  ShareCommentItem,
  ShareSessionInfo,
  SwarmEvent,
  WorkspacePage,
} from "../../../shared/types/app";
import type { ShareEditAnnotation } from "../../hooks/shareEditAnnotations";
import type { LogTab } from "../../app-config";
import type { AgentPhase } from "../AgentChatOverlay";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import type { AgentChatMessage, AgentFileProposal, AgentSessionSummary } from "../../hooks/agentTypes";
import type { AgentStatusKey } from "./workspaceShellUtils";
import type { CompileInstallProgress } from "../../hooks/compileWorkflow";
import type { CompileActionResult } from "../../hooks/compileActionTypes";
import type { ShareConflict, ShareConflictResolution } from "../../hooks/shareSessionUtils";

export type TranslationFn = (key: any) => string;
export type ShareMode = "local" | "remote";

export type AppWorkspaceShellProps = {
  page: WorkspacePage;
  pageRailItems: Array<{ id: WorkspacePage; icon: any; label: string }>;
  activeProjectId: string | null;
  busy: boolean;
  suspended?: boolean;
  shellLayout: number[];
  latexLayout: number[];
  latexTerminalLayout: number[];
  analysisLayout: number[];
  libraryLayout: number[];
  libraryBibLayout: number[];
  tree: ResourceNode[];
  libraryTree: ResourceNode[];
  selectedFile: string | null;
  selectedLibraryPath: string | null;
  fileList: string[];
  editorContent: string;
  editorTabs: EditorTab[];
  activeTabId: string | null;
  dirtyByPath: Record<string, boolean>;
  compiledPdfUrl: string | null;
  compiledPdfRelativePath: string | null;
  preferCompiledPreview: boolean;
  selectedFilePdfUrl: string | null;
  selectedImagePreviewUrl: string | null;
  previewOverridePath: string | null;
  compileErrorLine: string | null;
  compileDiagnostics: string[];
  compileInstallProgress: CompileInstallProgress | null;
  agentCollapsed: boolean;
  agentPhase: AgentPhase;
  agentStatusKey: AgentStatusKey;
  agentPrompt: string;
  agentMessages: AgentChatMessage[];
  agentProposal: AgentFileProposal | null;
  agentPendingAction: AgentPendingAction;
  agentRunId: string | null;
  agentSessions: AgentSessionSummary[];
  agentSessionPickerOpen: boolean;
  agentSessionPickerIndex: number;
  agentRollbackVisible: boolean;
  events: SwarmEvent[];
  explorerGitDecorations: Record<
    string,
    { code: string; ignored: boolean; staged: boolean; unstaged: boolean; untracked: boolean }
  >;
  shellMin: readonly [number, number];
  settings: AppSettings | null;
  settingsPanel: React.ReactNode;
  gitPanel: React.ReactNode;
  analysisPanel: React.ReactNode;
  shareSession: ShareSessionInfo | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  shareConflict: ShareConflict | null;
  shareComments: ShareCommentItem[];
  shareEditAnnotations: ShareEditAnnotation[];
  channelPrefs?: ChannelPrefs | null;
  shareMode: ShareMode;
  shareSessionName: string;
  onShareModeChange: (mode: ShareMode) => void;
  onShareSessionNameChange: (value: string) => void;
  onPageChange: (page: WorkspacePage) => void;
  onShareStart: (mode?: ShareMode) => void | Promise<void>;
  onShareStop: () => void | Promise<void>;
  onShareRefresh: () => void | Promise<void>;
  onShareConflictResolve: (resolution: ShareConflictResolution) => void;
  onSelectFile: (path: string | null) => void;
  onSelectLibraryPath: (path: string | null) => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCloseAction: (action: CloseTabsAction, tabId: string) => void;
  onTabPin: (tabId: string) => void;
  onEditorChange: (value: string) => void;
  onEditorMount: (editor: any, monaco: any) => void;
  onChatReviewRequest: (prompt: string) => void;
  onAgentPromptChange: (value: string) => void;
  onAgentToggle: () => void;
  onAgentRun: (promptOverride?: string, options?: { forceNewSession?: boolean; teamMode?: AgentTeamMode }) => void;
  onAgentSessionPickerOpenChange: (value: boolean) => void;
  onAgentSessionPickerIndexChange: (value: number) => void;
  onAgentSessionConfirm: () => void;
  onAgentRollback: () => void;
  onAgentAcceptProposal: (withAnalysis: boolean) => void;
  onAgentRejectProposal: () => void;
  onAgentPendingActionResolve: (accept: boolean) => void;
  onOpenFolder: () => void;
  onSaveFile: () => void;
  onWriteSelectedFileContent: (content: string) => Promise<boolean>;
  onCompile: () => Promise<CompileActionResult | null>;
  onExportPdf: () => void;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onOpenLogs: (tab: LogTab) => void;
  onLibraryRescan: () => void;
  onLibraryImportPdf: () => void;
  onLibraryImportLink: (input: {
    link: string;
    scope?: "users" | "groups";
    ownerId?: string;
    apiKey?: string;
  }) => void;
  onLibrarySyncZotero: (input: { ownerId: string; apiKey: string; scope?: "users" | "groups" }) => void;
  onLibraryAnalyzePaper: (path: string) => void;
  analysisRunning: boolean;
  libraryViewMode: "bib" | "pdf" | "compare" | null;
  onLibraryViewModeChange: (mode: "bib" | "pdf" | "compare") => void;
  onWorkspaceRevealInSystem: (relativePath?: string) => void | Promise<void>;
  onWorkspaceOpenTerminal: (relativePath?: string) => void | Promise<void>;
  onWorkspaceRescan: () => void | Promise<void>;
  onSavePanelLayout: (panel: "shell" | "latex" | "latexTerminal" | "analysis" | "library" | "libraryBib", layout: number[]) => void;
  previewDefaultZoom: number;
  fontScale: number;
  completionModelId: string | null;
  chatAgentModelId: string | null;
  translationModelId: string | null;
  paperBriefEngine: "auto" | "pdfjs" | "python";
  workspaceExplorerDefaultExpanded: boolean;
  libraryExplorerDefaultExpanded: boolean;
  workspaceExplorerScrollbarVisible: boolean;
  libraryExplorerScrollbarVisible: boolean;
  editorResizeRefreshDelayMs: number;
  workspaceExplorerExpandedPaths?: string[];
  libraryExplorerExpandedPaths?: string[];
  onWorkspaceExplorerExpandedPathsChange: (paths: string[]) => void;
  onLibraryExplorerExpandedPathsChange: (paths: string[]) => void;
  onFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<boolean | void>;
  onRunFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<boolean>;
  t: TranslationFn;
};

