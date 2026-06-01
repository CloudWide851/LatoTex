import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
import type { Locale } from "../../i18n";
import { initProjectFromFolder, projectPrepareSearchIndex } from "../../shared/api/projects";
import { runtimeLogWrite } from "../../shared/api/runtime";
import {
  getWorkspaceTree,
  workspaceOpenTerminal,
  workspaceRevealInSystem,
  writeFile,
} from "../../shared/api/workspace";
import { isExcelPath } from "../../shared/utils/fileKind";
import type { AppSettings } from "../../shared/types/app";
import { normalizeAgentBindings, type ThemeMode } from "../app-config";
import { handleProtocolPingAction, handleThemeModeChangeAction } from "./settingsUiActions";
import {
  buildRememberedCloseBehaviorSettings,
  resolveWindowControlPlan,
  type CloseBehavior,
} from "./windowCloseFlow";
import { useCompileActions } from "./useCompileActions";
import { useAgentWorkflowHandlers } from "./useAgentWorkflowHandlers";
import { useGitHandlers } from "./useGitHandlers";
import type { UseAppHandlersParams } from "./useAppHandlers.types";
import { signalWindowTransition } from "./windowTransitionSignal";
import { useProjectSearchHandlers } from "./useProjectSearchHandlers";
import { useFsActionHandlers } from "./useFsActionHandlers";
export function useAppHandlers(params: UseAppHandlersParams) {
  const {
    isTauriRuntime,
    t,
    locale,
    activeProjectId,
    selectedFile,
    fileList,
    editorContent,
    resolveSelectedFileContent = async () => editorContent,
    pdfUrl,
    compiledPdfRelativePath,
    agentPrompt,
    settings,
    projectSearchQuery,
    gitDownloadTaskId,
    gitInstallerLaunched,
    deleteIntent,
    deleteDontAskAgain,
    requestCloseBehaviorDecision = () => false,
    requestNativeWindowClose = async () => false,
    setCloseDecisionBusy = () => undefined,
    setWindowActionBusy = () => undefined,
    setBusy,
    setTree,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setEditorContent,
    setProjects,
    setActiveProjectId,
    setSettings,
    setToast,
    setCompileDiagnostics,
    setCompileInstallProgress,
    setLastCompileFailed,
    setPdfUrl,
    setCompiledPdfRelativePath,
    setPreferCompiledPreview,
    setAgentMessages,
    agentProposalsByPath,
    setAgentProposalsByPath,
    setAgentPendingAction,
    setAgentRunId,
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setProjectSearchResults,
    setProjectSearchSearched,
    setProjectSearchBusy,
    setPage,
    setPendingRevealLine,
    setDeleteIntent,
    setDeleteDontAskAgain,
    setThemeTransition,
    setGitDownloadTaskId,
    setGitDownloadState,
    setGitInstallerLaunched,
    setSuppressAutoGitInstall,
    markPathSaved,
    editorRef,
    loadProjectData,
    persistSettings,
    refreshGitWorkspace,
    setLocale,
    upsertProject,
    runAnalysisFromAgent,
  } = params;
  const {
    handleGitAction,
    handleGitInstallerDownloadStart,
    handleGitInstallerCancel,
    handleGitRunInstaller,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibrarySyncZotero,
  } = useGitHandlers({
    t,
    activeProjectId,
    gitDownloadTaskId,
    gitInstallerLaunched,
    setBusy,
    setToast,
    setGitDownloadState,
    setGitDownloadTaskId,
    setGitInstallerLaunched,
    setSuppressAutoGitInstall,
    setLibraryTree,
    setSelectedLibraryPath,
    refreshGitWorkspace,
  });
  const rememberWindowCloseBehavior = useCallback(async (behavior: "tray" | "exit") => {
    if (!settings) {
      return;
    }
    const nextSettings = buildRememberedCloseBehaviorSettings(settings, locale, behavior);
    await persistSettings(nextSettings);
    void runtimeLogWrite("INFO", `window close behavior remembered: ${behavior}`).catch(() => undefined);
  }, [locale, persistSettings, settings]);
  const runWindowCloseBehavior = useCallback(async (
    behavior: "tray" | "exit",
    options?: { bypassInterception?: boolean },
  ) => {
    if (behavior === "exit") {
      signalWindowTransition(220);
      await requestNativeWindowClose(options?.bypassInterception ?? false);
      return;
    }
    signalWindowTransition(220);
    const appWindow = getCurrentWindow();
    await appWindow.hide();
    if (settings?.uiPrefs?.closeToTrayNoticeEnabled ?? true) {
      setToast({ type: "info", message: t("toast.minimizedToTray") });
    }
    void runtimeLogWrite("INFO", "window hidden to tray").catch(() => undefined);
  }, [requestNativeWindowClose, setToast, settings?.uiPrefs?.closeToTrayNoticeEnabled, t]);
  const handleWindowControl = useCallback(async (action: "minimize" | "toggle" | "close") => {
    if (!isTauriRuntime) {
      return;
    }
    const closeBehavior = (settings?.uiPrefs?.closeBehavior ?? "ask") as CloseBehavior;
    const plan = resolveWindowControlPlan(action, closeBehavior);
    if (plan.trackBusy) {
      setWindowActionBusy(true);
    }
    try {
      const appWindow = getCurrentWindow();
      if (plan.type === "minimize") {
        signalWindowTransition(180);
        await appWindow.minimize();
        return;
      }
      if (plan.type === "toggle") {
        signalWindowTransition(260);
        await appWindow.toggleMaximize();
        return;
      }
      if (plan.type === "run-close-behavior") {
        await runWindowCloseBehavior(plan.behavior);
        return;
      }
      if (requestCloseBehaviorDecision()) {
        void runtimeLogWrite("INFO", "window close decision requested").catch(() => undefined);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      void runtimeLogWrite("ERROR", `window action failed: ${message}`).catch(() => undefined);
    } finally {
      if (plan.trackBusy) {
        setWindowActionBusy(false);
      }
    }
  }, [
    isTauriRuntime,
    requestCloseBehaviorDecision,
    runWindowCloseBehavior,
    setWindowActionBusy,
    setToast,
    settings?.uiPrefs?.closeBehavior,
    t,
  ]);
  const handleWindowCloseDecision = useCallback(async (
    behavior: "tray" | "exit",
    remember: boolean,
  ) => {
    setCloseDecisionBusy(true);
    try {
      if (behavior === "tray") {
        await runWindowCloseBehavior("tray");
        if (remember) {
          void rememberWindowCloseBehavior("tray").catch((error) => {
            const message = error instanceof Error ? error.message : String(error);
            setToast({ type: "error", message: t("toast.windowActionFailed") });
            void runtimeLogWrite("ERROR", `window close decision persist failed: ${message}`).catch(() => undefined);
          });
        }
        return;
      }
      if (remember) {
        await rememberWindowCloseBehavior("exit");
      }
      await runWindowCloseBehavior("exit", { bypassInterception: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      void runtimeLogWrite("ERROR", `window close decision failed: ${message}`).catch(() => undefined);
    } finally {
      setCloseDecisionBusy(false);
    }
  }, [
    rememberWindowCloseBehavior,
    runWindowCloseBehavior,
    setCloseDecisionBusy,
    setToast,
    t,
  ]);
  const handleInitProjectFromFolder = useCallback(async () => {
    setBusy(true);
    try {
      const snapshot = await initProjectFromFolder();
      if (!snapshot) {
        return;
      }
      setProjects((prev) => upsertProject(prev, snapshot.summary));
      setActiveProjectId(snapshot.summary.id);
      setTree(snapshot.tree);
      setSelectedFile(snapshot.mainFile);
      setSettings((prev) =>
        prev ? { ...prev, activeProjectId: snapshot.summary.id } : prev,
      );
      setToast({ type: "info", message: t("toast.projectCreated") });
      await runtimeLogWrite("INFO", `project initialized from folder: ${snapshot.summary.rootPath}`);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [setBusy, setProjects, upsertProject, setActiveProjectId, setTree, setSelectedFile, setSettings, setToast, t]);
  const handleSaveFile = useCallback(async () => {
    if (!activeProjectId || !selectedFile) {
      return false;
    }
    if (isExcelPath(selectedFile)) {
      setToast({ type: "info", message: t("table.excel.usePreviewSave") });
      return false;
    }
    setBusy(true);
    try {
      await writeFile(activeProjectId, selectedFile, editorContent);
      await refreshGitWorkspace(activeProjectId).catch(() => undefined);
      await runtimeLogWrite("INFO", `${t("log.fileSaved")}: ${selectedFile}`);
      setToast({ type: "info", message: t("toast.fileSaved") });
      return true;
    } catch (error) {
      setToast({ type: "error", message: String(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, editorContent, refreshGitWorkspace, selectedFile, setBusy, setToast, t]);
  const handleWriteSelectedFileContent = useCallback(async (nextContent: string) => {
    if (!activeProjectId || !selectedFile) {
      return false;
    }
    if (isExcelPath(selectedFile)) {
      return false;
    }
    setBusy(true);
    try {
      await writeFile(activeProjectId, selectedFile, nextContent);
      setEditorContent(nextContent);
      markPathSaved(selectedFile, nextContent);
      await refreshGitWorkspace(activeProjectId).catch(() => undefined);
      await runtimeLogWrite("INFO", `compile assist fix applied: ${selectedFile}`);
      setToast({ type: "info", message: t("toast.fileSaved") });
      return true;
    } catch (error) {
      setToast({ type: "error", message: String(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, markPathSaved, refreshGitWorkspace, selectedFile, setBusy, setEditorContent, setToast, t]);
  const {
    runCompilePassForAgent,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
  } = useCompileActions({
    activeProjectId,
    selectedFile,
    fileList,
    editorContent,
    resolveSelectedFileContent,
    pdfUrl,
    compiledPdfRelativePath,
    setBusy,
    setToast,
    setTree,
    setSelectedFile,
    setCompileDiagnostics,
    setCompileInstallProgress,
    setLastCompileFailed,
    setPdfUrl,
    setCompiledPdfRelativePath,
    setPreferCompiledPreview,
    editorRef,
    t,
  });
  const {
    handleRunAgent,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
    handleResolveAgentPendingAction,
  } = useAgentWorkflowHandlers({
    activeProjectId,
    agentPrompt,
    editorContent,
    selectedFile,
    resolveSelectedFileContent,
    t,
    setAgentMessages,
    agentProposalsByPath,
    setAgentProposalsByPath,
    setAgentPendingAction,
    setAgentRunId,
    setAgentPrompt,
    setAgentCollapsed,
    setAgentPhase,
    setAgentStatusKey,
    setToast,
    setEditorContent,
    markPathSaved,
    refreshGitWorkspace,
    runCompilePass: runCompilePassForAgent,
    setBusy,
    setSelectedFile,
    setTree,
    setPage,
    runAnalysisFromAgent,
    taskModelOverride: settings?.uiPrefs?.featureModelBindings?.latexAgentModelId ?? null,
  });
  const {
    handleProjectSearch,
    handleProjectSearchSelect,
  } = useProjectSearchHandlers({
    activeProjectId,
    projectSearchQuery,
    setProjectSearchResults,
    setProjectSearchSearched,
    setProjectSearchBusy,
    setToast,
    setPage,
    setSelectedFile,
    setPendingRevealLine,
  });
  const handleSaveSettings = useCallback(async () => {
    if (!settings) {
      return;
    }
    setBusy(true);
    try {
      const validModelIds = new Set(settings.modelCatalog.map((item) => item.id));
      const normalizedBindings = normalizeAgentBindings(settings.agentBindings ?? []);
      const nextSettings: AppSettings = {
        ...settings,
        agentBindings: normalizedBindings.map((item) => ({
          ...item,
          modelId: validModelIds.has(item.modelId) ? item.modelId : "",
        })),
      };
      await persistSettings(nextSettings);
      await runtimeLogWrite("INFO", t("log.settingsSaved"));
      setToast({ type: "info", message: t("toast.settingsSaved") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [persistSettings, setBusy, setToast, settings, t]);
  const handleLocaleChange = useCallback((nextLocale: Locale) => {
    setLocale(nextLocale);
    if (typeof window !== "undefined") {
      window.localStorage.setItem("latotex.locale", nextLocale);
    }
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            uiPrefs: { ...(prev.uiPrefs ?? {}), language: nextLocale, panelLayout: prev.uiPrefs?.panelLayout },
          }
        : prev,
    );
  }, [setLocale, setSettings]);
  const handleThemeModeChange = useCallback((
    nextTheme: ThemeMode,
    event?: { clientX: number; clientY: number },
  ) => {
    handleThemeModeChangeAction({
      currentTheme: (settings?.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
      nextTheme,
      locale,
      event,
      setSettings,
      setThemeTransition,
    });
  }, [locale, setSettings, setThemeTransition, settings?.uiPrefs?.theme]);
  const handleBusyTexCachePolicyChange = useCallback((policy: "install-first" | "appdata-only") => {
    setSettings((prev) =>
      prev
        ? {
            ...prev,
            uiPrefs: {
              ...(prev.uiPrefs ?? {}),
              busytexCachePolicy: policy,
            },
          }
        : prev,
    );
  }, [setSettings]);
  const handleWorkspaceRevealInSystem = useCallback(async (relativePath?: string) => {
    if (!activeProjectId) {
      return;
    }
    try {
      await workspaceRevealInSystem(activeProjectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [activeProjectId, setToast]);
  const handleWorkspaceOpenTerminal = useCallback(async (relativePath?: string) => {
    if (!activeProjectId) {
      return;
    }
    try {
      await workspaceOpenTerminal(activeProjectId, relativePath);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    }
  }, [activeProjectId, setToast]);
  const handleWorkspaceRescan = useCallback(async () => {
    if (!activeProjectId) {
      return;
    }
    setBusy(true);
    try {
      setTree(await getWorkspaceTree(activeProjectId));
      void projectPrepareSearchIndex(activeProjectId).catch(() => undefined);
      await refreshGitWorkspace(activeProjectId).catch(() => undefined);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, refreshGitWorkspace, setBusy, setToast, setTree]);
  const handleProtocolPing = useCallback(async (input: {
    protocolId: string;
    baseUrl: string;
    apiKey?: string;
    requestName?: string;
  }) => {
    return handleProtocolPingAction({
      protocolId: input.protocolId,
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      requestName: input.requestName,
      setToast,
      t,
    });
  }, [setToast, t]);
  const { confirmDelete, requestFsAction, runFsAction } = useFsActionHandlers({
    activeProjectId,
    deleteDontAskAgain,
    deleteIntent,
    locale,
    persistSettings,
    refreshGitWorkspace,
    setDeleteDontAskAgain,
    setDeleteIntent,
    setLibraryTree,
    setSelectedFile,
    setSelectedLibraryPath,
    setSettings,
    setToast,
    setTree,
    settings,
    t,
  });
  return {
    handleWindowControl,
    handleWindowCloseDecision,
    handleInitProjectFromFolder,
    handleSaveFile,
    handleWriteSelectedFileContent,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    handleRunAgent,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
    handleResolveAgentPendingAction,
    handleSaveSettings,
    handleLocaleChange,
    handleThemeModeChange,
    handleBusyTexCachePolicyChange,
    handleProjectSearch,
    handleProjectSearchSelect,
    handleProtocolPing,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
    handleWorkspaceRescan,
    runFsAction,
    requestFsAction,
    confirmDelete,
    handleGitAction,
    handleGitInstallerDownloadStart,
    handleGitInstallerCancel,
    handleGitRunInstaller,
    handleLibraryRescan,
    handleLibraryImportPdf,
    handleLibraryImportLink,
    handleLibrarySyncZotero,
  };
}
