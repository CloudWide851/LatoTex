import { useCallback, useEffect } from "react";
import type { AppSettings, OnboardingStep, ResearchDomain } from "../../shared/types/app";
import type { CompileActionResult } from "./compileActionTypes";
import {
  applyOnboardingEventToSettings,
  ONBOARDING_PLAN_REVIEW_EVENT,
  ONBOARDING_RESEARCH_QUESTION_EVENT,
} from "../onboarding/onboardingState";

export function useOnboardingController(params: {
  activeProjectId: string | null;
  setSettings: React.Dispatch<React.SetStateAction<AppSettings | null>>;
  onCompile: () => Promise<CompileActionResult | null>;
}) {
  const {
    activeProjectId,
    setSettings,
    onCompile,
  } = params;
  const record = useCallback((event: Parameters<typeof applyOnboardingEventToSettings>[1]) => {
    setSettings((current) => current
      ? applyOnboardingEventToSettings(current, event)
      : current);
  }, [setSettings]);

  const recordStep = useCallback((step: OnboardingStep) => {
    if (activeProjectId) {
      record({ type: "record", projectId: activeProjectId, step });
    }
  }, [activeProjectId, record]);

  const restart = useCallback(() => {
    if (activeProjectId) {
      record({ type: "restart", projectId: activeProjectId });
    }
  }, [activeProjectId, record]);

  const saveProjectGoal = useCallback((goal: string) => {
    if (!activeProjectId) return;
    const normalized = goal.trim().slice(0, 4_000);
    if (!normalized) return;
    setSettings((current) => current ? {
      ...current,
      uiPrefs: {
        ...(current.uiPrefs ?? {}),
        researchGoalByProject: {
          ...(current.uiPrefs?.researchGoalByProject ?? {}),
          [activeProjectId]: normalized,
        },
      },
    } : current);
    record({ type: "record", projectId: activeProjectId, step: "goal" });
  }, [activeProjectId, record, setSettings]);

  const saveResearchDomain = useCallback((domain: ResearchDomain) => {
    if (!activeProjectId) return;
    setSettings((current) => current ? {
      ...current,
      uiPrefs: {
        ...(current.uiPrefs ?? {}),
        researchDomainByProject: {
          ...(current.uiPrefs?.researchDomainByProject ?? {}),
          [activeProjectId]: domain,
        },
      },
    } : current);
  }, [activeProjectId, setSettings]);

  const markResearchPrivacyReviewed = useCallback(() => {
    if (!activeProjectId) return;
    setSettings((current) => current ? {
      ...current,
      uiPrefs: {
        ...(current.uiPrefs ?? {}),
        researchPrivacyReviewedByProject: {
          ...(current.uiPrefs?.researchPrivacyReviewedByProject ?? {}),
          [activeProjectId]: true,
        },
      },
    } : current);
  }, [activeProjectId, setSettings]);

  useEffect(() => {
    if (!activeProjectId || typeof window === "undefined") return;
    const milestone = (step: OnboardingStep) => (event: Event) => {
      const projectId = (event as CustomEvent<{ projectId?: string }>).detail?.projectId;
      if (projectId === activeProjectId) {
        record({ type: "record", projectId: activeProjectId, step });
      }
    };
    const onQuestion = milestone("question");
    const onPlanReview = milestone("plan_review");
    window.addEventListener(ONBOARDING_RESEARCH_QUESTION_EVENT, onQuestion);
    window.addEventListener(ONBOARDING_PLAN_REVIEW_EVENT, onPlanReview);
    return () => {
      window.removeEventListener(ONBOARDING_RESEARCH_QUESTION_EVENT, onQuestion);
      window.removeEventListener(ONBOARDING_PLAN_REVIEW_EVENT, onPlanReview);
    };
  }, [activeProjectId, record]);

  const handleCompile = useCallback(async () => {
    return onCompile();
  }, [onCompile]);

  const handlePdfViewed = useCallback(() => undefined, []);

  const handleDismiss = useCallback(() => {
    if (activeProjectId) {
      record({ type: "dismiss", projectId: activeProjectId });
    }
  }, [activeProjectId, record]);

  return {
    handleCompile,
    handlePdfViewed,
    handleDismiss,
    recordStep,
    restart,
    markResearchPrivacyReviewed,
    saveProjectGoal,
    saveResearchDomain,
  };
}
