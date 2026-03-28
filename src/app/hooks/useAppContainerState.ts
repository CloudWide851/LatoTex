import { useEffect, useMemo, useRef, useState } from "react";
import type {
  AppSettings,
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
import type { CompileInstallProgress } from "./compileWorkflow";

export type AgentProposalMap = Record<string, AgentFileProposal>;
export type AgentPendingAction =
  | {
      kind: "autoCommit";
      targetPath: string;
    }
  | null;

function proposalStorageKey(projectId: string): string {
  return `latotex.agent.proposals.${projectId}`;
}

function loadPersistedProposals(projectId: string): AgentProposalMap {
  if (typeof window === "undefined") {
    return {};
  }
  try {
    const raw = window.localStorage.getItem(proposalStorageKey(projectId));
    if (!raw) {
      return {};
    }
    const parsed = JSON.parse(raw) as Record<string, AgentFileProposal>;
    if (!parsed || typeof parsed !== "object") {
      return {};
    }
    const out: AgentProposalMap = {};
    for (const [path, value] of Object.entries(parsed)) {
      if (!value || typeof value !== "object") {
        continue;
      }
      if (
        typeof value.targetPath !== "string"
        || typeof value.originalContent !== "string"
        || typeof value.candidateContent !== "string"
      ) {
        continue;
      }
      out[path] = value;
    }
    return out;
  } catch {
    return {};
  }
}

function collectResourceFilePaths(nodes: ResourceNode[]): Set<string> {
  const output = new Set<string>();
  const walk = (items: ResourceNode[]) => {
    for (const node of items) {
      if (node.kind === "file") {
        output.add(node.relativePath);
        continue;
      }
      if (Array.isArray(node.children) && node.children.length > 0) {
        walk(node.children);
      }
    }
  };
  walk(nodes);
  return output;
}
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
  const [agentPendingAction, setAgentPendingAction] = useState<AgentPendingAction>(null);
  const [agentRunId, setAgentRunId] = useState<string | null>(null);
  const [agentCollapsed, setAgentCollapsed] = useState(true);
  const [agentPhase, setAgentPhase] = useState<"idle" | "running" | "done" | "error">("idle");
  const [agentStatusKey, setAgentStatusKey] = useState<AgentStatusKey>("agent.statusIdle");
  const [events, setEvents] = useState<SwarmEvent[]>([]);
  const [cursor, setCursor] = useState(0);
  const [compileDiagnostics, setCompileDiagnostics] = useState<string[]>([]);
  const [compileInstallProgress, setCompileInstallProgress] = useState<CompileInstallProgress | null>(null);
  const [lastCompileFailed, setLastCompileFailed] = useState(false);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [preferCompiledPreview, setPreferCompiledPreview] = useState(false);
  const [selectedFilePdfUrl, setSelectedFilePdfUrl] = useState<string | null>(null);
  const [selectedImagePreviewUrl, setSelectedImagePreviewUrl] = useState<string | null>(null);
  const [previewOverridePath, setPreviewOverridePath] = useState<string | null>(null);
  const [selectedTextFileReadyPath, setSelectedTextFileReadyPath] = useState<string | null>(null);
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [draftModelApiKeys, setDraftModelApiKeys] = useState<Record<string, string>>({});
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSearchResults, setProjectSearchResults] = useState<ProjectSearchHit[]>([]);
  const [projectSearchBusy, setProjectSearchBusy] = useState(false);
  const [projectSearchSearched, setProjectSearchSearched] = useState(false);
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
  const settingsRef = useRef<AppSettings | null>(settings);
  const loadedLibraryProjectIdRef = useRef<string | null>(null);
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

  const fileList = useMemo(() => flattenFiles(tree), [tree]);
  const pageRailItems = useMemo(
    () => PAGE_ITEMS.map((item) => ({ id: item.id, icon: item.icon, label: t(item.key) })),
    [t],
  );
  const fileSet = useMemo(() => new Set(fileList), [fileList]);
  const libraryFileSet = useMemo(() => collectResourceFilePaths(libraryTree), [libraryTree]);

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

  useEffect(() => {
    settingsRef.current = settings;
  }, [settings]);

  useEffect(() => {
    if (!activeProjectId) {
      setAgentProposalsByPath({});
      return;
    }
    setAgentProposalsByPath(loadPersistedProposals(activeProjectId));
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId || typeof window === "undefined") {
      return;
    }
    try {
      window.localStorage.setItem(
        proposalStorageKey(activeProjectId),
        JSON.stringify(agentProposalsByPath),
      );
    } catch {
      // Ignore storage quota errors; in-memory state remains available.
    }
  }, [activeProjectId, agentProposalsByPath]);

  useEffect(() => {
    if (!activeProjectId || loadedLibraryProjectIdRef.current !== activeProjectId || !selectedLibraryPath) {
      return;
    }
    if (libraryFileSet.has(selectedLibraryPath)) {
      return;
    }
    setSelectedLibraryPath(null);
  }, [activeProjectId, libraryFileSet, selectedLibraryPath]);

  useEffect(() => {
    if (!activeProjectId || loadedLibraryProjectIdRef.current !== activeProjectId) {
      return;
    }
    setSettings((prev) => {
      if (!prev) {
        return prev;
      }
      const currentMap = prev.uiPrefs?.librarySelectedPathByProject ?? {};
      const currentValue = String(currentMap[activeProjectId] ?? "").trim();
      const nextValue = selectedLibraryPath && libraryFileSet.has(selectedLibraryPath)
        ? selectedLibraryPath
        : "";
      if (currentValue === nextValue) {
        return prev;
      }
      const nextMap = { ...currentMap };
      if (nextValue) {
        nextMap[activeProjectId] = nextValue;
      } else {
        delete nextMap[activeProjectId];
      }
      return {
        ...prev,
        uiPrefs: {
          ...(prev.uiPrefs ?? {}),
          language: prev.uiPrefs?.language,
          librarySelectedPathByProject: Object.keys(nextMap).length > 0 ? nextMap : undefined,
        },
      };
    });
  }, [activeProjectId, libraryFileSet, selectedLibraryPath]);
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
    agentPendingAction,
    setAgentPendingAction,
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
    compileInstallProgress,
    setCompileInstallProgress,
    lastCompileFailed,
    setLastCompileFailed,
    pdfUrl,
    setPdfUrl,
    preferCompiledPreview,
    setPreferCompiledPreview,
    selectedFilePdfUrl,
    setSelectedFilePdfUrl,
    selectedImagePreviewUrl,
    setSelectedImagePreviewUrl,
    previewOverridePath,
    setPreviewOverridePath,
    selectedTextFileReadyPath,
    setSelectedTextFileReadyPath,
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
    settingsRef,
    loadedLibraryProjectIdRef,
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
    fileList,
    pageRailItems,
    fileSet,
  };
}

