import { Play, RefreshCcw } from "lucide-react";
import { cn } from "../../../lib/utils";
import { SvgSpinner } from "../../../components/ui/svg-spinner";

type TranslationFn = (key: any) => string;

export function AnalysisPromptOverlay(props: {
  prompt: string;
  canRun: boolean;
  running: boolean;
  busy: boolean;
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onRefresh: () => void;
  t: TranslationFn;
}) {
  const { prompt, canRun, running, busy, onPromptChange, onRun, onRefresh, t } = props;

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
      <div className="pointer-events-auto w-[min(920px,100%)] rounded-lg border border-slate-300 bg-white/95 p-3 shadow-soft motion-slide-up">
        <div className="relative">
          <textarea
            className={cn(
              "h-[96px] w-full resize-none rounded-lg border border-slate-300 bg-white px-3 py-2 pr-24 text-sm text-slate-700 outline-none transition",
              "focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
            )}
            value={prompt}
            placeholder={t("analysis.promptPlaceholder")}
            onChange={(event) => onPromptChange(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                if (!busy && canRun && !running) {
                  onRun();
                }
              }
            }}
          />
          <div className="absolute bottom-2 right-2 flex items-center gap-2">
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-600 transition hover:bg-slate-100 disabled:opacity-40"
              title={t("analysis.refresh")}
              aria-label={t("analysis.refresh")}
              onClick={onRefresh}
              disabled={running || busy}
            >
              <RefreshCcw className="h-4 w-4" />
            </button>
            <button
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-700 disabled:opacity-40"
              title={running ? t("analysis.running") : t("analysis.run")}
              aria-label={running ? t("analysis.running") : t("analysis.run")}
              onClick={onRun}
              disabled={!canRun || running || busy}
            >
              {running ? <SvgSpinner className="h-4 w-4 text-white" /> : <Play className="h-4 w-4" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
