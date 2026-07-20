import { CheckCircle2, Circle, X } from "lucide-react";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { OnboardingStep } from "../../../shared/types/app";
import { normalizeOnboardingState, ONBOARDING_STEPS } from "../../onboarding/onboardingState";

type TranslationFn = (key: MessageKey) => string;

const STEP_KEYS: Record<OnboardingStep, MessageKey> = {
  open: "workspace.onboarding.step.open",
  compile: "workspace.onboarding.step.compile",
  view: "workspace.onboarding.step.view",
};

export function WorkspaceOnboardingChecklist(props: {
  activeProjectId: string;
  onboarding: unknown;
  onDismiss: () => void;
  t: TranslationFn;
}) {
  const { activeProjectId, onboarding, onDismiss, t } = props;
  const state = normalizeOnboardingState(onboarding);
  if (!state || state.status !== "active" || state.projectId !== activeProjectId) {
    return null;
  }

  return (
    <aside
      className="app-material-floating absolute right-4 top-4 z-40 w-[min(21rem,calc(100%-2rem))] rounded-xl border p-3 shadow-lg motion-slide-up"
      aria-labelledby="workspace-onboarding-title"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="workspace-onboarding-title" className="text-sm font-semibold text-slate-900">
            {t("workspace.onboarding.title")}
          </h2>
          <p className="mt-1 text-xs leading-5 text-slate-500">
            {t("workspace.onboarding.description")}
          </p>
        </div>
        <button
          type="button"
          className="control-button control-button--ghost -mr-1 -mt-1 inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg"
          aria-label={t("workspace.onboarding.dismiss")}
          title={t("workspace.onboarding.dismiss")}
          onClick={onDismiss}
        >
          <X className="h-4 w-4" aria-hidden="true" />
        </button>
      </div>
      <ol className="mt-3 space-y-2">
        {ONBOARDING_STEPS.map((step) => {
          const complete = state.completedSteps.includes(step);
          const Icon = complete ? CheckCircle2 : Circle;
          return (
            <li
              key={step}
              className="app-material-inset flex items-center gap-2 rounded-lg border px-2.5 py-2 text-xs"
            >
              <Icon
                className={complete ? "h-4 w-4 text-[color:var(--app-status-success)]" : "h-4 w-4 text-slate-400"}
                aria-hidden="true"
              />
              <span className={complete ? "text-slate-500 line-through" : "text-slate-700"}>
                {t(STEP_KEYS[step])}
              </span>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}
