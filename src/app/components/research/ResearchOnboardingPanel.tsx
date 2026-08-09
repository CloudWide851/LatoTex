import { Check, Circle, ShieldCheck } from "lucide-react";
import { useEffect, useMemo } from "react";
import { Select } from "../../../components/ui/select";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type {
  AppSettings,
  OnboardingStep,
  ResearchDomain,
} from "../../../shared/types/app";
import {
  normalizeOnboardingState,
  ONBOARDING_STEPS,
  RESEARCH_DOMAINS,
} from "../../onboarding/onboardingState";
import { cspStyle } from "../../../shared/ui/cspStyle";

type TranslationFn = (key: MessageKey) => string;

function OnboardingRow(props: {
  done: boolean;
  label: string;
  doneLabel: string;
  actionLabel?: string;
  onAction?: () => void;
}) {
  return (
    <div className="app-material-inset flex min-h-11 items-center gap-3 rounded-md border px-3 py-2">
      {props.done
        ? <Check className="h-4 w-4 shrink-0 text-[color:var(--app-accent)]" aria-hidden="true" />
        : <Circle className="h-4 w-4 shrink-0 text-[color:var(--app-muted)]" aria-hidden="true" />}
      <span className="min-w-0 flex-1 text-xs text-[color:var(--app-text)]">{props.label}</span>
      {props.done ? (
        <span className="text-[11px] text-[color:var(--app-muted)]">{props.doneLabel}</span>
      ) : props.onAction && props.actionLabel ? (
        <button
          type="button"
          className="text-[11px] font-medium text-[color:var(--app-accent)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2"
          onClick={props.onAction}
        >
          {props.actionLabel}
        </button>
      ) : null}
    </div>
  );
}

