import type {
  AppSettings,
  OnboardingState,
  OnboardingStep,
  ResearchDomain,
} from "../../shared/types/app";

export const ONBOARDING_VERSION = 2;
export const ONBOARDING_RESEARCH_QUESTION_EVENT = "latotex.onboarding.research-question";
export const ONBOARDING_PLAN_REVIEW_EVENT = "latotex.onboarding.plan-review";
export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  "goal",
  "domain_privacy",
  "model",
  "question",
  "plan_review",
];

export const RESEARCH_DOMAINS: readonly ResearchDomain[] = [
  "general",
  "life_sciences",
  "social_sciences",
  "engineering",
];

const RESEARCH_DOMAIN_SET = new Set<string>(RESEARCH_DOMAINS);

export function normalizeResearchGoalByProject(value: unknown): Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .map(([projectId, goal]) => [projectId.trim(), goal.trim().slice(0, 4_000)])
      .filter(([projectId, goal]) => projectId.length > 0 && goal.length > 0),
  );
}

export function normalizeResearchDomainByProject(value: unknown): Record<string, ResearchDomain> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const normalized: Record<string, ResearchDomain> = {};
  for (const [projectIdRaw, domainRaw] of Object.entries(value)) {
    const projectId = projectIdRaw.trim();
    const domain = typeof domainRaw === "string" ? domainRaw.trim() : "";
    if (projectId && RESEARCH_DOMAIN_SET.has(domain)) {
      normalized[projectId] = domain as ResearchDomain;
    }
  }
  return normalized;
}

export function normalizeResearchPrivacyReviewedByProject(value: unknown): Record<string, boolean> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value)
      .map(([projectId, reviewed]) => [projectId.trim(), reviewed] as const)
      .filter(([projectId, reviewed]) => Boolean(projectId) && reviewed === true),
  );
}

export type OnboardingEvent =
  | { type: "restart"; projectId: string }
  | { type: "record"; projectId: string; step: OnboardingStep }
  | { type: "dismiss"; projectId: string };

export function emitOnboardingMilestone(
  eventName: typeof ONBOARDING_RESEARCH_QUESTION_EVENT | typeof ONBOARDING_PLAN_REVIEW_EVENT,
  projectId: string,
) {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return;
  }
  window.dispatchEvent(new CustomEvent(eventName, { detail: { projectId } }));
}

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
