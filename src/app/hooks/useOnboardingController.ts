import { useCallback, useEffect, useMemo } from "react";
import type { AppSettings } from "../../shared/types/app";
import type { CompileActionResult } from "./compileActionTypes";
import {
  applyOnboardingEventToSettings,
  normalizeOnboardingState,
} from "../onboarding/onboardingState";

export function useOnboardingController(params: {
  activeProjectId: string | null;
  selectedTextFileReadyPath: string | null;
  onboarding: unknown;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  onCompile: () => Promise<CompileActionResult | null>;
}) {
  const {
    activeProjectId,
    selectedTextFileReadyPath,
    onboarding,
    setSettings,
    onCompile,
  } = params;
  const onboardingState = useMemo(() => normalizeOnboardingState(onboarding), [onboarding]);

  const record = useCallback((event: Parameters<typeof applyOnboardingEventToSettings>[1]) => {
    setSettings((current) => current
      ? applyOnboardingEventToSettings(current, event)
      : current);
  }, [setSettings]);

  useEffect(() => {
    if (
      !activeProjectId
      || selectedTextFileReadyPath?.toLowerCase() !== "main.tex"
      || onboardingState?.status !== "active"
      || onboardingState.projectId !== activeProjectId
      || onboardingState.completedSteps.includes("open")
    ) {
      return;
    }
    record({ type: "record", projectId: activeProjectId, step: "open" });
  }, [activeProjectId, onboardingState, record, selectedTextFileReadyPath]);

  const handleCompile = useCallback(async () => {
    const result = await onCompile();
    if (activeProjectId && result?.status === "success") {
      record({ type: "record", projectId: activeProjectId, step: "compile" });
    }
    return result;
  }, [activeProjectId, onCompile, record]);

  const handlePdfViewed = useCallback(() => {
    if (activeProjectId) {
      record({ type: "record", projectId: activeProjectId, step: "view" });
    }
  }, [activeProjectId, record]);

  const handleDismiss = useCallback(() => {
    if (activeProjectId) {
      record({ type: "dismiss", projectId: activeProjectId });
    }
  }, [activeProjectId, record]);

  return { handleCompile, handlePdfViewed, handleDismiss };
}