export function ResearchOnboardingPanel(props: {
  projectId: string;
  settings: AppSettings | null;
  modelConfigured: boolean;
  privacyReviewed: boolean;
  questionAsked: boolean;
  planAvailable: boolean;
  onDismiss: () => void;
  onRestart: () => void;
  onRecordStep: (step: OnboardingStep) => void;
  onResearchDomainChange: (domain: ResearchDomain) => void;
  onOpenPrivacy: () => void;
  onOpenModels: () => void;
  onOpenAgent: () => void;
  t: TranslationFn;
}) {
  const {
    projectId,
    settings,
    modelConfigured,
    privacyReviewed,
    questionAsked,
    planAvailable,
    onDismiss,
    onRestart,
    onRecordStep,
    onResearchDomainChange,
    onOpenPrivacy,
    onOpenModels,
    onOpenAgent,
    t,
  } = props;
  const state = normalizeOnboardingState(settings?.uiPrefs?.onboarding);
  const projectState = state?.projectId === projectId ? state : undefined;
  const projectGoal = settings?.uiPrefs?.researchGoalByProject?.[projectId]?.trim() ?? "";
  const domain = settings?.uiPrefs?.researchDomainByProject?.[projectId];
  const completedStepsKey = (projectState?.completedSteps ?? []).join("|");
  const completed = useMemo(
    () => new Set(projectState?.completedSteps ?? []),
    [completedStepsKey],
  );
  const active = projectState?.status === "active";

  useEffect(() => {
    if (!active) return;
    const derived: Array<[OnboardingStep, boolean]> = [
      ["goal", Boolean(projectGoal)],
      ["domain_privacy", Boolean(domain && privacyReviewed)],
      ["model", modelConfigured],
      ["question", questionAsked],
    ];
    for (const [step, done] of derived) {
      if (done && !completed.has(step)) {
        onRecordStep(step);
      }
    }
  }, [active, completed, domain, modelConfigured, onRecordStep, privacyReviewed, projectGoal, questionAsked]);

  const completedCount = projectState?.completedSteps.length ?? 0;
  const progress = Math.round((completedCount / ONBOARDING_STEPS.length) * 100);

  return (
    <article className="app-material-shell rounded-lg border p-4 sm:p-5" aria-labelledby="research-onboarding-title">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-4 w-4 text-[color:var(--app-accent)]" aria-hidden="true" />
            <h2 id="research-onboarding-title" className="text-sm font-semibold text-[color:var(--app-text)]">
              {t("overview.onboarding.title")}
            </h2>
          </div>
          <p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">
            {t("overview.onboarding.description")} {t("overview.onboarding.time")}
          </p>
        </div>
        {active ? (
          <button type="button" className="text-xs text-[color:var(--app-muted)] hover:text-[color:var(--app-text)]" onClick={onDismiss}>
            {t("overview.onboarding.skip")}
          </button>
        ) : projectState?.status !== "completed" ? (
          <button type="button" className="control-button control-button--secondary px-3 py-1.5 text-xs" onClick={onRestart}>
            {t(projectState?.status === "dismissed" ? "overview.onboarding.resume" : "overview.onboarding.start")}
          </button>
        ) : null}
      </div>

      <div className="mt-4" role="status" aria-label={t("overview.onboarding.progress")}>
        <div className="h-1 overflow-hidden rounded-full bg-[color:var(--editor-paper-edge)]">
          <div
            className="h-full bg-[color:var(--app-accent)] transition-transform motion-reduce:transition-none"
            {...cspStyle({ transform: `scaleX(${progress / 100})`, transformOrigin: "left" })}
          />
        </div>
        <p className="mt-1 text-[10px] text-[color:var(--app-muted)]">
          {completedCount}/{ONBOARDING_STEPS.length} · {t("overview.onboarding.progress")}
        </p>
      </div>

      {active || projectState?.status === "completed" ? (
        <div className="mt-4 grid gap-2">
          <OnboardingRow done={completed.has("goal")} label={t("overview.onboarding.goal")} doneLabel={t("overview.onboarding.complete")} />
          <div className="app-material-inset grid gap-2 rounded-md border px-3 py-2 sm:grid-cols-[minmax(0,1fr)_minmax(10rem,0.65fr)_auto] sm:items-center">
            <span className="text-xs text-[color:var(--app-text)]">{t("overview.onboarding.domainPrivacy")}</span>
            <Select
              value={domain ?? ""}
              aria-label={t("overview.onboarding.domainLabel")}
              disabled={!active}
              onChange={(event) => onResearchDomainChange(event.currentTarget.value as ResearchDomain)}
            >
              <option value="" disabled>{t("overview.onboarding.domainPlaceholder")}</option>
              {RESEARCH_DOMAINS.map((item) => (
                <option key={item} value={item}>{t(`overview.onboarding.domain.${item}`)}</option>
              ))}
            </Select>
            {completed.has("domain_privacy") ? (
              <span className="text-[11px] text-[color:var(--app-muted)]">{t("overview.onboarding.complete")}</span>
            ) : (
              <button type="button" className="text-left text-[11px] font-medium text-[color:var(--app-accent)]" onClick={onOpenPrivacy}>
                {t("overview.onboarding.openPrivacy")}
              </button>
            )}
          </div>
          <OnboardingRow done={completed.has("model")} label={t("overview.onboarding.model")} doneLabel={t("overview.onboarding.complete")} actionLabel={t("overview.onboarding.openModels")} onAction={onOpenModels} />
          <OnboardingRow done={completed.has("question")} label={t("overview.onboarding.question")} doneLabel={t("overview.onboarding.complete")} actionLabel={t("overview.onboarding.openAgent")} onAction={onOpenAgent} />
          <OnboardingRow done={completed.has("plan_review")} label={t("overview.onboarding.planReview")} doneLabel={t("overview.onboarding.complete")} actionLabel={planAvailable ? t("overview.onboarding.reviewPlan") : undefined} onAction={planAvailable ? onOpenAgent : undefined} />
        </div>
      ) : null}
    </article>
  );
}
