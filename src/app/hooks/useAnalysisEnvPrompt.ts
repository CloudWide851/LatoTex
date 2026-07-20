import { useCallback, useEffect, useRef, useState } from "react";
import {
  analysisEnvPrepare,
  analysisEnvPrepareStart,
  analysisEnvPrepareStatus,
  analysisEnvStatus,
  pickAnalysisEnvDirectory,
} from "../../shared/api/analysis";
import type { AnalysisEnvPrepareTaskStatus, AnalysisEnvStatus, AppSettings } from "../../shared/types/app";
import { nativeRuntimeFailureMessageKey, normalizeNativeRuntimeFailure } from "./analysisEnvFailure";

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
  const autoStartedProjectIdsRef = useRef<Set<string>>(new Set());
  const mountedRef = useRef(true);
  const [envPromptProjectId, setEnvPromptProjectId] = useState<string | null>(null);
  const [envPromptStatus, setEnvPromptStatus] = useState<AnalysisEnvStatus | null>(null);
  const [envPromptTaskStatus, setEnvPromptTaskStatus] = useState<AnalysisEnvPrepareTaskStatus | null>(null);
  const [envPromptOpen, setEnvPromptOpen] = useState(false);
  const [envPromptBusy, setEnvPromptBusy] = useState(false);

  useEffect(() => () => {
    mountedRef.current = false;
  }, []);

  const reloadStatus = useCallback(async (projectId: string, openWhenMissing = true) => {
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
    setEnvPromptOpen(openWhenMissing);
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
    reloadStatus(activeProjectId, false).catch(() => {
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
        throw status.failure ?? status.error ?? "python.env.prepare_failed";
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
    } catch {
      setToast({ type: "error", message: t("analysis.envPromptError.pathSelection") });
    } finally {
      if (mountedRef.current) {
        setEnvPromptBusy(false);
      }
    }
  }, [envPromptBusy, envPromptProjectId, persistSettings, reloadStatus, setToast, settings, t]);

  const handleEnvPromptCreate = useCallback(async (options?: {
    openPrompt?: boolean;
    showReadyToast?: boolean;
    explicitRetry?: boolean;
  }) => {
    if (!envPromptProjectId || envPromptBusy) {
      return;
    }
    const openPrompt = options?.openPrompt ?? true;
    const showReadyToast = options?.showReadyToast ?? true;
    const explicitRetry = options?.explicitRetry ?? true;
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
    setEnvPromptOpen(openPrompt);
    try {
      const started = await analysisEnvPrepareStart(envPromptProjectId, explicitRetry);
      if (mountedRef.current) {
        setEnvPromptTaskStatus((prev) => prev ? { ...prev, taskId: started.taskId } : prev);
      }
      const finalTaskStatus = await pollPrepareTask(started.taskId);
      const finalStatus = finalTaskStatus.result ?? await analysisEnvPrepare(envPromptProjectId, false);
      if (!mountedRef.current) {
        return;
      }
      setEnvPromptStatus(finalStatus);
      setEnvPromptTaskStatus(finalTaskStatus);
      dismissedProjectIdsRef.current.delete(envPromptProjectId);
      autoStartedProjectIdsRef.current.delete(envPromptProjectId);
      setEnvPromptOpen(false);
      if (showReadyToast) {
        setToast({ type: "info", message: t("analysis.envPromptReady") });
      }
    } catch (error) {
      const failure = normalizeNativeRuntimeFailure(error, envPromptTaskStatus?.stage ?? "failed");
      const message = t(nativeRuntimeFailureMessageKey(failure));
      if (!mountedRef.current) {
        return;
      }
      setEnvPromptTaskStatus((prev) => prev ? {
        ...prev,
        status: "failed",
        stage: failure.stage,
        error: failure.code,
        diagnostics: failure.diagnostics,
        failure,
      } : {
        taskId: "failed",
        status: "failed",
        stage: failure.stage,
        percent: 0,
        message: failure.code,
        error: failure.code,
        diagnostics: failure.diagnostics,
        failure,
      });
      setEnvPromptStatus((prev) => prev ? { ...prev, lastError: failure.code, failure } : prev);
      setEnvPromptOpen(true);
      setToast({ type: "error", message });
    } finally {
      if (mountedRef.current) {
        setEnvPromptBusy(false);
      }
    }
  }, [envPromptBusy, envPromptProjectId, envPromptStatus?.managedRoot, envPromptStatus?.venvPath, envPromptTaskStatus?.stage, pollPrepareTask, setToast, t]);

  useEffect(() => {
    if (!enabled || !activeProjectId || envPromptProjectId !== activeProjectId || !envPromptStatus) {
      return;
    }
    if (envPromptStatus.ready || dismissedProjectIdsRef.current.has(activeProjectId)) {
      return;
    }
    if (envPromptBusy || envPromptTaskStatus?.status === "running") {
      return;
    }
    if (autoStartedProjectIdsRef.current.has(activeProjectId)) {
      return;
    }
    autoStartedProjectIdsRef.current.add(activeProjectId);
    void handleEnvPromptCreate({ openPrompt: false, showReadyToast: false, explicitRetry: false });
  }, [
    activeProjectId,
    enabled,
    envPromptBusy,
    envPromptProjectId,
    envPromptStatus,
    envPromptTaskStatus?.status,
    handleEnvPromptCreate,
  ]);

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
