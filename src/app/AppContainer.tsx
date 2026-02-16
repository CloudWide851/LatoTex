import { isTauri } from "@tauri-apps/api/core";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { GitWorkspace } from "./components/GitWorkspace";
import { AppOverlays } from "./components/AppOverlays";
import { AppTopbar } from "./components/AppTopbar";
import { AppWorkspaceShell } from "./components/AppWorkspaceShell";
import { SettingsPanel } from "./components/SettingsPanel";
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
  updateSettings,
} from "../shared/api/desktop";
import type {
  AppSettings,
  BusyTexCacheInfo,
  GitAvailability,
  GitBranchInfo,
  GitCommitInfo,
  GitDownloadStatus,
  GitInitProgress,
  GitStatus,
  PanelLayoutPrefs,
  ProjectSearchHit,
  ProjectSummary,
  ResourceNode,
  RuntimeLogInfo,
  SwarmEvent,
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
import { useAppHandlers } from "./hooks/useAppHandlers";
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
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [settingsSection, setSettingsSection] = useState<SettingsSection>("general");
  const [draftApiKeys, setDraftApiKeys] = useState<Record<string, string>>({});
  const [projectSearchQuery, setProjectSearchQuery] = useState("");
  const [projectSearchResults, setProjectSearchResults] = useState<ProjectSearchHit[]>([]);
  const [projectSearchBusy, setProjectSearchBusy] = useState(false);
  const [projectSearchSearched, setProjectSearchSearched] = useState(false);
  const [busytexCacheInfo, setBusytexCacheInfo] = useState<BusyTexCacheInfo | null>(null);
  const [busy, setBusy] = useState(false);
  const [runtimeInfo, setRuntimeInfo] = useState<RuntimeLogInfo | null>(null);
  const [isMaximized, setIsMaximized] = useState(false);
  const [windowActionBusy, setWindowActionBusy] = useState(false);
  const [overlay, setOverlay] = useState<OverlayType>(null);
  const [logsTab, setLogsTab] = useState<LogTab>("events");
  const [modelModalOpen, setModelModalOpen] = useState(false);
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
  const resizeFrameRef = useRef<number | null>(null);
  const editorRef = useRef<any>(null);
  const activeProjectIdRef = useRef<string | null>(null);
  const panelLayoutSaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingPanelLayoutRef = useRef<Partial<PanelLayoutPrefs>>({});
  const isTauriRuntime = isTauri();
  activeProjectIdRef.current = activeProjectId;
  const fileList = useMemo(() => flattenFiles(tree), [tree]);
  const pageRailItems = useMemo(
    () => PAGE_ITEMS.map((item) => ({ id: item.id, icon: item.icon, label: t(item.key) })),
    [t],
  );

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
    const snapshot = await openProject(projectId);
    setTree(snapshot.tree);
    setSelectedFile(snapshot.mainFile);
    const [papers] = await Promise.all([getLibraryTree(projectId)]);
    setLibraryTree(papers);
    setSelectedLibraryPath(null);
    await refreshGitWorkspace(projectId);
  }, [refreshGitWorkspace]);

  const persistSettings = useCallback(async (nextSettings: AppSettings) => {
    const updated = await updateSettings({
      activeProjectId: nextSettings.activeProjectId ?? activeProjectId,
      modelProtocols: nextSettings.modelProtocols.map((protocol) => ({
        id: protocol.id,
        displayName: protocol.displayName,
        baseUrl: protocol.baseUrl,
        apiKey: draftApiKeys[protocol.id],
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
        panelLayout: nextSettings.uiPrefs?.panelLayout,
      },
    });
    setSettings(updated);
    setDraftApiKeys({});
    return updated;
  }, [activeProjectId, draftApiKeys, locale]);

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
      if (pdfUrl) {
        URL.revokeObjectURL(pdfUrl);
      }
    };
  }, [pdfUrl]);

  const {
    handleWindowControl,
    handleInitProjectFromFolder,
    handleSaveFile,
    handleCompile,
    handleEditorUndo,
    handleEditorRedo,
    handleRunAgent,
    handleSaveSettings,
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
  });

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

  const settingsPanel = (
    <SettingsPanel
      settings={settings}
      activeProjectId={activeProjectId}
      locale={locale}
      busy={busy}
      settingsSection={settingsSection}
      busytexCacheInfo={busytexCacheInfo}
      runtimeInfo={runtimeInfo}
      sessionLogName={sessionLogName}
      activeModelCatalog={activeModelCatalog}
      onSettingsSectionChange={setSettingsSection}
      onSaveSettings={handleSaveSettings}
      onLocaleChange={handleLocaleChange}
      onThemeModeChange={handleThemeModeChange}
      onBusyTexCachePolicyChange={(policy) => handleBusyTexCachePolicyChange(policy)}
      onOpenModelModal={() => setModelModalOpen(true)}
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
      onLoadDiff={(path, staged) => gitDiffFile(activeProjectId, path, staged, 3)}
      onOpenFile={(path) => {
        setSelectedFile(path);
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
          onProjectChange={setActiveProjectId}
          onProjectSearchQueryChange={setProjectSearchQuery}
          onProjectSearch={handleProjectSearch}
          onProjectSearchSelect={handleProjectSearchSelect}
          onProjectSearchClear={() => {
            setProjectSearchQuery("");
            setProjectSearchResults([]);
            setProjectSearchSearched(false);
          }}
          onOpenFolder={handleInitProjectFromFolder}
          onWindowControl={handleWindowControl}
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
          tree={tree}
          libraryTree={libraryTree}
          selectedFile={selectedFile}
          selectedLibraryPath={selectedLibraryPath}
          editorContent={editorContent}
          pdfUrl={pdfUrl}
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
          onSelectFile={setSelectedFile}
          onSelectLibraryPath={setSelectedLibraryPath}
          onEditorChange={setEditorContent}
          onEditorMount={(editor) => {
            editorRef.current = editor;
          }}
          onAgentPromptChange={setAgentPrompt}
          onAgentToggle={() => setAgentCollapsed((prev) => !prev)}
          onAgentRun={handleRunAgent}
          onOpenFolder={handleInitProjectFromFolder}
          onSaveFile={handleSaveFile}
          onCompile={handleCompile}
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
        settings={settings}
        deleteIntent={deleteIntent}
        deleteDontAskAgain={deleteDontAskAgain}
        themeTransition={themeTransition}
        toast={toast}
        onOverlayClose={() => setOverlay(null)}
        onLogsTabChange={setLogsTab}
        onModelModalClose={() => setModelModalOpen(false)}
        onModelSubmit={({ protocol, model }) =>
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
                    apiKeySet: Boolean(protocol.apiKey?.trim()),
                  },
                ]
              : prev.modelProtocols.map((item) =>
                  item.id === protocol.id
                    ? {
                        ...item,
                        baseUrl: protocol.baseUrl,
                        apiKeySet: item.apiKeySet || Boolean(protocol.apiKey?.trim()),
                      }
                    : item,
                );
            if (protocol.apiKey?.trim()) {
              setDraftApiKeys((current) => ({ ...current, [protocol.id]: protocol.apiKey ?? "" }));
            }
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
        t={t}
      />
    </div>
  );
}
