import { getCurrentWindow } from "@tauri-apps/api/window";
import { useCallback } from "react";
import { compileWithBusyTeX } from "../../features/latex/compiler/busytex";
import type { Locale } from "../../i18n";
import {
  fsOperation,
  getLibraryTree,
  initProjectFromFolder,
  openProject,
  projectSearchContent,
  readFile,
  recordCompile,
  runAgent,
  runtimeLogWrite,
  testProtocol,
  workspaceOpenTerminal,
  workspaceRevealInSystem,
  writeFile,
  busytexCachePrepare,
} from "../../shared/api/desktop";
import type {
  AppSettings,
  FsAction,
  FsScope,
  ProjectSearchHit,
} from "../../shared/types/app";
import {
  applyTheme,
  normalizeAgentBindings,
  resolveTheme,
  THEME_TRANSITION_MS,
  type ThemeMode,
} from "../app-config";
import { useGitHandlers } from "./useGitHandlers";
import type { UseAppHandlersParams } from "./useAppHandlers.types";

const MAX_AGENT_MESSAGES = 200;
const COMPILE_SKIP_EXTENSIONS = new Set([
  "pdf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "bmp",
  "webp",
  "ico",
  "svg",
  "zip",
  "7z",
  "rar",
  "mp4",
  "mp3",
  "wav",
  "ogg",
  "mov",
  "avi",
  "wasm",
  "dll",
  "exe",
  "bin",
]);

