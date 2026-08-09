import type { AnalysisPreflightState } from "../../hooks/analysisTypes";
import { analysisPreflightCanSubmit } from "../../hooks/analysisPreflight";
import { Button } from "../../../components/ui/button";

type TranslationFn = (key: any) => string;

export function AnalysisPreflightPanel(props: {
  preflight: AnalysisPreflightState;
  onAnswerChange: (questionId: string, values: string[]) => void;
  onSubmit: () => void;
  onCancel: () => void;
  t: TranslationFn;
}) {
  const { preflight, onAnswerChange, onSubmit, onCancel, t } = props;
  const spec = preflight.plan.spec;
  const canSubmit = analysisPreflightCanSubmit(preflight.questions, preflight.answers);
  const designFields = spec
    ? [
      spec.groupColumn,
      spec.subjectColumn,
      spec.timeColumn,
      spec.eventColumn,
      spec.effectColumn,
      spec.standardErrorColumn,
    ].filter((value): value is string => Boolean(value))
    : [];
  return (
    <section className="app-material-content grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-xl border p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-[color:var(--app-accent)]">
          {t("analysis.preflight.kicker")}
        </p>
        <h3 className="mt-1 text-base font-semibold text-[color:var(--editor-tab-text)]">{t("analysis.preflight.title")}</h3>
        <p className="mt-1 max-w-2xl text-xs leading-5 text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.description")}</p>
      </div>
      <div className="settings-scrollbar-hidden min-h-0 overflow-auto py-3">
        <div className="grid gap-3">
          {spec ? (
            <section className="app-material-inset rounded-xl border p-3" aria-labelledby="analysis-spec-title">
              <h4 id="analysis-spec-title" className="text-sm font-semibold text-[color:var(--editor-tab-text)]">
                {t("analysis.preflight.specTitle")}
              </h4>
              <dl className="mt-2 grid gap-x-4 gap-y-2 text-xs sm:grid-cols-[9rem_minmax(0,1fr)]">
                <dt className="text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.specMethod")}</dt>
                <dd className="font-medium text-[color:var(--editor-tab-text)]">
                  {t(`analysis.preflight.method.${spec.methodFamily}`)}
                </dd>
                <dt className="text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.specOutcome")}</dt>
                <dd className="min-w-0 break-all text-[color:var(--editor-tab-text)]">
                  {spec.outcome ?? t("analysis.preflight.specNone")}
                </dd>
                <dt className="text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.specPredictors")}</dt>
                <dd className="min-w-0 break-words text-[color:var(--editor-tab-text)]">
                  {spec.predictors.join(", ") || t("analysis.preflight.specNone")}
                </dd>
                <dt className="text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.specDesignFields")}</dt>
                <dd className="min-w-0 break-words text-[color:var(--editor-tab-text)]">
                  {designFields.join(" · ") || t("analysis.preflight.specNone")}
                </dd>
                <dt className="text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.specStrategies")}</dt>
                <dd className="break-words text-[color:var(--editor-tab-text)]">
                  {[
                    spec.missingValueStrategy,
                    spec.transformationStrategy,
                    spec.outlierStrategy,
                    spec.multipleComparisonStrategy,
                  ].map((value) => t(`analysis.preflight.value.${value}`)).join(" / ")}
                </dd>
                <dt className="text-[color:var(--editor-tab-muted)]">{t("analysis.preflight.specParameters")}</dt>
                <dd className="break-words text-[color:var(--editor-tab-text)]">
                  {[
                    `α=${spec.alpha}`,
                    `${spec.randomSeed}`,
                    spec.power
                      ? `${spec.power.effectSize} / ${spec.power.targetPower} / ${spec.power.groupRatio}`
                      : null,
                  ].filter((value): value is string => Boolean(value)).join(" / ")}
                </dd>
              </dl>
            </section>
          ) : null}
          {preflight.questions.map((question) => {
            const selected = new Set(preflight.answers[question.id] ?? []);
            return (
              <fieldset key={question.id} className="app-material-inset rounded-xl border p-3">
                <legend className="px-1 text-sm font-semibold text-[color:var(--editor-tab-text)]">{question.title}</legend>
                <p className="mb-2 text-xs leading-5 text-[color:var(--editor-tab-muted)]">{question.description}</p>
                <div className="grid gap-1.5">
                  {question.options.map((option) => {
                    const checked = selected.has(option.id);
                    return (
                      <label key={option.id} className="control-surface flex min-h-9 cursor-pointer items-start gap-2 rounded-lg border px-2.5 py-2 text-xs text-[color:var(--editor-tab-text)] transition-colors hover:border-[color:var(--app-accent)]">
                        <input
                          className="mt-0.5"
                          type={question.multiple ? "checkbox" : "radio"}
                          checked={checked}
                          onChange={(event) => {
                            const next = question.multiple
                              ? event.currentTarget.checked
                                ? Array.from(new Set([...selected, option.id]))
                                : Array.from(selected).filter((item) => item !== option.id)
                              : [option.id];
                            onAnswerChange(question.id, next);
                          }}
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-medium">{option.label}</span>
                          {option.detail ? <span className="block truncate text-[11px] text-[color:var(--editor-tab-muted)]">{option.detail}</span> : null}
                        </span>
                      </label>
                    );
                  })}
                </div>
              </fieldset>
            );
          })}
        </div>
      </div>
      <div className="flex items-center justify-end gap-2 border-t border-[color:var(--editor-widget-border)] pt-3">
        <Button size="sm" variant="ghost" onClick={onCancel}>{t("analysis.preflight.cancel")}</Button>
        <Button size="sm" disabled={!canSubmit} onClick={onSubmit}>{t("analysis.preflight.submit")}</Button>
      </div>
    </section>
  );
}
