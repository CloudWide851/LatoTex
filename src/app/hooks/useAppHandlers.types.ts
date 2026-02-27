import type { Locale } from "../../i18n";
import type {
  AppSettings,
  BusyTexCacheInfo,
  FsScope,
  GitDownloadStatus,
  ProjectSearchHit,
  ResourceNode,
} from "../../shared/types/app";
import type { AgentStatusKey, ThemeMode } from "../app-config";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";
import type { AgentProposalMap } from "./useAppContainerState";

export type TranslationFn = (key: any) => string;
export type DeleteIntent = { scope: FsScope; path: string } | null;
export type UseAppHandlersParams = {
  isTauriRuntime: boolean;
  t: TranslationFn;
  locale: Locale;
  activeProjectId: string | null;
  selectedFile: string | null;
  fileList: string[];
  editorContent: string;
  pdfUrl: string | null;
  compiledPdfBytes: Uint8Array | null;
  agentPrompt: string;
  windowActionBusy: boolean;
  settings: AppSettings | null;
  projectSearchQuery: string;
  gitDownloadTaskId: string | null;
  gitInstallerLaunched: boolean;
  deleteIntent: DeleteIntent;
  deleteDontAskAgain: boolean;
  setBusy: (value: boolean) => void;
  setTree: (value: ResourceNode[]) => void;
  setLibraryTree: (value: ResourceNode[]) => void;
  setSelectedFile: (value: string | null) => void;
  setSelectedLibraryPath: (value: string | null) => void;
  setEditorContent: (value: string) => void;
  setProjects: React.Dispatch<React.SetStateAction<any[]>>;
  setActiveProjectId: (value: string | null) => void;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  setToast: (value: { type: "info" | "error"; message: string } | null) => void;
  setCompileDiagnostics: (value: string[]) => void;
  setLastCompileFailed: (value: boolean) => void;
  setPdfUrl: (value: string | null) => void;
  setCompiledPdfBytes: (value: Uint8Array | null) => void;
  setAgentMessages: React.Dispatch<React.SetStateAction<AgentChatMessage[]>>;
  agentProposalsByPath: AgentProposalMap;
  setAgentProposalsByPath: React.Dispatch<React.SetStateAction<AgentProposalMap>>;
  setAgentRunId: (value: string | null) => void;
  setAgentPrompt: (value: string) => void;
  setAgentCollapsed: (value: boolean | ((prev: boolean) => boolean)) => void;
  setAgentPhase: (value: "idle" | "running" | "done" | "error") => void;
  setAgentStatusKey: (value: AgentStatusKey) => void;
  setWindowActionBusy: (value: boolean) => void;
  setIsMaximized: (value: boolean) => void;
  setProjectSearchResults: (value: ProjectSearchHit[]) => void;
  setProjectSearchSearched: (value: boolean) => void;
  setProjectSearchBusy: (value: boolean) => void;
  setPage: (value: any) => void;
  setPendingRevealLine: (value: number | null) => void;
  setBusytexCacheInfo: (value: BusyTexCacheInfo | null) => void;
  setDeleteIntent: (value: DeleteIntent) => void;
  setDeleteDontAskAgain: (value: boolean) => void;
  setThemeTransition: React.Dispatch<React.SetStateAction<any>>;
  setGitDownloadTaskId: (value: string | null) => void;
  setGitDownloadState: (value: GitDownloadStatus | null) => void;
  setGitInstallerLaunched: (value: boolean) => void;
  setSuppressAutoGitInstall: (value: boolean) => void;
  editorRef: React.MutableRefObject<any>;
  loadProjectData: (projectId: string) => Promise<void>;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  setLocale: (next: Locale) => void;
  upsertProject: (projects: any[], snapshot: any) => any[];
  runAnalysisFromAgent?: (prompt: string) => Promise<void>;
};
