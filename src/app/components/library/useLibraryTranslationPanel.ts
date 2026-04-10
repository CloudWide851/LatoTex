import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { libraryResolvePdfPreview } from "../../../shared/api/library";
import {
  ensureTranslationResult,
  formatTranslationDiagnostics,
  formatTranslationTaskFailure,
  queryLibraryTranslationTask,
  resolveTranslationStageLabel,
  startLibraryTranslationTask,
} from "./libraryTranslation";
import {
  defaultLibraryTranslationSession,
  isTranslationTaskMissingError,
  loadLibraryTranslationSession,
  persistLibraryTranslationSession,
  translationSessionFromStatus,
  type LibraryTranslationSession,
} from "./libraryTranslationSessionStore";

type TranslationFn = (key: any) => string;
type TranslationNotice = { type: "info" | "error"; message: string } | null;
type Listener = () => void;

export type LibraryTranslationProgress = {
  taskId: string;
  status: string;
  currentPage: number;
  totalPages: number;
  stage: string;
  stageLabel: string;
  message: string;
};

const POLL_INTERVAL_MS = 300;
const STATUS_QUERY_RETRY_DELAYS_MS = [240, 520, 960] as const;
const sessionCache = new Map<string, LibraryTranslationSession>();
const sessionListeners = new Map<string, Set<Listener>>();
const sessionPolls = new Map<string, number>();

function toSessionKey(projectId: string, selectedPath: string): string {
  return `${projectId}::${selectedPath}`;
}

function parseSessionKey(key: string): { projectId: string; selectedPath: string } | null {
  const parts = key.split("::");
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    return null;
  }
  return { projectId: parts[0], selectedPath: parts[1] };
}

function readSession(projectId: string, selectedPath: string): LibraryTranslationSession {
  const sessionKey = toSessionKey(projectId, selectedPath);
  const cached = sessionCache.get(sessionKey);
  if (cached) {
    return cached;
  }
  const loaded = loadLibraryTranslationSession(projectId, selectedPath);
  sessionCache.set(sessionKey, loaded);
  return loaded;
}

function writeSession(
  projectId: string,
  selectedPath: string,
  next: LibraryTranslationSession,
) {
  const sessionKey = toSessionKey(projectId, selectedPath);
  sessionCache.set(sessionKey, next);
  persistLibraryTranslationSession(projectId, selectedPath, next);
  const listeners = sessionListeners.get(sessionKey);
  if (!listeners) {
    return;
  }
  for (const listener of listeners) {
    listener();
  }
}

function patchSession(
  projectId: string,
  selectedPath: string,
  update:
    | Partial<LibraryTranslationSession>
    | ((current: LibraryTranslationSession) => LibraryTranslationSession),
) {
  const current = readSession(projectId, selectedPath);
  const next = typeof update === "function"
    ? update(current)
    : {
        ...current,
        ...update,
      };
  writeSession(projectId, selectedPath, next);
  return next;
}

function subscribeSession(projectId: string, selectedPath: string, listener: Listener) {
  const sessionKey = toSessionKey(projectId, selectedPath);
  const listeners = sessionListeners.get(sessionKey) ?? new Set<Listener>();
  listeners.add(listener);
  sessionListeners.set(sessionKey, listeners);
  return () => {
    const current = sessionListeners.get(sessionKey);
    if (!current) {
      return;
    }
    current.delete(listener);
    if (current.size === 0) {
      sessionListeners.delete(sessionKey);
    }
  };
}

function clearPolling(sessionKey: string) {
  const timer = sessionPolls.get(sessionKey);
  if (timer !== undefined) {
    window.clearTimeout(timer);
    sessionPolls.delete(sessionKey);
  }
}

function schedulePolling(
  projectId: string,
  selectedPath: string,
  delayMs: number,
  t: TranslationFn,
) {
  const sessionKey = toSessionKey(projectId, selectedPath);
  clearPolling(sessionKey);
  const timer = window.setTimeout(() => {
    sessionPolls.delete(sessionKey);
    void pollTranslationSession(projectId, selectedPath, t);
  }, delayMs);
  sessionPolls.set(sessionKey, timer);
}

