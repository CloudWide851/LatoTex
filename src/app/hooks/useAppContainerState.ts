import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
  BusyTexCacheInfo,
  EditorTab,
  GitAvailability,
  GitBranchInfo,
  GitCommitInfo,
  GitDownloadStatus,
  GitInitProgress,
  GitStatus,
  ModelCatalogItem,
  PanelLayoutPrefs,
  ProjectSearchHit,
  ProjectSummary,
  ResourceNode,
  RuntimeLogEntry,
  RuntimeLogInfo,
  SwarmEvent,
  WorkspacePage,
} from "../../shared/types/app";
import {
  flattenFiles,
  PAGE_ITEMS,
  type AgentStatusKey,
  type DeleteIntent,
  type LogTab,
  type OverlayType,
  type SettingsSection,
  type ThemeTransition,
  type Toast,
} from "../app-config";
import type { AgentChatMessage, AgentFileProposal } from "./agentTypes";

export type AgentProposalMap = Record<string, AgentFileProposal>;

export function useAppContainerState(t: (...args: any[]) => string) {
  const [status, setStatus] = useState<"ready" | "offline">("ready");
  const [toast, setToast] = useState<Toast>(null);
  const [page, setPage] = useState<WorkspacePage>("latex");
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [activeProjectId, setActiveProjectId] = useState<string | null>(null);
  const [tree, setTree] = useState<ResourceNode[]>([]);
  const [libraryTree, setLibraryTree] = useState<ResourceNode[]>([]);
  const [selectedFile, setSelectedFile] = useState<string | null>(null);
  const [selectedLibraryPath, setSelectedLibraryPath] = useState<string | null>(null);
  const [pendingRevealLine, setPendingRevealLine] = useState<number | null>(null);
  const [editorContent, setEditorContent] = useState("");
  const [editorTabs, setEditorTabs] = useState<EditorTab[]>([]);
  const [activeTabId, setActiveTabId] = useState<string | null>(null);
  const [previewTabId, setPreviewTabId] = useState<string | null>(null);
  const [dirtyByPath, setDirtyByPath] = useState<Record<string, boolean>>({});
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentChatMessage[]>([]);
  const [agentProposalsByPath, setAgentProposalsByPath] = useState<AgentProposalMap>({});
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agentCollapsed, setAgentCollapsed] = useState(true);
  const [agentPhase, setAgentPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [agentStatusKey, setAgentStatusKey] = useState<AgentStatusKey>("agent.statusIdle");
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [compileDiagnostics, setCompileDiagnostics] = useState<string[]>([]);
  const [lastCompileFailed, setLastCompileFailed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [compiledPdfBytes, setCompiledPdfBytes] = useState<Uint8Array | null>(null);
  const [selectedFilePdfUrl, setSelectedFilePdfUrl] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [draftModelApiKeys, setDraftModelApiKeys] = useState<Record<string, string>>({});
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSearchResults, setProjectSearchResults] = useState<ProjectSearchHit[]>([]);
  const [projectSearchBusy, setProjectSearchBusy] = useState(false);
  const [projectSearchSearched, setProjectSearchSearched] = useState(false);
  const [busytexCacheInfo, setBusytexCacheInfo] = useState<BusyTexCacheInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeLogInfo | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<RuntimeLogEntry[]>([]);
  const [runtimeLogLoading, setRuntimeLogLoading] = useState(false);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowActionBusy, setWindowActionBusy] = useState(false);
  const [overlay, setOverlay] = useState<OverlayType>(null);
  const [logsTab, setLogsTab] = useState<LogTab>("events");
  const [modelModalOpen, setModelModalOpen] = useState(false);
  const [modelModalMode, setModelModalMode] = useState<"create" | "edit">("create");
  const [modelModalInitial, setModelModalInitial] = useState<ModelCatalogItem | null>(null);
  const [deleteIntent, setDeleteIntent] = useState<DeleteIntent>(null);
  const [themeTransition, setThemeTransition] = useState<ThemeTransition | null>(null);
  const [deleteDontAskAgain, setDeleteDontAskAgain] = useState(false);
  const [gitStatusState, setGitStatusState] = useState<GitStatus | null>(null);
  const [gitBranchesState, setGitBranchesState] = useState<GitBranchInfo[]>([]);
  const [gitCommits, setGitCommits] = useState<GitCommitInfo[]>([]);
  const [gitAvailability, setGitAvailability] = useState<GitAvailability | null>(null);
  const [gitDownloadState, setGitDownloadState] = useState<GitDownloadStatus | null>(null);
  const [gitInitProgress, setGitInitProgress] = useState<GitInitProgress | null>(null);
  const [gitDownloadTaskId, setGitDownloadTaskId] = useState<string | null>(null);
  const [gitInstallerLaunched, setGitInstallerLaunched] = useState(false);
  const [suppressAutoGitInstall, setSuppressAutoGitInstall] = useState(false);
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [modelTestActiveId, setModelTestActiveId] = useState<string | null>(null);
  const [modelTestById, setModelTestById] = useState<
    Record<string, { modelId: string; ok: boolean; message: string }>
  >({});

  const resizeFrameRef = useRef<number | null>(null);
  const editorRef = useRef<any>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const lastLoadedProjectIdRef = useRef<string | null>(null);
  const integrityCheckedRef = useRef<Set<string>>(new Set());
  const autoSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoSaveReadyRef = useRef(false);
  const lastAutoSavedHashRef = useRef<string | null>(null);
  const panelLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPanelLayoutRef = useRef<Partial<PanelLayoutPrefs>>({});
  const editorTabsRef = useRef<EditorTab[]>([]);
  const activeTabIdRef = useRef<string | null>(null);
  const previewTabIdRef = useRef<string | null>(null);
  const dirtyByPathRef = useRef<Record<string, boolean>>({});
  const savedContentByPathRef = useRef<Record<string, string>>({});
  const workingContentByPathRef = useRef<Record<string, string>>({});
  const closeGuardUnlockedRef = useRef(false);

  const fileList = useMemo(() => flattenFiles(tree), [tree]);
  const pageRailItems = useMemo(
    () => PAGE_ITEMS.map((item) => ({ id: item.id, icon: item.icon, label: t(item.key) })),
    [t],
  );
  const fileSet = useMemo(() => new Set(fileList), [fileList]);

  useEffect(() => {
    activeProjectIdRef.current = activeProjectId;
  }, [activeProjectId]);

  useEffect(() => {
    editorTabsRef.current = editorTabs;
  }, [editorTabs]);

  useEffect(() => {
    activeTabIdRef.current = activeTabId;
  }, [activeTabId]);

  useEffect(() => {
    previewTabIdRef.current = previewTabId;
  }, [previewTabId]);

  useEffect(() => {
    dirtyByPathRef.current = dirtyByPath;
  }, [dirtyByPath]);

  return {
    status,
    setStatus,
    toast,
    setToast,
    page,
    setPage,
    projects,
    setProjects,
    activeProjectId,
    setActiveProjectId,
    tree,
    setTree,
    libraryTree,
    setLibraryTree,
    selectedFile,
    setSelectedFile,
    selectedLibraryPath,
    setSelectedLibraryPath,
    pendingRevealLine,
    setPendingRevealLine,
    editorContent,
    setEditorContent,
    editorTabs,
    setEditorTabs,
    activeTabId,
    setActiveTabId,
    previewTabId,
    setPreviewTabId,
    dirtyByPath,
    setDirtyByPath,
    agentPrompt,
    setAgentPrompt,
    agentMessages,
    setAgentMessages,
    agentProposalsByPath,
    setAgentProposalsByPath,
    agentRunId,
    setAgentRunId,
    agentCollapsed,
    setAgentCollapsed,
    agentPhase,
    setAgentPhase,
    agentStatusKey,
    setAgentStatusKey,
    events,
    setEvents,
    cursor,
    setCursor,
    compileDiagnostics,
    setCompileDiagnostics,
    lastCompileFailed,
    setLastCompileFailed,
    pdfUrl,
    setPdfUrl,
    compiledPdfBytes,
    setCompiledPdfBytes,
    selectedFilePdfUrl,
    setSelectedFilePdfUrl,
    settings,
    setSettings,
    settingsSection,
    setSettingsSection,
    draftModelApiKeys,
    setDraftModelApiKeys,
    projectSearchQuery,
    setProjectSearchQuery,
    projectSearchResults,
    setProjectSearchResults,
    projectSearchBusy,
    setProjectSearchBusy,
    projectSearchSearched,
    setProjectSearchSearched,
    busytexCacheInfo,
    setBusytexCacheInfo,
    busy,
    setBusy,
    runtimeInfo,
    setRuntimeInfo,
    runtimeLogs,
    setRuntimeLogs,
    runtimeLogLoading,
    setRuntimeLogLoading,
    isMaximized,
    setIsMaximized,
    windowActionBusy,
    setWindowActionBusy,
    overlay,
    setOverlay,
    logsTab,
    setLogsTab,
    modelModalOpen,
    setModelModalOpen,
    modelModalMode,
    setModelModalMode,
    modelModalInitial,
    setModelModalInitial,
    deleteIntent,
    setDeleteIntent,
    themeTransition,
    setThemeTransition,
    deleteDontAskAgain,
    setDeleteDontAskAgain,
    gitStatusState,
    setGitStatusState,
    gitBranchesState,
    setGitBranchesState,
    gitCommits,
    setGitCommits,
    gitAvailability,
    setGitAvailability,
    gitDownloadState,
    setGitDownloadState,
    gitInitProgress,
    setGitInitProgress,
    gitDownloadTaskId,
    setGitDownloadTaskId,
    gitInstallerLaunched,
    setGitInstallerLaunched,
    suppressAutoGitInstall,
    setSuppressAutoGitInstall,
    modelTestBusy,
    setModelTestBusy,
    modelTestActiveId,
    setModelTestActiveId,
    modelTestById,
    setModelTestById,
    resizeFrameRef,
    editorRef,
    activeProjectIdRef,
    lastLoadedProjectIdRef,
    integrityCheckedRef,
    autoSaveTimerRef,
    autoSaveReadyRef,
    lastAutoSavedHashRef,
    panelLayoutSaveTimerRef,
    pendingPanelLayoutRef,
    editorTabsRef,
    activeTabIdRef,
    previewTabIdRef,
    dirtyByPathRef,
    savedContentByPathRef,
    workingContentByPathRef,
    closeGuardUnlockedRef,
    fileList,
    pageRailItems,
    fileSet,
  };
}
