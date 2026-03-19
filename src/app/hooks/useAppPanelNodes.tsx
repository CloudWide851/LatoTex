import { useCallback, useEffect, useMemo, useState } from "react";
import {
  gitCommitFiles,
  gitCheckout,
  gitCommit,
  gitDiffFile,
  gitFetch,
  gitInitRepo,
  gitPull,
  gitPush,
  gitStage,
  gitStatus,
  gitUnstage,
  runtimeLogClearCurrentSession,
  runtimeLogListSessions,
  runtimeLogRead,
} from "../../shared/api/desktop";
import { clampLayout, DEFAULT_PANEL_LAYOUT } from "../app-config";
import { GitWorkspace } from "../components/GitWorkspace";
import { AnalysisWorkspace } from "../components/analysis/AnalysisWorkspace";
import { SettingsPanel } from "../components/SettingsPanel";

export function useAppPanelNodes(params: any) {
  const {
    settings,
    locale,
    page,
    t,
    busy,
    activeProjectId,
    settingsSection,
    setSettingsSection,
    busytexCacheInfo,
    runtimeInfo,
    runtimeLogs,
    runtimeLogLoading,
    modelTestBusy,
    modelTestActiveId,
    modelTestById,
    handleLocaleChange,
    handleThemeModeChange,
    handleBusyTexCachePolicyChange,
    openModelModal,
    setRuntimeLogLoading,
    setRuntimeLogs,
    setToast,
    handleTestModel,
    handleTestAllModels,
    setSettings,
    analysisWorkspace,
    gitStatusState,
    gitBranchesState,
    gitCommits,
    gitAvailability,
    gitDownloadState,
    gitInitProgress,
    refreshGitWorkspace,
    handleGitAction,
    handleGenerateGitSummary,
    setBusy,
    setGitInitProgress,
    handleGitInstallerDownloadStart,
    handleGitInstallerCancel,
    handleGitRunInstaller,
    openWorkspaceFile,
  } = params;

  const sessionLogName = useMemo(() => {
    if (!runtimeInfo?.sessionLogFile) {
      return "-";
    }
    const parts = runtimeInfo.sessionLogFile.split(/[\\/]/);
    return parts[parts.length - 1] || runtimeInfo.sessionLogFile;
  }, [runtimeInfo?.sessionLogFile]);

  const [runtimeLogSessions, setRuntimeLogSessions] = useState<any[]>([]);
  const [selectedRuntimeLogFile, setSelectedRuntimeLogFile] = useState("");

  useEffect(() => {
    if (sessionLogName === "-") {
      return;
    }
    setSelectedRuntimeLogFile((prev) => (prev.trim().length > 0 ? prev : sessionLogName));
  }, [sessionLogName]);

  const applyRuntimeLogEntries = useCallback((nextEntries: any[]) => {
    setRuntimeLogs((prev: any[]) => {
      if (prev.length === nextEntries.length && prev.length > 0) {
        const prevLast = prev[prev.length - 1];
        const nextLast = nextEntries[nextEntries.length - 1];
        const prevFirst = prev[0];
        const nextFirst = nextEntries[0];
        if (
          prevLast?.raw === nextLast?.raw &&
          prevLast?.timestamp === nextLast?.timestamp &&
          prevLast?.level === nextLast?.level &&
          prevFirst?.raw === nextFirst?.raw &&
          prevFirst?.timestamp === nextFirst?.timestamp &&
          prevFirst?.level === nextFirst?.level
        ) {
          return prev;
        }
      }
      if (prev.length === 0 && nextEntries.length === 0) {
        return prev;
      }
      return nextEntries;
    });
  }, [setRuntimeLogs]);

  const loadRuntimeLogSessions = useCallback(async (showToast: boolean) => {
    try {
      const response = await runtimeLogListSessions();
      const nextSessions = Array.isArray(response.sessions) ? response.sessions : [];
      setRuntimeLogSessions(nextSessions);
      return nextSessions;
    } catch (error) {
      if (showToast) {
        setToast({ type: "error", message: String(error) });
      }
      return [];
    }
  }, [setToast]);

  const reloadRuntimeLogs = useCallback(async (options?: {
    silent?: boolean;
    logFileName?: string;
    refreshSessions?: boolean;
  }) => {
    const silent = options?.silent ?? false;
    if (!silent && runtimeLogs.length === 0) {
      setRuntimeLogLoading(true);
    }

    let targetLogFile = "";
    try {
      let sessions = runtimeLogSessions;
      const refreshSessions = options?.refreshSessions ?? sessions.length === 0;
      if (refreshSessions) {
        sessions = await loadRuntimeLogSessions(!silent);
      }

      targetLogFile = String(options?.logFileName ?? selectedRuntimeLogFile).trim();
      if (!targetLogFile) {
        targetLogFile = String(
          sessions.find((item: any) => item?.isCurrent)?.fileName
          || (sessionLogName === "-" ? "" : sessionLogName),
        ).trim();
      }

      if (targetLogFile) {
        setSelectedRuntimeLogFile(targetLogFile);
      }

      const response = await runtimeLogRead({
        limit: 600,
        logFileName: targetLogFile || undefined,
      });
      applyRuntimeLogEntries(response.entries);
    } catch (error) {
      const detail = String(error);
      const lowered = detail.toLowerCase();
      const canFallback =
        lowered.includes("not found") &&
        targetLogFile.trim().length > 0 &&
        sessionLogName !== "-" &&
        targetLogFile !== sessionLogName;

      if (canFallback) {
        try {
          setSelectedRuntimeLogFile(sessionLogName);
          const fallback = await runtimeLogRead({ limit: 600, logFileName: sessionLogName });
          applyRuntimeLogEntries(fallback.entries);
          return;
        } catch {
          // Fall through to toast below.
        }
      }
      setToast({ type: "error", message: detail });
    } finally {
      if (!silent || runtimeLogLoading) {
        setRuntimeLogLoading(false);
      }
    }
  }, [
    applyRuntimeLogEntries,
    loadRuntimeLogSessions,
    runtimeLogLoading,
    runtimeLogSessions,
    runtimeLogs.length,
    selectedRuntimeLogFile,
    sessionLogName,
    setRuntimeLogLoading,
    setToast,
  ]);

  const compileErrorLine = useMemo(
    () => (params.lastCompileFailed && params.compileDiagnostics.length > 0 ? params.compileDiagnostics[0] : null),
    [params.compileDiagnostics, params.lastCompileFailed],
  );

  const panelLayout = settings?.uiPrefs?.panelLayout ?? DEFAULT_PANEL_LAYOUT;
  const shellLayout = clampLayout(panelLayout.shell, DEFAULT_PANEL_LAYOUT.shell!);
  const latexLayout = clampLayout(panelLayout.latex, DEFAULT_PANEL_LAYOUT.latex!);
  const analysisLayout = clampLayout(panelLayout.analysis, DEFAULT_PANEL_LAYOUT.analysis!);
  const libraryLayout = clampLayout(panelLayout.library, DEFAULT_PANEL_LAYOUT.library!);
  const activeModelCatalog = settings?.modelCatalog ?? [];

  const analysisPanel = (
    <AnalysisWorkspace
      busy={busy}
      prompt={analysisWorkspace.prompt}
      canRun={analysisWorkspace.canRun}
      running={analysisWorkspace.running}
      errorMessage={analysisWorkspace.analysisError}
      tasks={analysisWorkspace.tasks}
      activeTaskId={analysisWorkspace.activeTaskId}
      activeRun={analysisWorkspace.activeRun}
      activeRunHtml={analysisWorkspace.activeRunHtml}
      timelineCards={analysisWorkspace.timelineCards}
      liveTimelineCards={analysisWorkspace.liveTimelineCards}
      liveStageLabel={analysisWorkspace.liveStage}
      liveOutput={analysisWorkspace.liveOutput}
      candidateFiles={analysisWorkspace.candidateFiles}
      onPromptChange={analysisWorkspace.setPrompt}
      onDropPaths={analysisWorkspace.onDropPromptPaths}
      onRun={() => {
        void analysisWorkspace.runAnalysis();
      }}
      onSelectTask={analysisWorkspace.setActiveTaskId}
      onCreateTask={() => analysisWorkspace.createTask("data")}
      onRenameTask={analysisWorkspace.renameTask}
      onDeleteTask={analysisWorkspace.deleteTask}
      onSetActiveRun={analysisWorkspace.setActiveRunForTask}
      onExportArtifact={(relativePath: string) => {
        void analysisWorkspace.exportArtifact(relativePath);
      }}
      onRevealArtifact={(relativePath: string) => {
        void analysisWorkspace.revealArtifact(relativePath);
      }}
      t={t}
    />
  );

  const recoverWorkspaceLayout = useCallback(() => {
    setSettings((prev: any) => {
      if (!prev) {
        return prev;
      }
      const nextPanelLayout = {
        ...DEFAULT_PANEL_LAYOUT,
        ...(prev.uiPrefs?.panelLayout ?? {}),
      };
      if (page === "latex") {
        nextPanelLayout.latex = [...(DEFAULT_PANEL_LAYOUT.latex ?? [22, 48, 30])];
      } else if (page === "analysis") {
        nextPanelLayout.analysis = [...(DEFAULT_PANEL_LAYOUT.analysis ?? [26, 74])];
      } else if (page === "library") {
        nextPanelLayout.library = [...(DEFAULT_PANEL_LAYOUT.library ?? [30, 70])];
      }
      return {
        ...prev,
        uiPrefs: {
          ...(prev.uiPrefs ?? {}),
          language: prev.uiPrefs?.language ?? locale,
          panelLayout: nextPanelLayout,
        },
      };
    });
    setToast({ type: "error", message: t("workspace.layoutRecovered") });
  }, [locale, page, setSettings, setToast, t]);

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
      runtimeLogSessions={runtimeLogSessions}
      selectedLogFileName={selectedRuntimeLogFile}
      activeModelCatalog={activeModelCatalog}
      modelTestBusy={modelTestBusy}
      modelTestActiveId={modelTestActiveId}
      modelTestById={modelTestById}
      onSettingsSectionChange={setSettingsSection}
      onLocaleChange={handleLocaleChange}
      onThemeModeChange={handleThemeModeChange}
      onBusyTexCachePolicyChange={(policy) => handleBusyTexCachePolicyChange(policy)}
      onOpenModelModal={openModelModal}
      onReloadLogs={reloadRuntimeLogs}
      onSelectLogFile={async (fileName) => {
        await reloadRuntimeLogs({ logFileName: fileName, silent: false });
      }}
      onClearCurrentLog={async () => {
        try {
          await runtimeLogClearCurrentSession("CLEAR_CURRENT_SESSION");
          await reloadRuntimeLogs({ silent: true, refreshSessions: true });
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

  const loadGitDiff = useCallback(
    (path: string, staged: boolean, revision?: string) =>
      activeProjectId ? gitDiffFile(activeProjectId, path, staged, 3, revision) : Promise.reject(new Error("git.noProject")),
    [activeProjectId],
  );
  const loadGitCommitFiles = useCallback(
    (revision: string) =>
      activeProjectId ? gitCommitFiles(activeProjectId, revision) : Promise.resolve([]),
    [activeProjectId],
  );
  const openGitFile = useCallback(
    (path: string) => {
      openWorkspaceFile(path, "pinned");
    },
    [openWorkspaceFile],
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
        refreshGitWorkspace().catch((error: unknown) => setToast({ type: "error", message: String(error) }))
      }
      onFetch={() => handleGitAction(async () => gitFetch(activeProjectId), "git.fetch")}
      onPull={() => handleGitAction(async () => gitPull(activeProjectId), "git.pull")}
      onPush={() => handleGitAction(async () => gitPush(activeProjectId), "git.push")}
      onCheckout={(branch, create) =>
        handleGitAction(async () => gitCheckout(activeProjectId, branch, create), "git.checkout")
      }
      onStage={(paths) => handleGitAction(async () => gitStage(activeProjectId, paths), "git.stage")}
      onUnstage={(paths) =>
        handleGitAction(async () => gitUnstage(activeProjectId, paths), "git.unstage")
      }
      onCommit={(message) =>
        handleGitAction(async () => gitCommit(activeProjectId, message), "git.commit")
      }
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
            setGitInitProgress((prev: any) =>
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
      onLoadDiff={loadGitDiff}
      onLoadCommitFiles={loadGitCommitFiles}
      onOpenFile={openGitFile}
      onStartGitInstall={handleGitInstallerDownloadStart}
      onCancelDownload={handleGitInstallerCancel}
      onRunInstaller={handleGitRunInstaller}
      t={t}
    />
  ) : null;

  return {
    shellLayout,
    latexLayout,
    analysisLayout,
    libraryLayout,
    activeModelCatalog,
    sessionLogName,
    compileErrorLine,
    analysisPanel,
    settingsPanel,
    gitPanel,
    recoverWorkspaceLayout,
  };
}

