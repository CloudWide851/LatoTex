import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { resolveLocale } from "../../i18n";
import {
  busytexCachePrepare,
  getEvents,
  getHealthCheck,
  getSettings,
  gitDownloadStatus,
  listProjects,
  readFile,
  readFileBinary,
  runtimeLogInfo,
  runtimeLogWrite,
} from "../../shared/api/desktop";
import { isPdfPath } from "../../shared/utils/fileKind";
import type {
  AppSettings,
  SwarmEvent,
} from "../../shared/types/app";
import {
  applyTheme,
  DEFAULT_PANEL_LAYOUT,
  normalizeAgentBindings,
  type ThemeMode,
} from "../app-config";

type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

type TranslationFn = (key: any) => string;

export function useAppEffects(params: {
  t: TranslationFn;
  isTauriRuntime: boolean;
  activeProjectId: string | null;
  selectedFile: string | null;
  pendingRevealLine: number | null;
  page: string;
  cursor: number;
  toast: { type: "info" | "error"; message: string } | null;
  gitDownloadTaskId: string | null;
  gitInstallerLaunched: boolean;
  suppressAutoGitInstall: boolean;
  gitAvailabilityInstalled: boolean | null | undefined;
  settingsTheme: ThemeMode | undefined;
  busytexCachePolicy: "install-first" | "appdata-only" | undefined;
  loadProjectData: (projectId: string) => Promise<void>;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  handleGitRunInstaller: () => Promise<void>;
  handleGitInstallerDownloadStart: () => Promise<void>;
  setStatus: (value: "ready" | "offline") => void;
  setProjects: (value: any) => void;
  setSettings: (value: any) => void;
  setRuntimeInfo: (value: any) => void;
  setLocale: (value: any) => void;
  setActiveProjectId: (value: string | null) => void;
  setTree: (value: any) => void;
  setLibraryTree: (value: any) => void;
  setSelectedFile: (value: string | null) => void;
  setSelectedLibraryPath: (value: string | null) => void;
  setEditorContent: (value: string) => void;
  setSelectedFilePdfUrl: (value: string | null) => void;
  setToast: ToastSetter;
  setProjectSearchQuery: (value: string) => void;
  setProjectSearchResults: (value: any) => void;
  setProjectSearchSearched: (value: boolean) => void;
  setEvents: (value: any) => void;
  setCursor: (value: number) => void;
  setBusytexCacheInfo: (value: any) => void;
  resizeFrameRef: React.MutableRefObject<number | null>;
  setIsMaximized: React.Dispatch<React.SetStateAction<boolean>>;
  editorRef: React.MutableRefObject<any>;
  setPendingRevealLine: (value: number | null) => void;
  setGitDownloadState: (value: any) => void;
  setGitDownloadTaskId: (value: string | null) => void;
  setSuppressAutoGitInstall: (value: boolean) => void;
  getCachedTextContent?: (relativePath: string) => string | null;
  onTextFileLoaded?: (relativePath: string, content: string) => void;
}) {
  const {
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
    gitAvailabilityInstalled,
    settingsTheme,
    busytexCachePolicy,
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
    onTextFileLoaded,
  } = params;

  const initDoneRef = useRef(false);
  const tRef = useRef(t);
  const cursorRef = useRef(cursor);
  const isMaximizedRef = useRef(false);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    if (initDoneRef.current) {
      return;
    }
    initDoneRef.current = true;

    const init = async () => {
      try {
        await getHealthCheck();
        setStatus("ready");
      } catch {
        setStatus("offline");
      }

      const [projectList, appSettings, info] = await Promise.all([
        listProjects(),
        getSettings(),
        runtimeLogInfo(),
      ]);
      setProjects(projectList);
      const normalizedSettings: AppSettings = {
        ...appSettings,
        agentBindings: normalizeAgentBindings(appSettings.agentBindings ?? []),
        uiPrefs: {
          ...(appSettings.uiPrefs ?? {}),
          theme: (appSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
          busytexCachePolicy:
            appSettings.uiPrefs?.busytexCachePolicy ?? "install-first",
          busytexCacheDir: appSettings.uiPrefs?.busytexCacheDir,
          previewDefaultZoom: appSettings.uiPrefs?.previewDefaultZoom ?? 1,
          panelLayout: {
            ...DEFAULT_PANEL_LAYOUT,
            ...(appSettings.uiPrefs?.panelLayout ?? {}),
          },
        },
      };
      setSettings(normalizedSettings);
      setRuntimeInfo(info);

      const initialLocale = resolveLocale(
        appSettings.uiPrefs?.language ??
          (typeof window !== "undefined"
            ? window.localStorage.getItem("latotex.locale")
            : null),
      );
      setLocale(initialLocale);
      if (typeof window !== "undefined") {
        window.localStorage.setItem("latotex.locale", initialLocale);
        window.localStorage.setItem(
          "latotex.busytex.cachePolicy",
          normalizedSettings.uiPrefs?.busytexCachePolicy ?? "install-first",
        );
        if (normalizedSettings.uiPrefs?.busytexCacheDir) {
          window.localStorage.setItem(
            "latotex.busytex.cacheDir",
            normalizedSettings.uiPrefs.busytexCacheDir,
          );
        }
      }
      applyTheme((normalizedSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system");

      await runtimeLogWrite(
        "INFO",
        `frontend initialization completed, installMode=${info.installMode}, version=${info.version}`,
      );

      let targetProjectId = appSettings.activeProjectId;
      if (!targetProjectId && projectList.length > 0) {
        targetProjectId = projectList[0].id;
      }
      setActiveProjectId(targetProjectId ?? null);
    };

    init().catch(() => {
      setToast({ type: "error", message: tRef.current("toast.initFailed") });
    });
  }, [setActiveProjectId, setLocale, setProjects, setRuntimeInfo, setSettings, setStatus, setToast]);

  useEffect(() => {
    if (!activeProjectId) {
      setTree([]);
      setLibraryTree([]);
      setSelectedFile(null);
      setSelectedLibraryPath(null);
      setEditorContent("");
      setSelectedFilePdfUrl(null);
      return;
    }
    loadProjectData(activeProjectId).catch((error) => {
      setToast({ type: "error", message: String(error) });
    });
  }, [activeProjectId, loadProjectData, setEditorContent, setLibraryTree, setSelectedFile, setSelectedFilePdfUrl, setSelectedLibraryPath, setToast, setTree]);

  useEffect(() => {
    if (!activeProjectId || !selectedFile) {
      setSelectedFilePdfUrl(null);
      return;
    }
    let cancelled = false;
    if (isPdfPath(selectedFile)) {
      readFileBinary(activeProjectId, selectedFile)
        .then((result) => {
          if (cancelled) {
            return;
          }
          const url = URL.createObjectURL(
            new Blob([Uint8Array.from(result.bytes)], { type: "application/pdf" }),
          );
          setSelectedFilePdfUrl(url);
          setEditorContent("");
        })
        .catch((error) => {
          if (!cancelled) {
            setToast({ type: "error", message: String(error) });
          }
        });
      return () => {
        cancelled = true;
      };
    }
    setSelectedFilePdfUrl(null);
    const cached = getCachedTextContent?.(selectedFile);
    if (typeof cached === "string") {
      setEditorContent(cached);
      return () => {
        cancelled = true;
      };
    }
    readFile(activeProjectId, selectedFile)
      .then((result) => {
        if (!cancelled) {
          setEditorContent(result.content);
          onTextFileLoaded?.(selectedFile, result.content);
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setToast({ type: "error", message: String(error) });
        }
      });
    return () => {
      cancelled = true;
    };
  }, [
    activeProjectId,
    getCachedTextContent,
    onTextFileLoaded,
    selectedFile,
    setEditorContent,
    setSelectedFilePdfUrl,
    setToast,
  ]);

  useEffect(() => {
    if (!pendingRevealLine || !editorRef.current) {
      return;
    }
    editorRef.current.revealLineInCenter(pendingRevealLine);
    editorRef.current.setPosition({ lineNumber: pendingRevealLine, column: 1 });
    setPendingRevealLine(null);
  }, [editorRef, pendingRevealLine, selectedFile, setPendingRevealLine]);

  useEffect(() => {
    setProjectSearchQuery("");
    setProjectSearchResults([]);
    setProjectSearchSearched(false);
  }, [activeProjectId, setProjectSearchQuery, setProjectSearchResults, setProjectSearchSearched]);

  useEffect(() => {
    const mode = settingsTheme ?? "system";
    applyTheme(mode);

    if (mode !== "system" || typeof window === "undefined" || !window.matchMedia) {
      return;
    }
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    media.addEventListener("change", onChange);
    return () => media.removeEventListener("change", onChange);
  }, [settingsTheme]);

  useEffect(() => {
    const timer = setInterval(() => {
      getEvents(cursorRef.current, 120)
        .then((batch) => {
          if (batch.events.length > 0) {
            setEvents((prev: SwarmEvent[]) => [...prev.slice(-300), ...batch.events]);
            cursorRef.current = batch.nextCursor;
            setCursor(batch.nextCursor);
          }
        })
        .catch(() => undefined);
    }, 2400);
    return () => clearInterval(timer);
  }, [setCursor, setEvents]);

  useEffect(() => {
    const policy = busytexCachePolicy ?? null;
    if (!policy) {
      return;
    }
    busytexCachePrepare(policy)
      .then((info) => {
        setBusytexCacheInfo(info);
        if (typeof window !== "undefined") {
          window.localStorage.setItem("latotex.busytex.cachePolicy", info.policy);
          window.localStorage.setItem("latotex.busytex.cacheDir", info.actualDir);
        }
      })
      .catch(() => undefined);
  }, [busytexCachePolicy, setBusytexCacheInfo]);

  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    let unlisten: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    const syncWindowState = async () => {
      const appWindow = getCurrentWindow();
      const initialMaximized = await appWindow.isMaximized();
      isMaximizedRef.current = initialMaximized;
      setIsMaximized(initialMaximized);
      unlisten = await appWindow.onResized(async () => {
        if (resizeTimer) {
          clearTimeout(resizeTimer);
        }
        resizeTimer = setTimeout(async () => {
          resizeTimer = null;
          const next = await appWindow.isMaximized();
          if (next !== isMaximizedRef.current) {
            isMaximizedRef.current = next;
            setIsMaximized(next);
          }
        }, 90);
      });
    };

    syncWindowState().catch(() => undefined);
    return () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      if (resizeFrameRef.current) {
        cancelAnimationFrame(resizeFrameRef.current);
        resizeFrameRef.current = null;
      }
      unlisten?.();
    };
  }, [isTauriRuntime, resizeFrameRef, setIsMaximized]);

  useEffect(() => {
    if (!toast) {
      return;
    }
    const timer = setTimeout(() => setToast(null), 2600);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const onError = (event: ErrorEvent) => {
      const location = event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : "unknown";
      const message = event.message || "unknown error";
      runtimeLogWrite("ERROR", `frontend.error: ${message} @ ${location}`).catch(() => undefined);
    };
    const onUnhandledRejection = (event: PromiseRejectionEvent) => {
      let reason = "unknown reason";
      if (typeof event.reason === "string") {
        reason = event.reason;
      } else if (event.reason instanceof Error) {
        reason = event.reason.message;
      } else {
        try {
          reason = JSON.stringify(event.reason);
        } catch {
          reason = String(event.reason);
        }
      }
      runtimeLogWrite("ERROR", `frontend.unhandledrejection: ${reason || "unknown reason"}`).catch(
        () => undefined,
      );
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, []);

  useEffect(() => {
    if (page !== "git" || !activeProjectId) {
      return;
    }
    refreshGitWorkspace(activeProjectId).catch(() => undefined);
  }, [activeProjectId, page, refreshGitWorkspace]);

  useEffect(() => {
    if (!gitDownloadTaskId) {
      return;
    }
    const timer = setInterval(() => {
      gitDownloadStatus(gitDownloadTaskId)
        .then((nextState) => {
          setGitDownloadState(nextState);
          if (nextState.status === "completed" && !gitInstallerLaunched) {
            handleGitRunInstaller().catch(() => undefined);
          }
          if (nextState.status === "failed" || nextState.status === "cancelled") {
            setGitDownloadTaskId(null);
            setSuppressAutoGitInstall(true);
          }
          if (nextState.status === "completed" && gitInstallerLaunched) {
            setGitDownloadTaskId(null);
          }
        })
        .catch(() => undefined);
    }, 500);
    return () => clearInterval(timer);
  }, [
    gitDownloadTaskId,
    gitInstallerLaunched,
    handleGitRunInstaller,
    setGitDownloadState,
    setGitDownloadTaskId,
    setSuppressAutoGitInstall,
  ]);

  useEffect(() => {
    if (
      page !== "git" ||
      !activeProjectId ||
      gitAvailabilityInstalled !== false ||
      gitDownloadTaskId ||
      suppressAutoGitInstall
    ) {
      return;
    }
    handleGitInstallerDownloadStart().catch(() => undefined);
  }, [
    activeProjectId,
    gitAvailabilityInstalled,
    gitDownloadTaskId,
    handleGitInstallerDownloadStart,
    page,
    suppressAutoGitInstall,
  ]);
}
