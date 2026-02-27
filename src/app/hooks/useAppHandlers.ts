import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
import type { Locale } from "../../i18n";
import {
  fsOperation,
  getLibraryTree,
  initProjectFromFolder,
  openProject,
  projectSearchContent,
  runtimeLogWrite,
  workspaceExportPdf,
  workspaceOpenTerminal,
  workspaceRevealInSystem,
  writeFile,
} from "../../shared/api/desktop";
import { isPdfPath } from "../../shared/utils/fileKind";
import type { AppSettings, FsAction, FsScope, ProjectSearchHit } from "../../shared/types/app";
import { normalizeAgentBindings, type ThemeMode } from "../app-config";
import { runCompilePass as runCompilePassWorkflow } from "./compileWorkflow";
import {
  handleBusyTexCachePolicyChangeAction,
  handleProtocolPingAction,
  handleThemeModeChangeAction,
} from "./settingsUiActions";
import { useAgentWorkflowHandlers } from "./useAgentWorkflowHandlers";
import { useGitHandlers } from "./useGitHandlers";
import type { UseAppHandlersParams } from "./useAppHandlers.types";

export function useAppHandlers(params: UseAppHandlersParams) {
  const {
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
    setEditorContent,
    setProjects,
    setActiveProjectId,
    setSettings,
    setToast,
    setCompileDiagnostics,
    setLastCompileFailed,
    setPdfUrl,
    setCompiledPdfBytes,
    setAgentMessages,
    agentProposalsByPath,
    setAgentProposalsByPath,
    setAgentRunId,
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
    refreshGitWorkspace,
  });

  const handleWindowControl = useCallback(async (action: "minimize" | "toggle" | "close") => {
    if (!isTauriRuntime) {
      setToast({ type: "error", message: t("toast.windowUnavailable") });
      return;
    }
    if (action === "toggle" && windowActionBusy) {
      return;
    }
    try {
      const appWindow = getCurrentWindow();
      if (action === "minimize") {
        await appWindow.minimize();
        return;
      }
      if (action === "toggle") {
        setWindowActionBusy(true);
        const current = await appWindow.isMaximized();
        if (current) {
          await appWindow.unmaximize();
          setIsMaximized(false);
        } else {
          await appWindow.maximize();
          setIsMaximized(true);
        }
        return;
      }
      await appWindow.hide();
      if (settings?.uiPrefs?.closeToTrayNoticeEnabled ?? true) {
        setToast({ type: "info", message: t("toast.minimizedToTray") });
      }
      await runtimeLogWrite("INFO", "window hidden to tray");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      await runtimeLogWrite("ERROR", `window action failed: ${message}`);
    } finally {
      if (action === "toggle") {
        setWindowActionBusy(false);
      }
    }
  }, [
    isTauriRuntime,
    setIsMaximized,
    setToast,
    setWindowActionBusy,
    settings?.uiPrefs?.closeToTrayNoticeEnabled,
    t,
    windowActionBusy,
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
    setBusy(true);
    try {
      await writeFile(activeProjectId, selectedFile, editorContent);
      await runtimeLogWrite("INFO", `${t("log.fileSaved")}: ${selectedFile}`);
      setToast({ type: "info", message: t("toast.fileSaved") });
      return true;
    } catch (error) {
      setToast({ type: "error", message: String(error) });
      return false;
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, editorContent, selectedFile, setBusy, setToast, t]);

  const runCompilePass = useCallback(async (
    projectId: string,
    mainPath: string,
    mainContent: string,
    options: { updatePreview: boolean; emitToast: boolean },
  ) => {
    return runCompilePassWorkflow({
      projectId,
      mainPath,
      mainContent,
      fileList,
      currentPdfUrl: pdfUrl,
      updatePreview: options.updatePreview,
      emitToast: options.emitToast,
      t,
      setLastCompileFailed,
      setCompileDiagnostics,
      setPdfUrl,
      setCompiledPdfBytes,
      setToast,
    });
  }, [
    fileList,
    pdfUrl,
    setCompileDiagnostics,
    setCompiledPdfBytes,
    setLastCompileFailed,
    setPdfUrl,
    setToast,
    t,
  ]);

  const runCompilePassForAgent = useCallback(async (params: {
    projectId: string;
    mainPath: string;
    mainContent: string;
    options: { updatePreview: boolean; emitToast: boolean };
  }) => {
    return runCompilePass(params.projectId, params.mainPath, params.mainContent, params.options);
  }, [runCompilePass]);

  const handleCompile = useCallback(async () => {
    if (!activeProjectId || !selectedFile) {
      return;
    }
    setBusy(true);
    setCompileDiagnostics([]);
    try {
      await runCompilePass(activeProjectId, selectedFile, editorContent, {
        updatePreview: true,
        emitToast: true,
      });
    } catch (error) {
      setLastCompileFailed(true);
      setToast({ type: "error", message: String(error) });
      setCompileDiagnostics([String(error)]);
      setCompiledPdfBytes(null);
    } finally {
      setBusy(false);
    }
  }, [
    activeProjectId,
    editorContent,
    runCompilePass,
    selectedFile,
    setBusy,
    setCompileDiagnostics,
    setCompiledPdfBytes,
    setLastCompileFailed,
    setToast,
  ]);

  const handleExportCompiledPdf = useCallback(async () => {
    if (!activeProjectId || !compiledPdfBytes || compiledPdfBytes.length === 0) {
      setToast({ type: "error", message: t("toast.pdfNotReady") });
      return;
    }
    const fallbackName = isPdfPath(selectedFile)
      ? selectedFile!.split("/").pop() ?? "compiled.pdf"
      : `${(selectedFile ?? "compiled").replace(/\.[^/.]+$/, "")}.pdf`;
    setBusy(true);
    try {
      const saved = await workspaceExportPdf(activeProjectId, fallbackName, compiledPdfBytes);
      if (!saved) {
        return;
      }
      await runtimeLogWrite("INFO", `compiled pdf exported: ${saved.savedPath}`);
      const snapshot = await openProject(activeProjectId);
      setTree(snapshot.tree);
      setSelectedFile(saved.savedPath);
      setToast({ type: "info", message: t("toast.pdfSaved") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [
    activeProjectId,
    compiledPdfBytes,
    selectedFile,
    setBusy,
    setSelectedFile,
    setToast,
    setTree,
    t,
  ]);

  const handleEditorUndo = useCallback(() => {
    editorRef.current?.trigger("latotex", "undo", null);
  }, [editorRef]);

  const handleEditorRedo = useCallback(() => {
    editorRef.current?.trigger("latotex", "redo", null);
  }, [editorRef]);

  const {
    handleRunAgent,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
  } = useAgentWorkflowHandlers({
    activeProjectId,
    agentPrompt,
    editorContent,
    selectedFile,
    t,
    setAgentMessages,
    agentProposalsByPath,
    setAgentProposalsByPath,
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

  const handleProjectSearch = useCallback(async () => {
    if (!activeProjectId || !projectSearchQuery.trim()) {
      setProjectSearchResults([]);
      setProjectSearchSearched(true);
      return;
    }
    setProjectSearchBusy(true);
    setProjectSearchSearched(true);
    try {
      const hits = await projectSearchContent(activeProjectId, projectSearchQuery.trim(), 180);
      setProjectSearchResults(hits);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
      setProjectSearchResults([]);
    } finally {
      setProjectSearchBusy(false);
    }
  }, [activeProjectId, projectSearchQuery, setProjectSearchBusy, setProjectSearchResults, setProjectSearchSearched, setToast]);

  const handleProjectSearchSelect = useCallback((hit: ProjectSearchHit) => {
    setPage("latex");
    setSelectedFile(hit.relativePath);
    setPendingRevealLine(hit.lineNumber);
  }, [setPage, setPendingRevealLine, setSelectedFile]);

  const handleBusyTexCachePolicyChange = useCallback(async (
    policy: "install-first" | "appdata-only",
  ) => {
    await handleBusyTexCachePolicyChangeAction({
      policy,
      locale,
      t,
      setBusy,
      setBusytexCacheInfo,
      setSettings,
      setToast,
    });
  }, [locale, setBusy, setBusytexCacheInfo, setSettings, setToast, t]);

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

  const runFsAction = useCallback(async (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => {
    if (!activeProjectId) {
      return;
    }
    setBusy(true);
    try {
      await fsOperation({
        projectId: activeProjectId,
        scope,
        action,
        path,
        targetPath,
        content,
      });
      if (scope === "workspace") {
        const snapshot = await openProject(activeProjectId);
        setTree(snapshot.tree);
      } else {
        const nextTree = await getLibraryTree(activeProjectId);
        setLibraryTree(nextTree);
      }
      setToast({ type: "info", message: t("toast.fsUpdated") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, setBusy, setLibraryTree, setToast, setTree, t]);

  const requestFsAction = useCallback(async (
    scope: FsScope,
    action: FsAction,
    path: string,
    targetPath?: string,
    content?: string,
  ) => {
    const normalizedPath = path.trim();
    if (!normalizedPath) {
      return;
    }
    if (action !== "delete") {
      await runFsAction(scope, action, normalizedPath, targetPath, content);
      return;
    }
    const skipConfirm = settings?.uiPrefs?.skipDeleteConfirm ?? false;
    if (skipConfirm) {
      await runFsAction(scope, "delete", normalizedPath);
      return;
    }
    setDeleteIntent({ scope, path: normalizedPath });
    setDeleteDontAskAgain(false);
  }, [runFsAction, setDeleteDontAskAgain, setDeleteIntent, settings?.uiPrefs?.skipDeleteConfirm]);

  const confirmDelete = useCallback(async () => {
    if (!deleteIntent || !settings) {
      return;
    }

    if (deleteDontAskAgain) {
      const nextSettings: AppSettings = {
        ...settings,
        uiPrefs: {
          ...(settings.uiPrefs ?? {}),
          language: settings.uiPrefs?.language ?? locale,
          skipDeleteConfirm: true,
          panelLayout: settings.uiPrefs?.panelLayout,
        },
      };
      await persistSettings(nextSettings);
    }

    await runFsAction(deleteIntent.scope, "delete", deleteIntent.path);
    setDeleteIntent(null);
  }, [deleteDontAskAgain, deleteIntent, locale, persistSettings, runFsAction, setDeleteIntent, settings]);

  return {
    handleWindowControl,
    handleInitProjectFromFolder,
    handleSaveFile,
    handleCompile,
    handleExportCompiledPdf,
    handleEditorUndo,
    handleEditorRedo,
    handleRunAgent,
    handleAcceptAgentProposal,
    handleRejectAgentProposal,
    handleSaveSettings,
    handleLocaleChange,
    handleThemeModeChange,
    handleProjectSearch,
    handleProjectSearchSelect,
    handleBusyTexCachePolicyChange,
    handleProtocolPing,
    handleWorkspaceRevealInSystem,
    handleWorkspaceOpenTerminal,
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
  };
}