async function pollTranslationSession(
  projectId: string,
  selectedPath: string,
  t: TranslationFn,
) {
  const current = readSession(projectId, selectedPath);
  if (current.status !== "running" || !current.taskId) {
    clearPolling(toSessionKey(projectId, selectedPath));
    return;
  }

  let status: Awaited<ReturnType<typeof queryLibraryTranslationTask>> | null = null;
  let queryError: unknown = null;
  for (let retry = 0; retry <= STATUS_QUERY_RETRY_DELAYS_MS.length; retry += 1) {
    try {
      status = await queryLibraryTranslationTask(current.taskId);
      queryError = null;
      break;
    } catch (error) {
      queryError = error;
      if (retry >= STATUS_QUERY_RETRY_DELAYS_MS.length) {
        break;
      }
      await new Promise((resolve) => window.setTimeout(resolve, STATUS_QUERY_RETRY_DELAYS_MS[retry]));
    }
  }

  if (!status) {
    if (isTranslationTaskMissingError(queryError)) {
      patchSession(projectId, selectedPath, {
        status: "interrupted",
        errorMessage: t("library.viewer.translationInterrupted"),
        stage: "interrupted",
        message: "interrupted",
      });
      clearPolling(toSessionKey(projectId, selectedPath));
      return;
    }
    schedulePolling(projectId, selectedPath, POLL_INTERVAL_MS, t);
    return;
  }

  const next = patchSession(projectId, selectedPath, (session) =>
    translationSessionFromStatus(session, status),
  );
  if (status.status === "completed") {
    const parsed = ensureTranslationResult(status.result, t);
    patchSession(projectId, selectedPath, {
      ...next,
      status: "completed",
      detail: parsed.detail,
      errorMessage: null,
      sourcePdfRelativePath: parsed.sourcePdfRelativePath,
      translatedPdfRelativePath: parsed.translatedPdfRelativePath,
    });
    clearPolling(toSessionKey(projectId, selectedPath));
    return;
  }

  if (status.status === "failed") {
    patchSession(projectId, selectedPath, {
      ...next,
      status: "failed",
      detail: formatTranslationDiagnostics(status),
      errorMessage: formatTranslationTaskFailure(status, t),
    });
    clearPolling(toSessionKey(projectId, selectedPath));
    return;
  }

  schedulePolling(projectId, selectedPath, POLL_INTERVAL_MS, t);
}

function ensureTranslationPolling(
  projectId: string,
  selectedPath: string,
  t: TranslationFn,
) {
  const sessionKey = toSessionKey(projectId, selectedPath);
  if (sessionPolls.has(sessionKey)) {
    return;
  }
  void pollTranslationSession(projectId, selectedPath, t);
}

