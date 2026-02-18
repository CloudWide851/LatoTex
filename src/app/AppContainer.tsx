import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitWorkspace } from "./components/GitWorkspace";
import { AppOverlays } from "./components/AppOverlays";
import { AppTopbar } from "./components/AppTopbar";
import { AppWorkspaceShell } from "./components/AppWorkspaceShell";
import { SettingsPanel } from "./components/SettingsPanel";
import { UnsavedChangesDialog } from "./components/editor/UnsavedChangesDialog";
import { useI18n } from "../i18n";
import logoMark from "../assets/logo-mark.png";
import {
  getLibraryTree,
  gitBranches,
  gitCheckInstalled,
  gitCheckout,
  gitCommit,
  gitDiffFile,
  gitFetch,
  gitInitRepo,
  gitLog,
  gitPull,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
  openProject,
  projectIntegrityRepair,
  projectIntegrityStatus,
  runAgent,
  runtimeLogClearCurrentSession,
  runtimeLogRead,
  runtimeLogWrite,
  setModelApiKey,
  testModel,
  updateSettings,
  writeFile,
} from "../shared/api/desktop";
import type {
  AppSettings,
  BusyTexCacheInfo,
  CloseTabsAction,
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
  RuntimeLogInfo,
  RuntimeLogEntry,
  PendingNavigationIntent,
  SwarmEvent,
  UnsavedChangeItem,
  WorkspacePage,
} from "../shared/types/app";
import {
  clampLayout,
  DEFAULT_PANEL_LAYOUT,
  flattenFiles,
  PAGE_ITEMS,
  SHELL_MIN,
  type AgentStatusKey,
  type DeleteIntent,
  type LogTab,
  type OverlayType,
  type SettingsSection,
  type ThemeMode,
  type ThemeTransition,
  type Toast,
  upsertProject,
} from "./app-config";
import { useAppEffects } from "./hooks/useAppEffects";
import { buildEditorTab, getTabIdsByAction } from "./hooks/useEditorTabs";
import { useAppHandlers } from "./hooks/useAppHandlers";
import { useWorkspaceShortcuts } from "./hooks/useWorkspaceShortcuts";
import { isPdfPath } from "../shared/utils/fileKind";

type IntegrityIssue = {
  projectId: string;
  missingRequired: string[];
};

