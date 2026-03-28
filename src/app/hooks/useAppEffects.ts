import { getCurrentWindow } from "@tauri-apps/api/window";
import { useEffect, useRef } from "react";
import { resolveLocale } from "../../i18n";
import { getEvents } from "../../shared/api/agent";
import { getHealthCheck, windowSyncIcon } from "../../shared/api/app";
import { listProjects, openProject } from "../../shared/api/projects";
import { runtimeLogInfo, runtimeLogWrite } from "../../shared/api/runtime";
import { getSettings } from "../../shared/api/settings";
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
import { appendEventsWithBudget } from "./eventMemoryBudget";
import { useGitRuntimeEffects } from "./useGitRuntimeEffects";
import { useSelectedFilePreviewEffects } from "./useSelectedFilePreviewEffects";
import { WINDOW_TRANSITION_EVENT } from "./windowTransitionSignal";

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
  agentRunId: string | null;
  analysisRunning: boolean;
  toast: { type: "info" | "error"; message: string } | null;
  gitDownloadTaskId: string | null;
  gitInstallerLaunched: boolean;
  settingsTheme: ThemeMode | undefined;
  loadProjectData: (projectId: string) => Promise<void>;
  refreshGitWorkspace: (projectIdOverride?: string) => Promise<void>;
  handleGitRunInstaller: () => Promise<void>;
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
  setSelectedImagePreviewUrl: (value: string | null) => void;
  setPreviewOverridePath: (value: string | null) => void;
  setSelectedTextFileReadyPath: (value: string | null) => void;
  previewOverridePath: string | null;
  setToast: ToastSetter;
  setProjectSearchQuery: (value: string) => void;
  setProjectSearchResults: (value: any) => void;
  setProjectSearchSearched: (value: boolean) => void;
  setEvents: (value: any) => void;
  setCursor: (value: number) => void;
  resizeFrameRef: React.MutableRefObject<number | null>;
  setIsMaximized: React.Dispatch<React.SetStateAction<boolean>>;
  editorRef: React.MutableRefObject<any>;
  setPendingRevealLine: (value: number | null) => void;
  setGitDownloadState: (value: any) => void;
  setGitDownloadTaskId: (value: string | null) => void;
  getCachedTextContent?: (relativePath: string) => string | null;
  onTextFileLoaded?: (relativePath: string, content: string) => void;
  suspended?: boolean;
  onOutOfMemory?: (source: "error" | "unhandledrejection" | "memory_guard", message: string) => void;
}) {
  const {
    t,
    isTauriRuntime,
    activeProjectId,
    selectedFile,
    pendingRevealLine,
    page,
    cursor,
    agentRunId,
    analysisRunning,
    toast,
    gitDownloadTaskId,
    gitInstallerLaunched,
    settingsTheme,
    loadProjectData,
    refreshGitWorkspace,
    handleGitRunInstaller,
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
    setSelectedImagePreviewUrl,
    setPreviewOverridePath,
    setSelectedTextFileReadyPath,
    previewOverridePath,
    setToast,
    setProjectSearchQuery,
    setProjectSearchResults,
    setProjectSearchSearched,
    setEvents,
    setCursor,
    resizeFrameRef,
    setIsMaximized,
    editorRef,
    setPendingRevealLine,
    setGitDownloadState,
    setGitDownloadTaskId,
    getCachedTextContent,
    onTextFileLoaded,
    suspended = false,
    onOutOfMemory,
  } = params;

  const initDoneRef = useRef(false);
  const tRef = useRef(t);
  const cursorRef = useRef(cursor);
  const isMaximizedRef = useRef(false);
  const windowTransitionEndsAtRef = useRef(0);

  useEffect(() => {
    tRef.current = t;
  }, [t]);

  useEffect(() => {
    cursorRef.current = cursor;
  }, [cursor]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleWindowTransition = (event: Event) => {
      const detail = (event as CustomEvent<{ endsAt?: number; durationMs?: number }>).detail;
      const fallbackEndsAt = Date.now() + Number(detail?.durationMs ?? 320);
      const nextEndsAt = Number(detail?.endsAt ?? fallbackEndsAt);
      if (Number.isFinite(nextEndsAt)) {
        windowTransitionEndsAtRef.current = Math.max(windowTransitionEndsAtRef.current, nextEndsAt);
      }
    };
    window.addEventListener(WINDOW_TRANSITION_EVENT, handleWindowTransition as EventListener);
    return () => {
      window.removeEventListener(WINDOW_TRANSITION_EVENT, handleWindowTransition as EventListener);
    };
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || suspended) {
      return;
    }

    const handler = () => {
      if (!activeProjectId) {
        return;
      }
      void (async () => {
        try {
          const snapshot = await openProject(activeProjectId);
          setTree(snapshot.tree);
          await refreshGitWorkspace(activeProjectId).catch(() => undefined);
        } catch {
          // ignore best-effort rescan failures for draw export refresh
        }
      })();
    };

    window.addEventListener("latotex.workspace.rescan", handler as EventListener);
    return () => {
      window.removeEventListener("latotex.workspace.rescan", handler as EventListener);
    };
  }, [activeProjectId, refreshGitWorkspace, setTree, suspended]);
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
      if (isTauriRuntime) {
        await windowSyncIcon().catch(() => undefined);
      }

      const [projectList, appSettings, info] = await Promise.all([
        listProjects(),
        getSettings(),
        runtimeLogInfo(),
      ]);
      setProjects(projectList);
      const backgroundList = Array.from(
        new Set(
          (appSettings.uiPrefs?.backgroundImagePaths ?? [])
            .map((item) => String(item ?? "").trim())
            .filter((item) => item.length > 0),
        ),
      );
      const legacyBackground = String(appSettings.uiPrefs?.backgroundImagePath ?? "").trim();
      if (legacyBackground && !backgroundList.includes(legacyBackground)) {
        backgroundList.unshift(legacyBackground);
      }
      const activeBackgroundPath = legacyBackground || backgroundList[0] || "";
      const rawBackgroundBlur = Number(appSettings.uiPrefs?.backgroundBlurPx ?? 18);
      const normalizedBackgroundBlur = Number.isFinite(rawBackgroundBlur)
        ? Math.max(4, Math.min(32, rawBackgroundBlur))
        : 18;
      const normalizedSettings: AppSettings = {
        ...appSettings,
        agentBindings: normalizeAgentBindings(appSettings.agentBindings ?? []),
        uiPrefs: {
          ...(appSettings.uiPrefs ?? {}),
          closeToTrayNoticeEnabled: appSettings.uiPrefs?.closeToTrayNoticeEnabled ?? true,
          closeBehavior: appSettings.uiPrefs?.closeBehavior ?? "ask",
          closeBehaviorRemember: appSettings.uiPrefs?.closeBehaviorRemember ?? false,
          theme: (appSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system",
          previewDefaultZoom: appSettings.uiPrefs?.previewDefaultZoom ?? 1,
          backgroundImagePath: activeBackgroundPath,
          backgroundImagePaths: backgroundList,
          backgroundBlurPx: normalizedBackgroundBlur,
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
      }
      applyTheme((normalizedSettings.uiPrefs?.theme as ThemeMode | undefined) ?? "system");

      await runtimeLogWrite(
        "INFO",
        `frontend initialization completed, installMode=${info.installMode}, version=${info.version}`,
      );

      const newWindowMode =
        typeof window !== "undefined" &&
        new URLSearchParams(window.location.search).get("newWindow") === "1";
      let targetProjectId = appSettings.activeProjectId;
      if (newWindowMode) {
        targetProjectId = null;
      } else if (!targetProjectId && projectList.length > 0) {
        targetProjectId = projectList[0].id;
      }
      setActiveProjectId(targetProjectId ?? null);
    };

    init().catch(() => {
      setToast({ type: "error", message: tRef.current("toast.initFailed") });
    });
  }, [isTauriRuntime, setActiveProjectId, setLocale, setProjects, setRuntimeInfo, setSettings, setStatus, setToast]);

  useEffect(() => {
    if (!activeProjectId) {
      setTree([]);
      setLibraryTree([]);
      setSelectedFile(null);
      setSelectedLibraryPath(null);
      setSelectedTextFileReadyPath(null);
      setEditorContent("");
      setSelectedFilePdfUrl(null);
      setSelectedImagePreviewUrl(null);
      setPreviewOverridePath(null);
      return;
    }
    loadProjectData(activeProjectId).catch((error) => {
      setToast({ type: "error", message: String(error) });
    });
  }, [activeProjectId, loadProjectData, setEditorContent, setLibraryTree, setPreviewOverridePath, setSelectedFile, setSelectedFilePdfUrl, setSelectedImagePreviewUrl, setSelectedLibraryPath, setSelectedTextFileReadyPath, setToast, setTree]);

  useSelectedFilePreviewEffects({
    activeProjectId,
    selectedFile,
    page,
    previewOverridePath,
    setEditorContent,
    setSelectedFilePdfUrl,
    setSelectedImagePreviewUrl,
    setSelectedTextFileReadyPath,
    setToast,
    getCachedTextContent,
    onTextFileLoaded,
  });

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
    if (suspended) {
      return;
    }
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout> | null = null;
    let inFlight = false;
    const hasLiveRun = Boolean(agentRunId) || analysisRunning;
    const needsWarmPolling = page === "analysis" || page === "latex";
    const shouldPollEvents = hasLiveRun || needsWarmPolling;
    const shouldStoreEvents = shouldPollEvents;
    if (!shouldPollEvents) {
      return;
    }

    const schedule = (delay: number) => {
      if (cancelled) {
        return;
      }
      timer = setTimeout(() => {
        void poll();
      }, delay);
    };

    const resolvePollDelay = (activeDelay: number, warmDelay: number, idleDelay: number) => {
      const hidden = typeof document !== "undefined" && document.hidden;
      if (hidden) {
        return Math.max(idleDelay, warmDelay + 1200);
      }
      if (hasLiveRun) {
        return activeDelay;
      }
      return needsWarmPolling ? warmDelay : idleDelay;
    };

    const poll = async () => {
      if (cancelled || inFlight) {
        schedule(resolvePollDelay(1500, 3800, 8200));
        return;
      }
      inFlight = true;
      try {
        const waitMs = hasLiveRun ? 1_400 : needsWarmPolling ? 900 : 250;
        const limit = hasLiveRun ? 120 : needsWarmPolling ? 80 : 40;
        const excludeKinds = analysisRunning && page === "analysis"
          ? ["agent.run.heartbeat"]
          : ["responses.output_text.delta", "agent.run.heartbeat"];
        const batch = await getEvents(
          cursorRef.current,
          limit,
          undefined,
          waitMs,
          excludeKinds,
        );
        if (batch.events.length > 0) {
          if (shouldStoreEvents) {
            setEvents((prev: SwarmEvent[]) => appendEventsWithBudget(prev, batch.events));
          }
          cursorRef.current = batch.nextCursor;
          setCursor(batch.nextCursor);
          schedule(resolvePollDelay(700, 2200, 6200));
        } else {
          schedule(resolvePollDelay(2200, 4200, 9200));
        }
      } catch {
        schedule(resolvePollDelay(2800, 5200, 9800));
      } finally {
        inFlight = false;
      }
    };

    schedule(hasLiveRun ? 520 : needsWarmPolling ? 860 : 1600);
    return () => {
      cancelled = true;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [agentRunId, analysisRunning, page, setCursor, setEvents, suspended]);


  useEffect(() => {
    if (!isTauriRuntime) {
      return;
    }
    let unlisten: (() => void) | null = null;
    let resizeTimer: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const syncMaximizedState = async () => {
      const next = await getCurrentWindow().isMaximized();
      if (disposed || next === isMaximizedRef.current) {
        return;
      }
      isMaximizedRef.current = next;
      setIsMaximized(next);
    };

    const scheduleSync = () => {
      if (resizeTimer) {
        clearTimeout(resizeTimer);
      }
      const remainingTransitionMs = Math.max(0, windowTransitionEndsAtRef.current - Date.now());
      const debounceMs = remainingTransitionMs > 0
        ? Math.max(140, remainingTransitionMs + 48)
        : 90;
      resizeTimer = setTimeout(() => {
        resizeTimer = null;
        void syncMaximizedState().catch(() => undefined);
      }, debounceMs);
    };

    const syncWindowState = async () => {
      const appWindow = getCurrentWindow();
      const initialMaximized = await appWindow.isMaximized();
      if (disposed) {
        return;
      }
      isMaximizedRef.current = initialMaximized;
      setIsMaximized(initialMaximized);
      const off = await appWindow.onResized(() => {
        scheduleSync();
      });
      if (disposed) {
        off();
        return;
      }
      unlisten = off;
    };

    syncWindowState().catch(() => undefined);
    return () => {
      disposed = true;
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

    const OOM_PATTERNS = [
      /out of memory/i,
      /memory access out of bounds/i,
      /javascript heap out of memory/i,
      /wasm.*out of memory/i,
    ];
    const isOutOfMemoryMessage = (value: string) => OOM_PATTERNS.some((pattern) => pattern.test(value));

    const onError = (event: ErrorEvent) => {
      const location = event.filename
        ? `${event.filename}:${event.lineno}:${event.colno}`
        : "unknown";
      const message = event.message || "unknown error";
      runtimeLogWrite("ERROR", `frontend.error: ${message} @ ${location}`).catch(() => undefined);
      if (isOutOfMemoryMessage(message)) {
        runtimeLogWrite("WARN", `frontend.oom.error: ${message}`).catch(() => undefined);
        onOutOfMemory?.("error", message);
      }
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
      if (isOutOfMemoryMessage(reason)) {
        runtimeLogWrite("WARN", `frontend.oom.unhandledrejection: ${reason}`).catch(() => undefined);
        onOutOfMemory?.("unhandledrejection", reason);
      }
    };

    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onUnhandledRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onUnhandledRejection);
    };
  }, [onOutOfMemory]);
  useGitRuntimeEffects({
    page,
    activeProjectId,
    refreshGitWorkspace,
    gitDownloadTaskId,
    gitInstallerLaunched,
    handleGitRunInstaller,
    setGitDownloadState,
    setGitDownloadTaskId,
    suspended,
  });
}
