import { useCallback, useEffect, useRef, useState } from "react";
import { analysisEnvPrepare, analysisEnvStatus } from "../../shared/api/analysis";
import type { AnalysisEnvStatus } from "../../shared/types/app";

type TranslationFn = (key: any) => string;
type ToastSetter = (value: { type: "info" | "error"; message: string } | null) => void;

export function useAnalysisEnvPrompt(params: {
  activeProjectId: string | null;
  t: TranslationFn;
  setToast: ToastSetter;
}) {
  const { activeProjectId, t, setToast } = params;
  const dismissedProjectIdsRef = useRef<Set<string>>(new Set());
  const [envPromptProjectId, setEnvPromptProjectId] = useState<string | null>(null);
  const [envPromptStatus, setEnvPromptStatus] = useState<AnalysisEnvStatus | null>(null);
  const [envPromptOpen, setEnvPromptOpen] = useState(false);
  const [envPromptBusy, setEnvPromptBusy] = useState(false);

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
    analysisEnvStatus(activeProjectId)
      .then((status) => {
        if (cancelled) {
          return;
        }
        if (status.ready) {
          if (envPromptProjectId === activeProjectId) {
            setEnvPromptOpen(false);
            setEnvPromptProjectId(null);
            setEnvPromptStatus(null);
          }
          return;
        }
        setEnvPromptProjectId(activeProjectId);
        setEnvPromptStatus(status);
        setEnvPromptOpen(true);
      })
      .catch(() => {
        if (!cancelled) {
          setEnvPromptOpen(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [activeProjectId, envPromptProjectId]);

  const handleEnvPromptLater = useCallback(() => {
    if (envPromptProjectId) {
      dismissedProjectIdsRef.current.add(envPromptProjectId);
    }
    setEnvPromptOpen(false);
  }, [envPromptProjectId]);

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
    handleEnvPromptCreate,
  };
}