export function AppContainer() {
  const { locale, setLocale, t } = useI18n();
  const [status, setStatus] = useState<"ready" | "offline">("ready"); const [toast, setToast] = useState<Toast>(null);
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
  const [unsavedDialogOpen, setUnsavedDialogOpen] = useState(false);
  const [unsavedDialogIntent, setUnsavedDialogIntent] = useState<PendingNavigationIntent>("closeTabs");
  const [unsavedDialogItems, setUnsavedDialogItems] = useState<UnsavedChangeItem[]>([]);
  const [unsavedDialogBusy, setUnsavedDialogBusy] = useState(false);
  const [agentPrompt, setAgentPrompt] = useState("");
  const [agentMessages, setAgentMessages] = useState<{ id: string; role: "user" | "agent"; text: string }[]>([]);
  const [agentCollapsed, setAgentCollapsed] = useState(false);
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
  const [integrityIssue, setIntegrityIssue] = useState<IntegrityIssue | null>(null);
  const [modelTestBusy, setModelTestBusy] = useState(false);
  const [modelTestActiveId, setModelTestActiveId] = useState<string | null>(null);
  const [modelTestById, setModelTestById] = useState<Record<string, { modelId: string; ok: boolean; message: string }>>({});
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
  const pendingUnsavedActionRef = useRef<null | (() => void | Promise<void>)>(null);
  const pendingUnsavedPathsRef = useRef<string[]>([]);
  const isTauriRuntime = isTauri();
  activeProjectIdRef.current = activeProjectId;
  const fileList = useMemo(() => flattenFiles(tree), [tree]);
  const pageRailItems = useMemo(
    () => PAGE_ITEMS.map((item) => ({ id: item.id, icon: item.icon, label: t(item.key) })),
    [t],
  );
  const fileSet = useMemo(() => new Set(fileList), [fileList]);

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

  const resetEditorSession = useCallback(() => {
    setEditorTabs([]);
    setActiveTabId(null);
    setPreviewTabId(null);
    setDirtyByPath({});
    setEditorContent("");
    savedContentByPathRef.current = {};
    workingContentByPathRef.current = {};
    pendingUnsavedActionRef.current = null;
    pendingUnsavedPathsRef.current = [];
    setUnsavedDialogItems([]);
    setUnsavedDialogOpen(false);
    setUnsavedDialogBusy(false);
  }, []);

  const collectDirtyPaths = useCallback((candidatePaths: string[]) => {
    const unique = Array.from(new Set(candidatePaths.filter((path) => path.trim().length > 0)));
    return unique.filter((path) => dirtyByPathRef.current[path]);
  }, []);

  const markPathSaved = useCallback((path: string, content: string) => {
    savedContentByPathRef.current[path] = content;
    workingContentByPathRef.current[path] = content;
    setDirtyByPath((prev) => {
      if (!prev[path]) {
        return prev;
      }
      const next = { ...prev };
      delete next[path];
      return next;
    });
  }, []);

  const markPathDiscarded = useCallback((path: string) => {
    const saved = savedContentByPathRef.current[path] ?? "";
    workingContentByPathRef.current[path] = saved;
    setDirtyByPath((prev) => {
      if (!prev[path]) {
        return prev;
      }
      const next = { ...prev };
      delete next[path];
      return next;
    });
    if (selectedFile === path) {
      setEditorContent(saved);
    }
  }, [selectedFile]);

  const closeTabsNow = useCallback((tabIds: string[]) => {
    const closing = new Set(tabIds);
    if (closing.size === 0) {
      return;
    }
    const currentTabs = editorTabsRef.current;
    const activeId = activeTabIdRef.current;
    const activeIndex = activeId ? currentTabs.findIndex((tab) => tab.id === activeId) : -1;
    const nextTabs = currentTabs.filter((tab) => !closing.has(tab.id));
    for (const tab of currentTabs) {
      if (!closing.has(tab.id)) {
        continue;
      }
      if (dirtyByPathRef.current[tab.path]) {
        continue;
      }
      delete workingContentByPathRef.current[tab.path];
      delete savedContentByPathRef.current[tab.path];
    }
    let nextActiveId: string | null = activeId;
    if (!nextActiveId || closing.has(nextActiveId)) {
      if (nextTabs.length === 0) {
        nextActiveId = null;
      } else {
        const fallbackIndex = activeIndex < 0 ? nextTabs.length - 1 : Math.min(activeIndex, nextTabs.length - 1);
        nextActiveId = nextTabs[fallbackIndex]?.id ?? nextTabs[nextTabs.length - 1]?.id ?? null;
      }
    }
    const currentPreviewId = previewTabIdRef.current;
    const nextPreviewId = currentPreviewId && closing.has(currentPreviewId) ? null : currentPreviewId;

    setEditorTabs(nextTabs);
    setActiveTabId(nextActiveId);
    setPreviewTabId(nextPreviewId);
    const activeTab = nextTabs.find((tab) => tab.id === nextActiveId) ?? null;
    setSelectedFile(activeTab?.path ?? null);
    if (!activeTab) {
      setEditorContent("");
    }
  }, []);

  const requestUnsavedGuard = useCallback(
    (
      intent: PendingNavigationIntent,
      candidatePaths: string[],
      onProceed: () => void | Promise<void>,
    ) => {
      const dirtyPaths = collectDirtyPaths(candidatePaths);
      if (dirtyPaths.length === 0) {
        void onProceed();
        return;
      }
      pendingUnsavedActionRef.current = onProceed;
      pendingUnsavedPathsRef.current = dirtyPaths;
      setUnsavedDialogIntent(intent);
      setUnsavedDialogItems(dirtyPaths.map((path) => ({ path })));
      setUnsavedDialogOpen(true);
    },
    [collectDirtyPaths],
  );

  const handleUnsavedDialogCancel = useCallback(() => {
    pendingUnsavedActionRef.current = null;
    pendingUnsavedPathsRef.current = [];
    setUnsavedDialogOpen(false);
  }, []);

  const handleUnsavedDialogDiscardAndContinue = useCallback(async () => {
    const pendingPaths = [...pendingUnsavedPathsRef.current];
    for (const path of pendingPaths) {
      markPathDiscarded(path);
    }
    const action = pendingUnsavedActionRef.current;
    pendingUnsavedActionRef.current = null;
    pendingUnsavedPathsRef.current = [];
    setUnsavedDialogOpen(false);
    if (action) {
      await action();
    }
  }, [markPathDiscarded]);

  const handleUnsavedDialogSaveAndContinue = useCallback(async () => {
    if (!activeProjectIdRef.current) {
      return;
    }
    setUnsavedDialogBusy(true);
    try {
      const projectId = activeProjectIdRef.current;
      const pendingPaths = [...pendingUnsavedPathsRef.current];
      for (const path of pendingPaths) {
        const content = workingContentByPathRef.current[path];
        if (typeof content !== "string") {
          continue;
        }
        await writeFile(projectId, path, content);
        await runtimeLogWrite("INFO", `file saved (unsaved-guard): ${path}`);
        markPathSaved(path, content);
      }
      const action = pendingUnsavedActionRef.current;
      pendingUnsavedActionRef.current = null;
      pendingUnsavedPathsRef.current = [];
      setUnsavedDialogOpen(false);
      if (action) {
        await action();
      }
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setUnsavedDialogBusy(false);
    }
  }, [markPathSaved, setToast]);

  const refreshGitWorkspace = useCallback(async (projectIdOverride?: string) => {
    const projectId = projectIdOverride ?? activeProjectIdRef.current;
    if (!projectId) {
      return;
    }
    const availability = await gitCheckInstalled().catch(() => ({
      installed: false,
      version: undefined,
    }));
    setGitAvailability(availability);
    if (availability.installed) {
      setSuppressAutoGitInstall(false);
    }
    if (!availability.installed) {
      setGitStatusState({
        isRepo: false,
        branch: "-",
        ahead: 0,
        behind: 0,
        changes: [],
      });
      setGitBranchesState([]);
      setGitCommits([]);
      return;
    }
    const [state, branches, commits] = await Promise.all([
      gitStatus(projectId),
      gitBranches(projectId).catch(() => []),
      gitLog(projectId, 50).catch(() => []),
    ]);
    setGitStatusState(state);
    setGitBranchesState(branches);
    setGitCommits(commits);
  }, []);

  const loadProjectData = useCallback(async (projectId: string) => {
    if (!integrityCheckedRef.current.has(projectId)) {
      const integrity = await projectIntegrityStatus(projectId);
      if (integrity.missingRequired.length > 0) {
        setIntegrityIssue({
          projectId,
          missingRequired: integrity.missingRequired,
        });
        return;
      }
      integrityCheckedRef.current.add(projectId);
    }
    const snapshot = await openProject(projectId);
    setTree(snapshot.tree);
    setSelectedFile(snapshot.mainFile);
    const [papers] = await Promise.all([getLibraryTree(projectId)]);
    setLibraryTree(papers);
    setSelectedLibraryPath(null);
    lastLoadedProjectIdRef.current = projectId;
    await refreshGitWorkspace(projectId);
  }, [refreshGitWorkspace]);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    const updated = await updateSettings({
      activeProjectId: nextSettings.activeProjectId ?? activeProjectId,
      modelProtocols: nextSettings.modelProtocols.map((protocol) => ({
        id: protocol.id,
        displayName: protocol.displayName,
        baseUrl: protocol.baseUrl,
      })),
      modelCatalog: nextSettings.modelCatalog.map((model) => ({
        id: model.id,
        protocolId: model.protocolId,
        displayName: model.displayName,
        requestName: model.requestName,
      })),
      agentBindings: nextSettings.agentBindings,
      uiPrefs: {
        language: nextSettings.uiPrefs?.language ?? locale,
        skipDeleteConfirm: nextSettings.uiPrefs?.skipDeleteConfirm ?? false,
        theme: (nextSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
        busytexCachePolicy: nextSettings.uiPrefs?.busytexCachePolicy ?? "install-first",
        busytexCacheDir: nextSettings.uiPrefs?.busytexCacheDir,
        previewDefaultZoom: nextSettings.uiPrefs?.previewDefaultZoom ?? 1,
        panelLayout: nextSettings.uiPrefs?.panelLayout,
      },
    });
    const validModelIds = new Set(nextSettings.modelCatalog.map((item) => item.id));
    const keyEntries = Object.entries(draftModelApiKeys).filter(
      ([modelId]) => validModelIds.has(modelId),
    );
    if (keyEntries.length > 0) {
      await Promise.all(
        keyEntries.map(([modelId, apiKey]) => setModelApiKey(modelId, apiKey)),
      );
    }
    setSettings(updated);
    setDraftModelApiKeys({});
    return updated;
  }, [activeProjectId, draftModelApiKeys, locale]);

  const savePanelLayout = useCallback((panelKey: keyof PanelLayoutPrefs, layout: number[]) => {
    pendingPanelLayoutRef.current = {
      ...pendingPanelLayoutRef.current,
      [panelKey]: layout,
    };

    if (panelLayoutSaveTimerRef.current) {
      clearTimeout(panelLayoutSaveTimerRef.current);
    }
    panelLayoutSaveTimerRef.current = setTimeout(() => {
      const pending = pendingPanelLayoutRef.current;
      pendingPanelLayoutRef.current = {};
      setSettings((prev) => {
        if (!prev || Object.keys(pending).length === 0) {
          return prev;
        }
        return {
          ...prev,
          uiPrefs: {
            ...(prev.uiPrefs ?? {}),
            language: prev.uiPrefs?.language ?? locale,
            panelLayout: {
              ...DEFAULT_PANEL_LAYOUT,
              ...(prev.uiPrefs?.panelLayout ?? {}),
              ...pending,
            },
          },
        };
      });
    }, 240);
  }, [locale]);

  useEffect(() => {
    return () => {
      if (panelLayoutSaveTimerRef.current) {
        clearTimeout(panelLayoutSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (autoSaveTimerRef.current) {
        clearTimeout(autoSaveTimerRef.current);
      }
    };
  }, []);

  useEffect(() => {
    return () => {
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  useEffect(() => {
    return () => {
      if (selectedFilePdfUrl) {
        URL.revokeObjectURL(selectedFilePdfUrl);
      }
    };
  }, [selectedFilePdfUrl]);

  useEffect(() => {
    setPdfUrl((prev) => {
      if (prev) {
        URL.revokeObjectURL(prev);
      }
      return null;
    });
    setCompiledPdfBytes(null);
  }, [activeProjectId]);

  useEffect(() => {
    if (!settings) {
      return;
    }
    const hashPayload = JSON.stringify({
      settings,
      activeProjectId,
      draftApiKeys: Object.keys(draftModelApiKeys)
        .sort()
        .reduce<Record<string, string>>((acc, key) => {
          acc[key] = draftModelApiKeys[key];
          return acc;
        }, {}),
    });
    if (!autoSaveReadyRef.current) {
      autoSaveReadyRef.current = true;
      lastAutoSavedHashRef.current = hashPayload;
      return;
    }
    if (hashPayload === lastAutoSavedHashRef.current) {
      return;
    }
    if (autoSaveTimerRef.current) {
      clearTimeout(autoSaveTimerRef.current);
    }
    autoSaveTimerRef.current = setTimeout(() => {
      persistSettings(settings)
        .then((updated) => {
          lastAutoSavedHashRef.current = JSON.stringify({
            settings: updated,
            activeProjectId: updated.activeProjectId ?? activeProjectId,
            draftApiKeys: {},
          });
        })
        .catch((error) => {
          setToast({ type: "error", message: String(error) });
        });
    }, 640);
  }, [activeProjectId, draftModelApiKeys, persistSettings, setToast, settings]);

  const {
    handleWindowControl,
    handleInitProjectFromFolder,
    handleSaveFile,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    handleRunAgent,
    handleLocaleChange,
    handleThemeModeChange,
    handleProjectSearch,
    handleProjectSearchSelect,
    handleBusyTexCachePolicyChange,
    handleProtocolPing,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
    requestFsAction,
    confirmDelete,
    handleGitAction,
    handleGitInstallerDownloadStart,
    handleGitInstallerCancel,
    handleGitRunInstaller,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
  } = useAppHandlers({
    isTauriRuntime,
    t,
    locale,
    activeProjectId,
    selectedFile,
    fileList,
    editorContent,
    pdfUrl,
    compiledPdfBytes,
    agentPrompt,
    windowActionBusy,
    settings,
    projectSearchQuery,
    gitDownloadTaskId,
    gitInstallerLaunched,
    deleteIntent,
    deleteDontAskAgain,
    setBusy,
    setTree,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setProjects,
    setActiveProjectId,
    setSettings,
    setToast,
    setCompileDiagnostics,
    setLastCompileFailed,
    setPdfUrl,
    setCompiledPdfBytes,
    setAgentMessages,
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setWindowActionBusy,
    setIsMaximized,
    setProjectSearchResults,
    setProjectSearchSearched,
    setProjectSearchBusy,
    setPage,
    setPendingRevealLine,
    setBusytexCacheInfo,
    setDeleteIntent,
    setDeleteDontAskAgain,
    setThemeTransition,
    setGitDownloadTaskId,
    setGitDownloadState,
    setGitInstallerLaunched,
    setSuppressAutoGitInstall,
    editorRef,
    loadProjectData,
    persistSettings,
    refreshGitWorkspace,
    setLocale,
    upsertProject,
  });

  const getCachedTextContent = useCallback((relativePath: string) => {
    if (isPdfPath(relativePath)) {
      return null;
    }
    const cached = workingContentByPathRef.current[relativePath];
    return typeof cached === "string" ? cached : null;
  }, []);

  const handleTextFileLoaded = useCallback((relativePath: string, content: string) => {
    savedContentByPathRef.current[relativePath] = content;
    if (!dirtyByPathRef.current[relativePath]) {
      workingContentByPathRef.current[relativePath] = content;
    }
  }, []);

  useAppEffects({
    t,
    isTauriRuntime,
    activeProjectId,
    selectedFile,
    pendingRevealLine,
    page,
    cursor,
    toast,
    gitDownloadTaskId,
    gitInstallerLaunched,
    suppressAutoGitInstall,
    gitAvailabilityInstalled: gitAvailability?.installed,
    settingsTheme: settings?.uiPrefs?.theme as ThemeMode | undefined,
    busytexCachePolicy: settings?.uiPrefs?.busytexCachePolicy as
      | "install-first"
      | "appdata-only"
      | undefined,
    loadProjectData,
    refreshGitWorkspace,
    handleGitRunInstaller,
    handleGitInstallerDownloadStart,
    setStatus,
    setProjects,
    setSettings,
    setRuntimeInfo,
    setLocale,
    setActiveProjectId,
    setTree,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setEditorContent,
    setSelectedFilePdfUrl,
    setToast,
    setProjectSearchQuery,
    setProjectSearchResults,
    setProjectSearchSearched,
    setEvents,
    setCursor,
    setBusytexCacheInfo,
    resizeFrameRef,
    setIsMaximized,
    editorRef,
    setPendingRevealLine,
    setGitDownloadState,
    setGitDownloadTaskId,
    setSuppressAutoGitInstall,
    getCachedTextContent,
    onTextFileLoaded: handleTextFileLoaded,
  });

  const handleSaveActiveFile = useCallback(async () => {
    const ok = await handleSaveFile();
    if (ok && selectedFile && !isPdfPath(selectedFile)) {
      markPathSaved(selectedFile, editorContent);
    }
    return ok;
  }, [editorContent, handleSaveFile, markPathSaved, selectedFile]);

  const handleWindowControlWithGuard = useCallback((action: "minimize" | "toggle" | "close") => {
    if (action !== "close") {
      void handleWindowControl(action);
      return;
    }
    requestUnsavedGuard(
      "closeWindow",
      editorTabsRef.current.map((tab) => tab.path),
      async () => {
        closeGuardUnlockedRef.current = true;
        await handleWindowControl("close");
        window.setTimeout(() => {
          closeGuardUnlockedRef.current = false;
        }, 400);
      },
    );
  }, [handleWindowControl, requestUnsavedGuard]);

  const handleInitProjectFromFolderWithGuard = useCallback(() => {
    requestUnsavedGuard(
      "switchProject",
      editorTabsRef.current.map((tab) => tab.path),
      async () => {
        resetEditorSession();
        await handleInitProjectFromFolder();
      },
    );
  }, [handleInitProjectFromFolder, requestUnsavedGuard, resetEditorSession]);

  useWorkspaceShortcuts({
    handleEditorUndo,
    handleEditorRedo,
    handleSaveFile: () => {
      void handleSaveActiveFile();
    },
    handleCompile,
    handleExportCompiledPdf,
  });

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    let unlisten: (() => void) | undefined;
    getCurrentWindow()
      .onCloseRequested((event) => {
        if (closeGuardUnlockedRef.current) {
          return;
        }
        const candidatePaths = editorTabsRef.current.map((tab) => tab.path);
        const dirtyPaths = collectDirtyPaths(candidatePaths);
        if (dirtyPaths.length === 0) {
          return;
        }
        event.preventDefault();
        requestUnsavedGuard("closeWindow", candidatePaths, async () => {
          closeGuardUnlockedRef.current = true;
          await handleWindowControl("close");
        });
      })
      .then((off) => {
        unlisten = off;
      })
      .catch(() => undefined);
    return () => {
      unlisten?.();
    };
  }, [collectDirtyPaths, handleWindowControl, isTauriRuntime, requestUnsavedGuard]);

  useEffect(() => {
    if (!selectedFile || isPdfPath(selectedFile)) {
      return;
    }
    workingContentByPathRef.current[selectedFile] = editorContent;
    const saved = savedContentByPathRef.current[selectedFile];
    if (typeof saved === "string") {
      const dirty = editorContent !== saved;
      setDirtyByPath((prev) => {
        const wasDirty = Boolean(prev[selectedFile]);
        if (dirty === wasDirty) {
          return prev;
        }
        const next = { ...prev };
        if (dirty) {
          next[selectedFile] = true;
        } else {
          delete next[selectedFile];
        }
        return next;
      });
    }
  }, [editorContent, selectedFile]);

  const activateTabById = useCallback((tabId: string) => {
    const target = editorTabsRef.current.find((tab) => tab.id === tabId);
    if (!target) {
      return;
    }
    setEditorTabs((prev) =>
      prev.map((tab) => (tab.id === tabId ? { ...tab, lastAccessed: Date.now() } : tab)),
    );
    setActiveTabId(tabId);
    setSelectedFile(target.path);
  }, []);

  const openWorkspaceFile = useCallback((path: string, mode: "preview" | "pinned" = "preview") => {
    if (!path || !fileSet.has(path)) {
      return;
    }
    const tabs = editorTabsRef.current;
    const existing = tabs.find((tab) => tab.path === path);
    if (existing) {
      if (mode === "pinned" && (!existing.pinned || existing.preview)) {
        setEditorTabs((prev) =>
          prev.map((tab) =>
            tab.id === existing.id
              ? { ...tab, pinned: true, preview: false, lastAccessed: Date.now() }
              : tab,
          ),
        );
        if (previewTabIdRef.current === existing.id) {
          setPreviewTabId(null);
        }
      }
      activateTabById(existing.id);
      return;
    }

    const openTab = () => {
      let nextTabs = editorTabsRef.current;
      if (mode === "preview") {
        const currentPreviewId = previewTabIdRef.current;
        const currentPreview = currentPreviewId
          ? nextTabs.find((tab) => tab.id === currentPreviewId)
          : null;
        if (currentPreview && !currentPreview.pinned && currentPreview.path !== path) {
          nextTabs = nextTabs.filter((tab) => tab.id !== currentPreview.id);
        }
      }
      const newTab = buildEditorTab(path, mode === "pinned", mode === "preview");
      setEditorTabs([...nextTabs, newTab]);
      setActiveTabId(newTab.id);
      setSelectedFile(path);
      setPreviewTabId(mode === "preview" ? newTab.id : previewTabIdRef.current);
    };

    if (mode === "preview") {
      const currentPreviewId = previewTabIdRef.current;
      const currentPreview = currentPreviewId
        ? tabs.find((tab) => tab.id === currentPreviewId)
        : null;
      if (currentPreview && !currentPreview.pinned && currentPreview.path !== path) {
        requestUnsavedGuard("switchFile", [currentPreview.path], openTab);
        return;
      }
    }
    openTab();
  }, [activateTabById, fileSet, requestUnsavedGuard]);

  const handleTabSelect = useCallback((tabId: string) => {
    activateTabById(tabId);
  }, [activateTabById]);

  const handleTabPin = useCallback((tabId: string) => {
    setEditorTabs((prev) =>
      prev.map((tab) =>
        tab.id === tabId
          ? { ...tab, pinned: true, preview: false, lastAccessed: Date.now() }
          : tab,
      ),
    );
    if (previewTabIdRef.current === tabId) {
      setPreviewTabId(null);
    }
  }, []);

  const handleTabClose = useCallback((tabId: string) => {
    const tab = editorTabsRef.current.find((item) => item.id === tabId);
    if (!tab) {
      return;
    }
    requestUnsavedGuard("closeTabs", [tab.path], () => closeTabsNow([tabId]));
  }, [closeTabsNow, requestUnsavedGuard]);

  const handleTabCloseAction = useCallback((action: CloseTabsAction, referenceTabId: string) => {
    const tabIds = getTabIdsByAction(
      editorTabsRef.current,
      referenceTabId,
      action,
      dirtyByPathRef.current,
    );
    if (tabIds.length === 0) {
      return;
    }
    const candidatePaths = editorTabsRef.current
      .filter((tab) => tabIds.includes(tab.id))
      .map((tab) => tab.path);
    requestUnsavedGuard("closeTabs", candidatePaths, () => closeTabsNow(tabIds));
  }, [closeTabsNow, requestUnsavedGuard]);

  const handleSelectWorkspacePath = useCallback((path: string | null) => {
    if (!path) {
      return;
    }
    openWorkspaceFile(path, "preview");
  }, [openWorkspaceFile]);

  useEffect(() => {
    if (!selectedFile || !fileSet.has(selectedFile)) {
      return;
    }
    const existing = editorTabsRef.current.find((tab) => tab.path === selectedFile);
    if (existing) {
      if (activeTabIdRef.current !== existing.id) {
        setActiveTabId(existing.id);
      }
      return;
    }
    const tab = buildEditorTab(selectedFile, true, false);
    setEditorTabs((prev) => [...prev, tab]);
    setActiveTabId(tab.id);
  }, [fileSet, selectedFile]);

  const handleProjectChange = useCallback((projectId: string | null) => {
    const proceed = async () => {
      if (!projectId) {
        setIntegrityIssue(null);
        resetEditorSession();
        setActiveProjectId(null);
        return;
      }
      if (projectId === activeProjectIdRef.current) {
        return;
      }
      if (!integrityCheckedRef.current.has(projectId)) {
        try {
          const integrity = await projectIntegrityStatus(projectId);
          if (integrity.missingRequired.length > 0) {
            setIntegrityIssue({
              projectId,
              missingRequired: integrity.missingRequired,
            });
            return;
          }
          integrityCheckedRef.current.add(projectId);
        } catch (error) {
          setToast({ type: "error", message: String(error) });
          return;
        }
      }
      setIntegrityIssue(null);
      resetEditorSession();
      setActiveProjectId(projectId);
    };

    if (projectId === activeProjectIdRef.current) {
      return;
    }
    requestUnsavedGuard(
      "switchProject",
      editorTabsRef.current.map((tab) => tab.path),
      proceed,
    );
  }, [requestUnsavedGuard, resetEditorSession, setToast]);

  const handleIntegrityRepair = useCallback(async () => {
    if (!integrityIssue) {
      return;
    }
    setBusy(true);
    try {
      const result = await projectIntegrityRepair(integrityIssue.projectId);
      if (result.missingRequired.length > 0) {
        setToast({ type: "error", message: t("toast.integrityRepairFailed") });
        return;
      }
      integrityCheckedRef.current.add(integrityIssue.projectId);
      setIntegrityIssue(null);
      if (activeProjectIdRef.current === integrityIssue.projectId) {
        await loadProjectData(integrityIssue.projectId);
      } else {
        setActiveProjectId(integrityIssue.projectId);
      }
      setToast({ type: "info", message: t("toast.integrityRepaired") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [integrityIssue, loadProjectData, t]);

  const handleIntegrityCancel = useCallback(() => {
    const fallback = lastLoadedProjectIdRef.current;
    setIntegrityIssue(null);
    if (!fallback) {
      setActiveProjectId(null);
      return;
    }
    if (activeProjectIdRef.current !== fallback) {
      setActiveProjectId(fallback);
    }
  }, []);

  const sessionLogName = useMemo(() => {
    if (!runtimeInfo?.sessionLogFile) {
      return "-";
    }
    const parts = runtimeInfo.sessionLogFile.split(/[\\/]/);
    return parts[parts.length - 1] || runtimeInfo.sessionLogFile;
  }, [runtimeInfo?.sessionLogFile]);

  const compileErrorLine = useMemo(
    () => (lastCompileFailed && compileDiagnostics.length > 0 ? compileDiagnostics[0] : null),
    [compileDiagnostics, lastCompileFailed],
  );

  const panelLayout = settings?.uiPrefs?.panelLayout ?? DEFAULT_PANEL_LAYOUT;
  const shellLayout = clampLayout(panelLayout.shell, DEFAULT_PANEL_LAYOUT.shell!);
  const latexLayout = clampLayout(panelLayout.latex, DEFAULT_PANEL_LAYOUT.latex!);
  const analysisLayout = clampLayout(panelLayout.analysis, DEFAULT_PANEL_LAYOUT.analysis!);
  const libraryLayout = clampLayout(panelLayout.library, DEFAULT_PANEL_LAYOUT.library!);

  const activeModelCatalog = settings?.modelCatalog ?? [];

  const handleTestModel = useCallback(async (modelId: string) => {
    setModelTestBusy(true);
    setModelTestActiveId(modelId);
    try {
      const result = await testModel(modelId);
      setModelTestById((prev) => ({ ...prev, [modelId]: result }));
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setModelTestById((prev) => ({
        ...prev,
        [modelId]: {
          modelId,
          ok: false,
          message,
        },
      }));
    } finally {
      setModelTestActiveId(null);
      setModelTestBusy(false);
    }
  }, []);

  const handleTestAllModels = useCallback(async () => {
    const catalog = settings?.modelCatalog ?? [];
    if (catalog.length === 0) {
      return;
    }
    setModelTestBusy(true);
    try {
      for (const model of catalog) {
        setModelTestActiveId(model.id);
        try {
          const result = await testModel(model.id);
          setModelTestById((prev) => ({ ...prev, [model.id]: result }));
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          setModelTestById((prev) => ({
            ...prev,
            [model.id]: {
              modelId: model.id,
              ok: false,
              message,
            },
          }));
        }
      }
    } finally {
      setModelTestActiveId(null);
      setModelTestBusy(false);
    }
  }, [settings?.modelCatalog]);

  const openModelModal = useCallback((mode: "create" | "edit" = "create", model: ModelCatalogItem | null = null) => {
    setModelModalMode(mode);
    setModelModalInitial(model);
    setModelModalOpen(true);
  }, []);

  const handleGenerateGitSummary = useCallback(async (includedPaths: string[]) => {
    if (!activeProjectId) {
      throw new Error("No active project");
    }
    const files = Array.from(
      new Set(
        includedPaths
          .map((item) => item.trim())
          .filter((item) => item.length > 0),
      ),
    ).slice(0, 24);
    if (files.length === 0) {
      return "";
    }

    const patches = await Promise.all(
      files.map(async (path) => {
        try {
          const diff = await gitDiffFile(activeProjectId, path, true, 2);
          const lines = diff.hunks
            .flatMap((hunk) => hunk.lines)
            .map((line) => line.text)
            .join("\n");
          return lines.trim().length > 0 ? `### ${path}\n${lines}` : "";
        } catch {
          return "";
        }
      }),
    );

    const joinedPatch = patches.filter((item) => item.length > 0).join("\n\n").slice(0, 48_000);
    const prompt = [
      "Summarize the staged Git changes and return a commit message proposal.",
      "Output format:",
      "TITLE: <single line, <=72 chars>",
      "BODY:",
      "- <bullet 1>",
      "- <bullet 2>",
      "Use concise, technical wording.",
      "",
      `Files: ${files.join(", ")}`,
      "",
      "Patch:",
      joinedPatch || "(empty patch text)",
    ].join("\n");

    const result = await runAgent({
      projectId: activeProjectId,
      role: "git_summary",
      prompt,
      contextRefs: files,
    });

    const output = result.output?.trim() ?? "";
    if (!output) {
      return "";
    }
    const titleMatch = output.match(/^TITLE:\s*(.+)$/im);
    if (titleMatch?.[1]) {
      return titleMatch[1].trim();
    }
    return output.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? "";
  }, [activeProjectId]);

  const settingsPanel = (
    <SettingsPanel
      settings={settings}
      activeProjectId={activeProjectId}
      locale={locale}
      busy={busy}
      settingsSection={settingsSection}
      busytexCacheInfo={busytexCacheInfo}
      runtimeInfo={runtimeInfo}
      runtimeLogs={runtimeLogs}
      runtimeLogLoading={runtimeLogLoading}
      sessionLogName={sessionLogName}
      activeModelCatalog={activeModelCatalog}
      modelTestBusy={modelTestBusy}
      modelTestActiveId={modelTestActiveId}
      modelTestById={modelTestById}
      onSettingsSectionChange={setSettingsSection}
      onLocaleChange={handleLocaleChange}
      onThemeModeChange={handleThemeModeChange}
      onBusyTexCachePolicyChange={(policy) => handleBusyTexCachePolicyChange(policy)}
      onOpenModelModal={openModelModal}
      onOpenLogViewer={() => {
        setRuntimeLogLoading(true);
        runtimeLogRead({ limit: 1600 })
          .then((response) => {
            setRuntimeLogs(response.entries);
          })
          .catch((error) => setToast({ type: "error", message: String(error) }))
          .finally(() => setRuntimeLogLoading(false));
      }}
      onClearCurrentLog={async () => {
        try {
          await runtimeLogClearCurrentSession("CLEAR_CURRENT_SESSION");
          const refreshed = await runtimeLogRead({ limit: 1600 });
          setRuntimeLogs(refreshed.entries);
        } catch (error) {
          setToast({ type: "error", message: String(error) });
        }
      }}
      onTestModel={(modelId) => void handleTestModel(modelId)}
      onTestAllModels={() => void handleTestAllModels()}
      setSettings={setSettings}
      t={t}
    />
  );

  const gitPanel = activeProjectId ? (
    <GitWorkspace
      status={gitStatusState}
      branches={gitBranchesState}
      commits={gitCommits}
      availability={gitAvailability}
      downloadStatus={gitDownloadState}
      initProgress={gitInitProgress}
      busy={busy}
      onRefresh={() =>
        refreshGitWorkspace().catch((error) => setToast({ type: "error", message: String(error) }))
      }
      onFetch={() => handleGitAction(async () => gitFetch(activeProjectId))}
      onPull={() => handleGitAction(async () => gitPull(activeProjectId))}
      onPush={() => handleGitAction(async () => gitPush(activeProjectId))}
      onCheckout={(branch, create) => handleGitAction(async () => gitCheckout(activeProjectId, branch, create))}
      onStage={(paths) => handleGitAction(async () => gitStage(activeProjectId, paths))}
      onUnstage={(paths) => handleGitAction(async () => gitUnstage(activeProjectId, paths))}
      onCommit={(message) => handleGitAction(async () => gitCommit(activeProjectId, message))}
      onGenerateSummary={async (includedPaths) => {
        try {
          return await handleGenerateGitSummary(includedPaths);
        } catch (error) {
          setToast({ type: "error", message: String(error) });
          return "";
        }
      }}
      onInitRepo={async () => {
        setBusy(true);
        setGitInitProgress({ phase: "checking", message: t("git.init.checking") });
        try {
          const current = await gitStatus(activeProjectId).catch(() => null);
          if (!current?.isRepo) {
            setGitInitProgress({ phase: "initializing", message: t("git.init.initializing") });
            await gitInitRepo(activeProjectId);
          }
          setGitInitProgress({ phase: "refreshing", message: t("git.init.refreshing") });
          await refreshGitWorkspace(activeProjectId);
          setGitInitProgress({ phase: "done", message: t("git.init.done") });
          setToast({ type: "info", message: t("git.init.done") });
          window.setTimeout(() => {
            setGitInitProgress((prev) =>
              prev?.phase === "done" ? { phase: "idle", message: "" } : prev,
            );
          }, 1400);
        } catch (error) {
          setGitInitProgress({ phase: "error", message: String(error) });
          setToast({ type: "error", message: String(error) });
        } finally {
          setBusy(false);
        }
      }}
      onLoadDiff={(path, staged, revision) => gitDiffFile(activeProjectId, path, staged, 3, revision)}
      onOpenFile={(path) => {
        openWorkspaceFile(path, "pinned");
      }}
      onStartGitInstall={handleGitInstallerDownloadStart}
      onCancelDownload={handleGitInstallerCancel}
      onRunInstaller={handleGitRunInstaller}
      t={t}
    />
  ) : null;

  return (
    <div
      className={`relative isolate flex h-screen w-screen flex-col overflow-hidden bg-slate-100 ${windowActionBusy ? "suppress-motion" : ""}`}
    >
      <div className="relative z-10 flex h-full w-full flex-col">
        <AppTopbar
          status={status}
          logoMark={logoMark}
          projects={projects}
          activeProjectId={activeProjectId}
          busy={busy}
          isTauriRuntime={isTauriRuntime}
          windowActionBusy={windowActionBusy}
          isMaximized={isMaximized}
          projectSearchQuery={projectSearchQuery}
          projectSearchBusy={projectSearchBusy}
          projectSearchSearched={projectSearchSearched}
          projectSearchResults={projectSearchResults}
          onProjectChange={handleProjectChange}
          onProjectSearchQueryChange={setProjectSearchQuery}
          onProjectSearch={handleProjectSearch}
          onProjectSearchSelect={handleProjectSearchSelect}
          onProjectSearchClear={() => {
            setProjectSearchQuery("");
            setProjectSearchResults([]);
            setProjectSearchSearched(false);
          }}
          onOpenFolder={handleInitProjectFromFolderWithGuard}
          onWindowControl={handleWindowControlWithGuard}
          t={t}
        />

        <AppWorkspaceShell
          page={page}
          pageRailItems={pageRailItems}
          activeProjectId={activeProjectId}
          busy={busy}
          shellLayout={shellLayout}
          latexLayout={latexLayout}
          analysisLayout={analysisLayout}
          libraryLayout={libraryLayout}
          previewDefaultZoom={settings?.uiPrefs?.previewDefaultZoom ?? 1}
          tree={tree}
          libraryTree={libraryTree}
          selectedFile={selectedFile}
          selectedLibraryPath={selectedLibraryPath}
          editorContent={editorContent}
          editorTabs={editorTabs}
          activeTabId={activeTabId}
          dirtyByPath={dirtyByPath}
          compiledPdfUrl={pdfUrl}
          selectedFilePdfUrl={selectedFilePdfUrl}
          compileErrorLine={compileErrorLine}
          compileDiagnostics={compileDiagnostics}
          agentCollapsed={agentCollapsed}
          agentPhase={agentPhase}
          agentStatusKey={agentStatusKey}
          agentPrompt={agentPrompt}
          agentMessages={agentMessages}
          shellMin={SHELL_MIN}
          settingsPanel={settingsPanel}
          gitPanel={gitPanel}
          onPageChange={setPage}
          onSelectFile={handleSelectWorkspacePath}
          onSelectLibraryPath={setSelectedLibraryPath}
          onEditorChange={setEditorContent}
          onTabSelect={handleTabSelect}
          onTabClose={handleTabClose}
          onTabCloseAction={handleTabCloseAction}
          onTabPin={handleTabPin}
          onEditorMount={(editor) => {
            editorRef.current = editor;
          }}
          onAgentPromptChange={setAgentPrompt}
          onAgentToggle={() => setAgentCollapsed((prev) => !prev)}
          onAgentRun={handleRunAgent}
          onOpenFolder={handleInitProjectFromFolderWithGuard}
          onSaveFile={handleSaveActiveFile}
          onCompile={handleCompile}
          onExportPdf={handleExportCompiledPdf}
          onEditorUndo={handleEditorUndo}
          onEditorRedo={handleEditorRedo}
          onOpenLogs={(tab) => {
            setLogsTab(tab);
            setOverlay("logs");
          }}
          onLibraryRescan={handleLibraryRescan}
        onLibraryImportPdf={handleLibraryImportPdf}
        onLibraryImportLink={handleLibraryImportLink}
        onWorkspaceRevealInSystem={handleWorkspaceRevealInSystem}
        onWorkspaceOpenTerminal={handleWorkspaceOpenTerminal}
        onSavePanelLayout={(panel, layout) => savePanelLayout(panel, layout)}
          onFsAction={(scope, action, path, targetPath, content) =>
            requestFsAction(scope, action, path, targetPath, content)
          }
          t={t}
        />
      </div>

      <AppOverlays
        overlay={overlay}
        logsTab={logsTab}
        events={events}
        compileDiagnostics={compileDiagnostics}
        modelModalOpen={modelModalOpen}
        modelModalMode={modelModalMode}
        modelModalInitial={modelModalInitial}
        settings={settings}
        deleteIntent={deleteIntent}
        deleteDontAskAgain={deleteDontAskAgain}
        integrityIssue={integrityIssue}
        themeTransition={themeTransition}
        toast={toast}
        onOverlayClose={() => setOverlay(null)}
        onLogsTabChange={setLogsTab}
        onModelModalClose={() => {
          setModelModalOpen(false);
          setModelModalInitial(null);
          setModelModalMode("create");
        }}
        onModelSubmit={({ protocol, model, modelApiKey, modelApiKeyAction }) =>
          setSettings((prev) => {
            if (!prev) {
              return prev;
            }
            const nextProtocols = protocol.isNew
              ? [
                  ...prev.modelProtocols,
                  {
                    id: protocol.id,
                    displayName: protocol.displayName,
                    baseUrl: protocol.baseUrl,
                    apiKeySet: Boolean(modelApiKey?.trim()),
                  },
                ]
              : prev.modelProtocols.map((item) =>
                  item.id === protocol.id
                    ? {
                        ...item,
                        baseUrl: protocol.baseUrl,
                        apiKeySet: item.apiKeySet || Boolean(modelApiKey?.trim()),
                      }
                    : item,
                );
            setDraftModelApiKeys((current) => {
              const next = { ...current };
              if (modelApiKeyAction === "set") {
                next[model.id] = modelApiKey ?? "";
              } else if (modelApiKeyAction === "clear") {
                next[model.id] = "";
              } else {
                delete next[model.id];
              }
              return next;
            });
            const nextCatalog = prev.modelCatalog.some((item) => item.id === model.id)
              ? prev.modelCatalog.map((item) => (item.id === model.id ? model : item))
              : [...prev.modelCatalog, model];
            return {
              ...prev,
              modelProtocols: nextProtocols,
              modelCatalog: nextCatalog,
            };
          })
        }
        onProtocolPing={handleProtocolPing}
        onDeleteCancel={() => setDeleteIntent(null)}
        onDeleteConfirm={confirmDelete}
        onDeleteDontAskChange={setDeleteDontAskAgain}
        onIntegrityCancel={handleIntegrityCancel}
        onIntegrityRepair={handleIntegrityRepair}
        t={t}
      />

      <UnsavedChangesDialog
        open={unsavedDialogOpen}
        intent={unsavedDialogIntent}
        items={unsavedDialogItems}
        busy={unsavedDialogBusy}
        onSaveAndContinue={() => {
          void handleUnsavedDialogSaveAndContinue();
        }}
        onDiscardAndContinue={() => {
          void handleUnsavedDialogDiscardAndContinue();
        }}
        onCancel={handleUnsavedDialogCancel}
        t={t}
      />
    </div>
  );
}
