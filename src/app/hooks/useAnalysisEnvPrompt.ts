import { useCallback, useEffect, useRef, useState } from "react";
import {
  analysisEnvPrepare,
  analysisEnvPrepareStart,
  analysisEnvPrepareStatus,
  analysisEnvStatus,
  pickAnalysisEnvDirectory,
} from "../../shared/api/analysis";
import type { AnalysisEnvPrepareTaskStatus, AnalysisEnvStatus, AppSettings } from "../../shared/types/app";

type TranslationFn = (key: any) => string;
type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

const ENV_PREPARE_POLL_MS = 280;
const ENV_PREPARE_POLL_LIMIT = 1600;

function buildNextAnalysisEnvSettings(
  settings: AppSettings,
  projectId: string,
  baseDir: string,
): AppSettings {
  const trimmedBaseDir = baseDir.trim();
  const nextRootsByProject = {
    ...(settings.uiPrefs?.analysisEnvRootsByProject ?? {}),
  };
  if (trimmedBaseDir) {
    nextRootsByProject[projectId] = trimmedBaseDir;
  }
  return {
    ...settings,
    uiPrefs: {
      ...(settings.uiPrefs ?? {}),
      analysisEnvRootsByProject: nextRootsByProject,
    },
  };
}

export function useAnalysisEnvPrompt(params: {
  activeProjectId: string | null;
  settings: AppSettings | null;
  persistSettings: (settings: AppSettings) => Promise<AppSettings>;
  enabled?: boolean;
  t: TranslationFn;
  setToast: ToastSetter;
}) {
  const { activeProjectId, settings, persistSettings, enabled = true, t, setToast } = params;
  const dismissedProjectIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const [envPromptProjectId, setEnvPromptProjectId] = useState<string | null>(null);
  const [envPromptStatus, setEnvPromptStatus] = useState<AnalysisEnvStatus | null>(null);
  const [envPromptTaskStatus, setEnvPromptTaskStatus] = useState<AnalysisEnvPrepareTaskStatus | null>(null);
  const [envPromptOpen, setEnvPromptOpen] = useState(false);
  const [envPromptBusy, setEnvPromptBusy] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const reloadStatus = useCallback(async (projectId: string) => {
    const status = await analysisEnvStatus(projectId);
    if (!mountedRef.current) {
      return status;
    }
    if (status.ready) {
      setEnvPromptStatus(status);
      setEnvPromptTaskStatus(null);
      setEnvPromptOpen(false);
      setEnvPromptProjectId((current) => (current === projectId ? null : current));
      return status;
    }
    setEnvPromptProjectId(projectId);
    setEnvPromptStatus(status);
    setEnvPromptOpen(true);
    return status;
  }, []);

  useEffect(() => {
    if (!enabled) {
      setEnvPromptProjectId(null);
      setEnvPromptStatus(null);
      setEnvPromptTaskStatus(null);
      setEnvPromptOpen(false);
      return;
    }
    if (!activeProjectId) {
      setEnvPromptProjectId(null);
      setEnvPromptStatus(null);
      setEnvPromptTaskStatus(null);
      setEnvPromptOpen(false);
      return;
    }
    if (dismissedProjectIdsRef.current.has(activeProjectId)) {
      setEnvPromptOpen(false);
      return;
    }

    let cancelled = false;
    reloadStatus(activeProjectId).catch(() => {
      if (!cancelled && mountedRef.current) {
        setEnvPromptOpen(false);
      }
    });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, enabled, reloadStatus]);

  const pollPrepareTask = useCallback(async (taskId: string) => {
    for (let round = 0; round < ENV_PREPARE_POLL_LIMIT; round += 1) {
      const status = await analysisEnvPrepareStatus(taskId);
      if (!mountedRef.current) {
        return status;
      }
      setEnvPromptTaskStatus(status);
      if (status.status === "completed") {
        return status;
      }
      if (status.status === "failed") {
        throw new Error(String(status.error || status.diagnostics?.[0] || "analysis env prepare failed"));
      }
      await new Promise((resolve) => window.setTimeout(resolve, ENV_PREPARE_POLL_MS));
    }
    throw new Error("analysis.env.prepare_timeout");
  }, []);

  const handleEnvPromptLater = useCallback(() => {
    if (envPromptProjectId) {
      dismissedProjectIdsRef.current.add(envPromptProjectId);
    }
    setEnvPromptOpen(false);
  }, [envPromptProjectId]);

  const handleEnvPromptPickLocation = useCallback(async () => {
    if (!envPromptProjectId || !settings || envPromptBusy) {
      return;
    }
    setEnvPromptBusy(true);
    try {
      const pickedDirectory = await pickAnalysisEnvDirectory();
      if (!pickedDirectory) {
        return;
      }
      await persistSettings(
        buildNextAnalysisEnvSettings(settings, envPromptProjectId, pickedDirectory),
      );
      dismissedProjectIdsRef.current.delete(envPromptProjectId);
      await reloadStatus(envPromptProjectId);
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      if (mountedRef.current) {
        setEnvPromptBusy(false);
      }
    }
  }, [envPromptBusy, envPromptProjectId, persistSettings, reloadStatus, setToast, settings]);

  const handleEnvPromptCreate = useCallback(async () => {
    if (!envPromptProjectId || envPromptBusy) {
      return;
    }
    setEnvPromptBusy(true);
    setEnvPromptTaskStatus({
      taskId: "pending",
      status: "running",
      stage: "queued",
      percent: 0,
      message: "queued",
      currentItem: envPromptStatus?.venvPath ?? envPromptStatus?.managedRoot ?? null,
      diagnostics: [],
    });
    setEnvPromptOpen(true);
    try {
      const started = await analysisEnvPrepareStart(envPromptProjectId);
      if (mountedRef.current) {
        setEnvPromptTaskStatus((prev) => prev ? { ...prev, taskId: started.taskId } : prev);
      }
      const finalTaskStatus = await pollPrepareTask(started.taskId);
      const finalStatus = finalTaskStatus.result ?? await analysisEnvPrepare(envPromptProjectId);
      if (!mountedRef.current) {
        return;
      }
      setEnvPromptStatus(finalStatus);
      setEnvPromptTaskStatus(finalTaskStatus);
      dismissedProjectIdsRef.current.delete(envPromptProjectId);
      setEnvPromptOpen(false);
      setToast({ type: "info", message: t("analysis.envPromptReady") });
    } catch (error) {
      const message = String(error);
      if (!mountedRef.current) {
        return;
      }
      setEnvPromptTaskStatus((prev) => prev ? {
        ...prev,
        status: "failed",
        stage: prev.stage ?? "failed",
        error: message,
        diagnostics: [message],
      } : {
        taskId: "failed",
        status: "failed",
        stage: "failed",
        percent: 0,
        message,
        error: message,
        diagnostics: [message],
      });
      setEnvPromptStatus((prev) => prev ? { ...prev, lastError: message } : prev);
      setEnvPromptOpen(true);
      setToast({ type: "error", message });
    } finally {
      if (mountedRef.current) {
        setEnvPromptBusy(false);
      }
    }
  }, [envPromptBusy, envPromptProjectId, envPromptStatus?.managedRoot, envPromptStatus?.venvPath, pollPrepareTask, setToast, t]);

  return {
    envPromptOpen,
    envPromptBusy,
    envPromptStatus,
    envPromptTaskStatus,
    handleEnvPromptLater,
    handleEnvPromptPickLocation,
    handleEnvPromptCreate,
  };
}
