import { useCallback, useEffect, useRef, useState } from "react";
import {
  analysisEnvPrepare,
  analysisEnvStatus,
  pickAnalysisEnvDirectory,
} from "../../shared/api/analysis";
import type { AnalysisEnvStatus, AppSettings } from "../../shared/types/app";

type TranslationFn = (key: any) => string;
type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

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
  t: TranslationFn;
  setToast: ToastSetter;
}) {
  const { activeProjectId, settings, persistSettings, t, setToast } = params;
  const dismissedProjectIdsRef = useRef<Set<string>>(new Set());
  const [envPromptProjectId, setEnvPromptProjectId] = useState<string | null>(null);
  const [envPromptStatus, setEnvPromptStatus] = useState<AnalysisEnvStatus | null>(null);
  const [envPromptOpen, setEnvPromptOpen] = useState(false);
  const [envPromptBusy, setEnvPromptBusy] = useState(false);

  const reloadStatus = useCallback(async (projectId: string) => {
    const status = await analysisEnvStatus(projectId);
    if (status.ready) {
      setEnvPromptStatus(status);
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
    if (!activeProjectId) {
      setEnvPromptProjectId(null);
      setEnvPromptStatus(null);
      setEnvPromptOpen(false);
      return;
    }
    if (dismissedProjectIdsRef.current.has(activeProjectId)) {
      setEnvPromptOpen(false);
      return;
    }

    let cancelled = false;
    reloadStatus(activeProjectId)
      .catch(() => {
        if (!cancelled) {
          setEnvPromptOpen(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, reloadStatus]);

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
      setEnvPromptBusy(false);
    }
  }, [envPromptBusy, envPromptProjectId, persistSettings, reloadStatus, setToast, settings]);

  const handleEnvPromptCreate = useCallback(async () => {
    if (!envPromptProjectId || envPromptBusy) {
      return;
    }
    setEnvPromptBusy(true);
    try {
      const status = await analysisEnvPrepare(envPromptProjectId);
      setEnvPromptStatus(status);
      dismissedProjectIdsRef.current.delete(envPromptProjectId);
      setEnvPromptOpen(false);
      setToast({ type: "info", message: t("analysis.envPromptReady") });
    } catch (error) {
      setToast({ type: "error", message: String(error) });
    } finally {
      setEnvPromptBusy(false);
    }
  }, [envPromptBusy, envPromptProjectId, setToast, t]);

  return {
    envPromptOpen,
    envPromptBusy,
    envPromptStatus,
    handleEnvPromptLater,
    handleEnvPromptPickLocation,
    handleEnvPromptCreate,
  };
}
