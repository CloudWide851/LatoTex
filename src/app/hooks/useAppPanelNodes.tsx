import { useCallback, useMemo } from "react";
import {
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

  const reloadRuntimeLogs = useCallback(async () => {
    setRuntimeLogLoading(true);
    try {
      const response = await runtimeLogRead({ limit: 1600 });
      setRuntimeLogs(response.entries);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setRuntimeLogLoading(false);
    }
  }, [setRuntimeLogLoading, setRuntimeLogs, setToast]);

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
      result={analysisWorkspace.result}
      reports={analysisWorkspace.reports}
      onPromptChange={analysisWorkspace.setPrompt}
      onRun={() => {
        void analysisWorkspace.runAnalysis();
      }}
      onRefresh={() => {
        void analysisWorkspace.refreshReports();
      }}
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
      onClearCurrentLog={async () => {
        try {
          await runtimeLogClearCurrentSession("CLEAR_CURRENT_SESSION");
          await reloadRuntimeLogs();
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
        refreshGitWorkspace().catch((error: unknown) => setToast({ type: "error", message: String(error) }))
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
