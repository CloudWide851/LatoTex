import type {
  CloseTabsAction,
  ChannelPrefs,
  EditorTab,
  FsAction,
  FsScope,
  ResourceNode,
  ShareCommentItem,
  ShareSessionInfo,
  SwarmEvent,
  WorkspacePage,
} from "../../../shared/types/app";
import type { LogTab } from "../../app-config";
import type { AgentPhase } from "../AgentChatOverlay";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import type { AgentChatMessage, AgentFileProposal, AgentSessionSummary } from "../../hooks/agentTypes";
import type { AgentStatusKey } from "./workspaceShellUtils";

export type TranslationFn = (key: any) => string;
export type ShareMode = "local" | "remote";

export type AppWorkspaceShellProps = {
  page: WorkspacePage;
  pageRailItems: Array<{ id: WorkspacePage; icon: any; label: string }>;
  activeProjectId: string | null;
  busy: boolean;
  shellLayout: number[];
  latexLayout: number[];
  analysisLayout: number[];
  libraryLayout: number[];
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
  preferCompiledPreview: boolean;
  selectedFilePdfUrl: string | null;
  compileErrorLine: string | null;
  compileDiagnostics: string[];
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
  settingsPanel: React.ReactNode;
  gitPanel: React.ReactNode;
  analysisPanel: React.ReactNode;
  shareSession: ShareSessionInfo | null;
  shareBusy: boolean;
  shareSyncing: boolean;
  shareComments: ShareCommentItem[];
  channelPrefs?: ChannelPrefs | null;
  shareMode: ShareMode;
  shareSessionName: string;
  onShareModeChange: (mode: ShareMode) => void;
  onShareSessionNameChange: (value: string) => void;
  onPageChange: (page: WorkspacePage) => void;
  onShareStart: (mode?: ShareMode) => void | Promise<void>;
  onShareStop: () => void | Promise<void>;
  onShareRefresh: () => void | Promise<void>;
  onSelectFile: (path: string | null) => void;
  onSelectLibraryPath: (path: string | null) => void;
  onTabSelect: (tabId: string) => void;
  onTabClose: (tabId: string) => void;
  onTabCloseAction: (action: CloseTabsAction, tabId: string) => void;
  onTabPin: (tabId: string) => void;
  onEditorChange: (value: string) => void;
  onEditorMount: (editor: any, monaco: any) => void;
  onAgentPromptChange: (value: string) => void;
  onAgentToggle: () => void;
  onAgentRun: (promptOverride?: string) => void;
  onAgentSessionPickerOpenChange: (value: boolean) => void;
  onAgentSessionPickerIndexChange: (value: number) => void;
  onAgentSessionConfirm: () => void;
  onAgentRollback: () => void;
  onAgentAcceptProposal: (withAnalysis: boolean) => void;
  onAgentRejectProposal: () => void;
  onAgentPendingActionResolve: (accept: boolean) => void;
  onOpenFolder: () => void;
  onSaveFile: () => void;
  onCompile: () => void;
  onExportPdf: () => void;
  onEditorUndo: () => void;
  onEditorRedo: () => void;
  onOpenLogs: (tab: LogTab) => void;
  onLibraryRescan: () => void;
  onLibraryImportPdf: () => void;
  onLibraryImportLink: (link: string) => void;
  onLibrarySyncZotero: (input: { ownerId: string; apiKey: string; scope?: "users" | "groups" }) => void;
  onLibraryAnalyzePaper: (path: string) => void;
  analysisRunning: boolean;
  onWorkspaceRevealInSystem: (relativePath?: string) => void | Promise<void>;
  onWorkspaceOpenTerminal: (relativePath?: string) => void | Promise<void>;
  onSavePanelLayout: (panel: "shell" | "latex" | "analysis" | "library", layout: number[]) => void;
  previewDefaultZoom: number;
  completionModelId: string | null;
  translationModelId: string | null;
  onFsAction: (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => Promise<void>;
  t: TranslationFn;
};