export function useLibraryTranslationPanel(params: {
  projectId: string | null;
  selectedPath: string | null;
  translationModelId?: string | null;
  t: TranslationFn;
}) {
  const { projectId, selectedPath, translationModelId, t } = params;
  const [translationNotice, setTranslationNotice] = useState<TranslationNotice>(null);
  const [session, setSession] = useState<LibraryTranslationSession>(defaultLibraryTranslationSession());
  const previousSessionRef = useRef<LibraryTranslationSession | null>(null);

  useEffect(() => {
    if (!projectId || !selectedPath) {
      setSession(defaultLibraryTranslationSession());
      return;
    }
    const apply = () => setSession(readSession(projectId, selectedPath));
    apply();
    const unsubscribe = subscribeSession(projectId, selectedPath, apply);
    const current = readSession(projectId, selectedPath);
    if (current.status === "running" && current.taskId) {
      ensureTranslationPolling(projectId, selectedPath, t);
    }
    return unsubscribe;
  }, [projectId, selectedPath, t]);

  useEffect(() => {
    if (!translationNotice) {
      return;
    }
    const timer = window.setTimeout(() => setTranslationNotice(null), 2800);
    return () => window.clearTimeout(timer);
  }, [translationNotice]);

  useEffect(() => {
    const previous = previousSessionRef.current;
    previousSessionRef.current = session;
    if (!previous || previous.taskId === session.taskId && previous.status === session.status) {
      return;
    }
    if (session.status === "completed") {
      setTranslationNotice({ type: "info", message: t("library.viewer.translateSaved") });
      return;
    }
    if (session.status === "failed" && session.errorMessage) {
      setTranslationNotice({ type: "error", message: session.errorMessage });
      return;
    }
    if (session.status === "interrupted") {
      setTranslationNotice({ type: "error", message: t("library.viewer.translationInterrupted") });
    }
  }, [session, t]);

  const translationProgress = useMemo<LibraryTranslationProgress | null>(() => {
    if (!session.taskId || session.status !== "running") {
      return null;
    }
    const stage = session.stage || session.message || "running";
    const message = session.message || stage || "running";
    return {
      taskId: session.taskId,
      status: session.status,
      currentPage: session.currentPage,
      totalPages: session.totalPages,
      stage,
      stageLabel: resolveTranslationStageLabel(stage, message, t),
      message,
    };
  }, [session, t]);

  const loadTranslatedFromCache = useCallback(async () => {
    if (!projectId || !selectedPath) {
      setSession(defaultLibraryTranslationSession());
      return;
    }
    try {
      const preview = await libraryResolvePdfPreview(projectId, selectedPath);
      patchSession(projectId, selectedPath, (current) => ({
        ...current,
        status: preview.translatedRelativePath ? "completed" : current.status,
        sourcePdfRelativePath: preview.relativePath ?? current.sourcePdfRelativePath,
        translatedPdfRelativePath: preview.translatedRelativePath ?? current.translatedPdfRelativePath,
      }));
    } catch {
      // Ignore preview errors; the live translation task state remains authoritative.
    }
  }, [projectId, selectedPath]);

  const resetTranslationState = useCallback(() => {
    setTranslationNotice(null);
  }, []);

  const runTranslation = useCallback(() => {
    if (!projectId || !selectedPath) {
      return;
    }
    const current = readSession(projectId, selectedPath);
    if (current.status === "running" && current.taskId) {
      ensureTranslationPolling(projectId, selectedPath, t);
      return;
    }

    patchSession(projectId, selectedPath, {
      taskId: null,
      status: "running",
      stage: "queued",
      message: "queued",
      currentPage: 0,
      totalPages: 0,
      detail: "",
      errorMessage: null,
    });

    void startLibraryTranslationTask({
      projectId,
      selectedPath,
      translationModelId,
      t,
    })
      .then((started) => {
        if (!started.taskId) {
          throw new Error(t("library.viewer.translateFailed"));
        }
        patchSession(projectId, selectedPath, {
          taskId: started.taskId,
          status: "running",
          stage: "queued",
          message: "queued",
          currentPage: 0,
          totalPages: 0,
          errorMessage: null,
        });
        ensureTranslationPolling(projectId, selectedPath, t);
      })
      .catch((error) => {
        patchSession(projectId, selectedPath, {
          status: "failed",
          errorMessage: error instanceof Error ? error.message : String(error),
          stage: "failed",
          message: "failed",
        });
      });
  }, [projectId, selectedPath, t, translationModelId]);

  return {
    translationBusy: session.status === "running",
    translationNotice,
    translationDetail: session.detail,
    translationProgress,
    sourcePdfRelativePath: session.sourcePdfRelativePath,
    translatedPdfRelativePath: session.translatedPdfRelativePath,
    hasTranslated: Boolean(session.translatedPdfRelativePath && session.translatedPdfRelativePath.trim()),
    translationState: session.status,
    setTranslationNotice,
    resetTranslationState,
    loadTranslatedFromCache,
    runTranslation,
  };
}

export function resumePersistedLibraryTranslationSessions(t: TranslationFn) {
  if (typeof window === "undefined") {
    return;
  }
  for (const [key, session] of sessionCache.entries()) {
    if (session.status !== "running" || !session.taskId) {
      continue;
    }
    const parsed = parseSessionKey(key);
    if (!parsed) {
      continue;
    }
    ensureTranslationPolling(parsed.projectId, parsed.selectedPath, t);
  }
}
