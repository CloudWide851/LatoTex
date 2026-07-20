import type { AppSettings, OnboardingState, OnboardingStep } from "../../shared/types/app";

export const ONBOARDING_VERSION = 1;
export const ONBOARDING_STEPS: readonly OnboardingStep[] = ["open", "compile", "view"];

export type OnboardingEvent =
  | { type: "restart"; projectId: string }
  | { type: "record"; projectId: string; step: OnboardingStep }
  | { type: "dismiss"; projectId: string };

export function startOnboarding(projectId: string): OnboardingState {
  return {
    version: ONBOARDING_VERSION,
    status: "active",
    projectId,
    completedSteps: [],
  };
}

export function normalizeOnboardingState(value: unknown): OnboardingState | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const candidate = value as Partial<OnboardingState>;
  if (
    candidate.version !== ONBOARDING_VERSION
    || !["active", "dismissed", "completed"].includes(String(candidate.status))
  ) {
    return undefined;
  }
  const completedSteps = ONBOARDING_STEPS.filter((step) =>
    Array.isArray(candidate.completedSteps) && candidate.completedSteps.includes(step),
  );
  return {
    version: ONBOARDING_VERSION,
    status: candidate.status as OnboardingState["status"],
    projectId: typeof candidate.projectId === "string" ? candidate.projectId : undefined,
    completedSteps,
  };
}

export function reduceOnboarding(
  current: OnboardingState | undefined,
  event: OnboardingEvent,
): OnboardingState | undefined {
  if (event.type === "restart") {
    return startOnboarding(event.projectId);
  }
  const state = normalizeOnboardingState(current);
  if (!state || state.status !== "active" || state.projectId !== event.projectId) {
    return current;
  }
  if (event.type === "dismiss") {
    return { ...state, status: "dismissed" };
  }
  if (state.completedSteps.includes(event.step)) {
    return current;
  }
  const completedSteps = ONBOARDING_STEPS.filter((step) =>
    state.completedSteps.includes(step) || step === event.step,
  );
  return {
    ...state,
    completedSteps,
    status: completedSteps.length === ONBOARDING_STEPS.length ? "completed" : "active",
  };
}

export function applyOnboardingEventToSettings(
  settings: AppSettings,
  event: OnboardingEvent,
): AppSettings {
  const current = normalizeOnboardingState(settings.uiPrefs?.onboarding);
  const next = reduceOnboarding(current, event);
  if (next === current || next === settings.uiPrefs?.onboarding) {
    return settings;
  }
  return {
    ...settings,
    activeProjectId: event.type === "restart" ? event.projectId : settings.activeProjectId,
    uiPrefs: {
      ...(settings.uiPrefs ?? {}),
      onboarding: next,
    },
  };
}