function shouldIncludeCompileFile(path: string): boolean {
  const normalized = path.trim().toLowerCase();
  if (!normalized) {
    return false;
  }
  const dot = normalized.lastIndexOf(".");
  if (dot < 0 || dot === normalized.length - 1) {
    return true;
  }
  const extension = normalized.slice(dot + 1);
  return !COMPILE_SKIP_EXTENSIONS.has(extension);
}

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
      await appWindow.close();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setToast({ type: "error", message: t("toast.windowActionFailed") });
      await runtimeLogWrite("ERROR", `window action failed: ${message}`);
    } finally {
      if (action === "toggle") {
        setWindowActionBusy(false);
      }
    }
  }, [isTauriRuntime, setIsMaximized, setToast, setWindowActionBusy, t, windowActionBusy]);

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
      return;
    }
    setBusy(true);
    try {
      await writeFile(activeProjectId, selectedFile, editorContent);
      await runtimeLogWrite("INFO", `${t("log.fileSaved")}: ${selectedFile}`);
      setToast({ type: "info", message: t("toast.fileSaved") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [activeProjectId, editorContent, selectedFile, setBusy, setToast, t]);

  const handleCompile = useCallback(async () => {
    if (!activeProjectId || !selectedFile) {
      return;
    }
    setBusy(true);
    setCompileDiagnostics([]);
    try {
      const fileMap: Record<string, string> = {};
      for (const filePath of fileList) {
        if (filePath === selectedFile) {
          fileMap[filePath] = editorContent;
          continue;
        }
        if (!shouldIncludeCompileFile(filePath)) {
          continue;
        }
        const data = await readFile(activeProjectId, filePath);
        fileMap[filePath] = data.content;
      }

      const result = await compileWithBusyTeX(editorContent, fileMap, selectedFile);
      setLastCompileFailed(result.status !== "success");
      await runtimeLogWrite(
        result.status === "success" ? "INFO" : "ERROR",
        `${t("log.compileDone")}, file=${selectedFile}, status=${result.status}, durationMs=${result.durationMs}`,
      );

      await recordCompile({
        projectId: activeProjectId,
        mainFile: selectedFile,
        status: result.status,
        diagnostics: result.diagnostics,
        durationMs: result.durationMs,
      });

      if (result.status === "success" && result.pdfBytes) {
        if (pdfUrl) {
          URL.revokeObjectURL(pdfUrl);
        }
        const normalizedBytes = Uint8Array.from(result.pdfBytes);
        const url = URL.createObjectURL(
          new Blob([normalizedBytes], { type: "application/pdf" }),
        );
        setPdfUrl(url);
      }
      setCompileDiagnostics(result.diagnostics);
      setToast({
        type: result.status === "success" ? "info" : "error",
        message:
          result.status === "success"
            ? t("toast.compileSuccess")
            : t("toast.compileFailed"),
      });
    } catch (error) {
      setLastCompileFailed(true);
      setToast({ type: "error", message: String(error) });
      setCompileDiagnostics([String(error)]);
    } finally {
      setBusy(false);
    }
  }, [
    activeProjectId,
    editorContent,
    fileList,
    pdfUrl,
    selectedFile,
    setBusy,
    setCompileDiagnostics,
    setLastCompileFailed,
    setPdfUrl,
    setToast,
    t,
  ]);

  const handleEditorUndo = useCallback(() => {
    editorRef.current?.trigger("latotex", "undo", null);
  }, [editorRef]);

  const handleEditorRedo = useCallback(() => {
    editorRef.current?.trigger("latotex", "redo", null);
  }, [editorRef]);

  const handleRunAgent = useCallback(async () => {
    if (!activeProjectId || !agentPrompt.trim()) {
      return;
    }
    const prompt = agentPrompt.trim();
    setAgentMessages((prev) =>
      [
        ...prev,
        {
          id: `${Date.now()}-user`,
          role: "user" as const,
          text: prompt,
        },
      ].slice(-MAX_AGENT_MESSAGES),
    );
    setAgentPrompt("");
    setAgentCollapsed(false);
    setAgentPhase("running");
    setAgentStatusKey("agent.statusRunning");
    try {
      const response = await runAgent({
        projectId: activeProjectId,
        role: "task",
        prompt,
        contextRefs: selectedFile ? [`file:${selectedFile}`] : [],
      });
      await runtimeLogWrite("INFO", `${t("log.agentRunDone")}, runId=${response.runId}`);
      setAgentMessages((prev) =>
        [
          ...prev,
          {
            id: `${Date.now()}-agent`,
            role: "agent" as const,
            text: response.output,
          },
        ].slice(-MAX_AGENT_MESSAGES),
      );
      setAgentPhase("done");
      setAgentStatusKey("agent.statusDone");
    } catch (error) {
      setAgentPhase("error");
      setAgentStatusKey("agent.statusError");
      setToast({ type: "error", message: String(error) });
    }
  }, [activeProjectId, agentPrompt, selectedFile, setAgentCollapsed, setAgentMessages, setAgentPhase, setAgentPrompt, setAgentStatusKey, setToast, t]);

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
    const currentTheme = (settings?.uiPrefs?.theme as ThemeMode | undefined) ?? "system";
    if (resolveTheme(currentTheme) === resolveTheme(nextTheme)) {
      return;
    }
    const originX = event?.clientX ?? window.innerWidth / 2;
    const originY = event?.clientY ?? window.innerHeight / 2;
    const radius = Math.hypot(
      Math.max(originX, window.innerWidth - originX),
      Math.max(originY, window.innerHeight - originY),
    );
    const target = resolveTheme(nextTheme);

    setSettings((prev) =>
      prev
        ? {
            ...prev,
            uiPrefs: {
              ...(prev.uiPrefs ?? {}),
              language: prev.uiPrefs?.language ?? locale,
              theme: nextTheme,
              panelLayout: prev.uiPrefs?.panelLayout,
            },
          }
        : prev,
    );

    if (typeof window !== "undefined" && !window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      setThemeTransition({
        x: originX,
        y: originY,
        radius,
        target,
        active: false,
      });
      requestAnimationFrame(() => {
        setThemeTransition((prev: any) => (prev ? { ...prev, active: true } : prev));
      });
      window.setTimeout(() => applyTheme(nextTheme), 140);
      window.setTimeout(() => setThemeTransition(null), THEME_TRANSITION_MS);
      return;
    }

    applyTheme(nextTheme);
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
    setBusy(true);
    try {
      const info = await busytexCachePrepare(policy);
      setBusytexCacheInfo(info);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("latotex.busytex.cachePolicy", info.policy);
        window.localStorage.setItem("latotex.busytex.cacheDir", info.actualDir);
      }
      setSettings((prev) =>
        prev
          ? {
              ...prev,
              uiPrefs: {
                ...(prev.uiPrefs ?? {}),
                language: prev.uiPrefs?.language ?? locale,
                busytexCachePolicy: info.policy as "install-first" | "appdata-only",
                busytexCacheDir: info.actualDir,
                panelLayout: prev.uiPrefs?.panelLayout,
                theme: prev.uiPrefs?.theme,
              },
            }
          : prev,
      );
      setToast({ type: "info", message: t("settings.busytexPrepared") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setBusy(false);
    }
  }, [locale, setBusy, setBusytexCacheInfo, setSettings, setToast, t]);

  const handleProtocolPing = useCallback(async (protocolId: string) => {
    const result = await testProtocol(protocolId);
    setToast({
      type: result.ok ? "info" : "error",
      message: result.ok ? t("toast.protocolOk") : t("toast.protocolFail"),
    });
    await runtimeLogWrite(
      result.ok ? "INFO" : "WARN",
      `protocol test: ${protocolId}, ok=${result.ok}`,
    );
    return result.ok;
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
