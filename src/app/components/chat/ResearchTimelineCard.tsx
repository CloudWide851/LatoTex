import { BookOpenCheck, FlaskConical, ListChecks, Quote } from "lucide-react";
import type { MessageKey } from "../../../i18n/messages/en-US/index";
import type { ResearchPlanVersion, ResearchTask } from "../../../shared/types/researchAgent";

type TranslationFn = (key: MessageKey) => string;

export function ResearchTimelineCard(props: {
  task: ResearchTask;
  plan: ResearchPlanVersion | null;
  evidenceCount: number;
  t: TranslationFn;
}) {
  const { task, plan, evidenceCount, t } = props;
  const approved = plan?.approvalStatus === "approved";
  const hasAnalysisSpec = plan?.steps.some((step) => {
    if (step.capability !== "analysis.run" || !step.input || typeof step.input !== "object") {
      return false;
    }
    return Boolean((step.input as { spec?: unknown }).spec);
  }) ?? false;

  return (
    <section className="app-material-inset mt-3 overflow-hidden rounded-md border" aria-label={t(approved ? "research.timeline.planApproved" : "research.timeline.planDraft")}>
      <header className="flex flex-wrap items-center gap-2 border-b px-3 py-2">
        <BookOpenCheck className="h-3.5 w-3.5 text-[color:var(--app-accent)]" aria-hidden="true" />
        <span className="text-[11px] font-semibold text-[color:var(--app-text)]">
          {plan
            ? t(approved ? "research.timeline.planApproved" : "research.timeline.planDraft")
            : t("research.timeline.clarification")}
        </span>
        {plan ? (
          <span className="rounded border px-1.5 py-0.5 text-[10px] text-[color:var(--app-muted)]">v{plan.version}</span>
        ) : null}
        <span className="ml-auto text-[10px] text-[color:var(--app-muted)]">
          {t(`research.workbench.taskStatus.${task.status}`)}
        </span>
      </header>
      <div className="grid gap-2 px-3 py-2.5 text-[11px] leading-5">
        {plan ? (
          <>
            <p className="font-medium text-[color:var(--app-text)]">{plan.title || task.goal}</p>
            {plan.summary ? <p className="text-[color:var(--app-muted)]">{plan.summary}</p> : null}
            <div className="flex flex-wrap gap-2 text-[10px] text-[color:var(--app-muted)]">
              <span className="inline-flex items-center gap-1"><ListChecks className="h-3 w-3" />{plan.steps.length} {t("research.timeline.steps")}</span>
              <span className="inline-flex items-center gap-1"><Quote className="h-3 w-3" />{evidenceCount} {t("research.timeline.evidence")}</span>
              {hasAnalysisSpec ? <span className="inline-flex items-center gap-1"><FlaskConical className="h-3 w-3" />{t("research.timeline.analysisSpec")}</span> : null}
            </div>
            {plan.expectedArtifacts.length > 0 ? (
              <div>
                <p className="font-medium text-[color:var(--app-text)]">{t("research.timeline.expectedArtifacts")}</p>
                <p className="text-[color:var(--app-muted)]">{plan.expectedArtifacts.slice(0, 3).join(" · ")}</p>
              </div>
            ) : null}
            {plan.acceptanceCriteria.length > 0 ? (
              <div>
                <p className="font-medium text-[color:var(--app-text)]">{t("research.timeline.acceptance")}</p>
                <p className="text-[color:var(--app-muted)]">{plan.acceptanceCriteria.slice(0, 2).join(" · ")}</p>
              </div>
            ) : null}
          </>
        ) : (
          <p className="text-[color:var(--app-muted)]">{t("research.timeline.noPlan")}</p>
        )}
      </div>
    </section>
  );
}
