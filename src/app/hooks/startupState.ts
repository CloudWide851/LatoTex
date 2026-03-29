import type { AnalysisEnvStatus } from "../../shared/types/app";

export type AppStartupPhase = "booting" | "warming" | "actionRequired" | "ready" | "failed";
export type AppStartupStepStatus = "pending" | "running" | "ready" | "actionRequired" | "failed";
export type AppStartupStepKey =
  | "health"
  | "settings"
  | "projects"
  | "projectData"
  | "git"
  | "drawio"
  | "tectonic"
  | "analysisEnv";
export type ComponentStartupState = "startupBlocked" | "ready" | "error";

export type AppStartupStep = {
  key: AppStartupStepKey;
  labelKey: string;
  status: AppStartupStepStatus;
  detail: string | null;
  progress: number | null;
};

export type AppStartupState = {
  phase: AppStartupPhase;
  steps: AppStartupStep[];
  error: string | null;
  blocking: boolean;
  currentStepKey: AppStartupStepKey | null;
  analysisEnvStatus: AnalysisEnvStatus | null;
};

const STEP_LABELS: Record<AppStartupStepKey, string> = {
  health: "app.startup.step.health",
  settings: "app.startup.step.settings",
  projects: "app.startup.step.projects",
  projectData: "app.startup.step.projectData",
  git: "app.startup.step.git",
  drawio: "app.startup.step.drawio",
  tectonic: "app.startup.step.tectonic",
  analysisEnv: "app.startup.step.analysisEnv",
};

export const APP_STARTUP_STEP_ORDER: AppStartupStepKey[] = [
  "health",
  "settings",
  "projects",
  "projectData",
  "git",
  "drawio",
  "tectonic",
  "analysisEnv",
];

export function createAppStartupSteps(): AppStartupStep[] {
  return APP_STARTUP_STEP_ORDER.map((key) => ({
    key,
    labelKey: STEP_LABELS[key],
    status: "pending",
    detail: null,
    progress: null,
  }));
}

export function createInitialAppStartupState(): AppStartupState {
  return {
    phase: "booting",
    steps: createAppStartupSteps(),
    error: null,
    blocking: true,
    currentStepKey: null,
    analysisEnvStatus: null,
  };
}

export function updateAppStartupSteps(
  steps: AppStartupStep[],
  key: AppStartupStepKey,
  patch: Partial<Omit<AppStartupStep, "key" | "labelKey">>,
): AppStartupStep[] {
  return steps.map((step) => (step.key === key ? { ...step, ...patch } : step));
}

export function deriveStartupProgress(steps: AppStartupStep[]): number {
  if (steps.length === 0) {
    return 0;
  }
  const total = steps.reduce((sum, step) => {
    if (step.status === "ready") {
      return sum + 1;
    }
    if (step.status === "running" || step.status === "actionRequired" || step.status === "failed") {
      return sum + 0.5;
    }
    return sum;
  }, 0);
  return Math.max(0, Math.min(100, Math.round((total / steps.length) * 100)));
}

export function deriveComponentStartupState(phase: AppStartupPhase): ComponentStartupState {
  if (phase === "ready") {
    return "ready";
  }
  if (phase === "failed") {
    return "error";
  }
  return "startupBlocked";
}
