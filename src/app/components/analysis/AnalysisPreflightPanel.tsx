import type { AnalysisPreflightState } from "../../hooks/analysisTypes";
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
        <Button size="sm" onClick={onSubmit}>{t("analysis.preflight.submit")}</Button>
      </div>
    </section>
  );
}
