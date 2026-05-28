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
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] rounded-lg border border-primary-200 bg-primary-50/40 p-4">
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.22em] text-primary-700">
          {t("analysis.preflight.kicker")}
        </p>
        <h3 className="mt-1 text-base font-semibold text-slate-900">{t("analysis.preflight.title")}</h3>
        <p className="mt-1 text-xs leading-5 text-slate-600">{t("analysis.preflight.description")}</p>
      </div>
      <div className="settings-scrollbar-hidden min-h-0 overflow-auto py-3">
        <div className="grid gap-3">
          {preflight.questions.map((question) => {
            const selected = new Set(preflight.answers[question.id] ?? []);
            return (
              <fieldset key={question.id} className="rounded-lg border border-slate-200 bg-white p-3">
                <legend className="px-1 text-sm font-semibold text-slate-800">{question.title}</legend>
                <p className="mb-2 text-xs leading-5 text-slate-500">{question.description}</p>
                <div className="grid gap-1.5">
                  {question.options.map((option) => {
                    const checked = selected.has(option.id);
                    return (
                      <label key={option.id} className="flex cursor-pointer items-start gap-2 rounded-md border border-slate-200 px-2 py-1.5 text-xs text-slate-700 hover:bg-slate-50">
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
                          {option.detail ? <span className="block truncate text-[11px] text-slate-500">{option.detail}</span> : null}
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
      <div className="flex items-center justify-end gap-2 border-t border-primary-100 pt-3">
        <Button size="sm" variant="ghost" onClick={onCancel}>{t("analysis.preflight.cancel")}</Button>
        <Button size="sm" onClick={onSubmit}>{t("analysis.preflight.submit")}</Button>
      </div>
    </section>
  );
}
