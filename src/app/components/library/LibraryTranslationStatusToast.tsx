import type { LibraryTranslationProgress } from "./useLibraryTranslationPanel";

type TranslationFn = (key: any) => string;

export function LibraryTranslationStatusToast(props: {
  progress: LibraryTranslationProgress | null;
  busy: boolean;
  t: TranslationFn;
}) {
  const { progress, busy, t } = props;
  if (!busy || !progress) {
    return null;
  }

  const percent = progress.totalPages > 0
    ? Math.max(0, Math.min(100, Math.round((progress.currentPage / progress.totalPages) * 100)))
    : 0;
  const progressText = progress.totalPages > 0
    ? `${progress.currentPage}/${progress.totalPages}`
    : t("library.viewer.translateProgressPending");

  return (
    <div className="pointer-events-none absolute right-3 top-3 z-20 w-64 max-w-[calc(100%-1.5rem)] rounded-xl border border-slate-200 bg-white/96 p-3 shadow-lg backdrop-blur-sm">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary-700">
            {t("library.viewer.translating")}
          </div>
          <div className="mt-1 text-sm font-medium text-slate-800">{progress.stageLabel}</div>
        </div>
        <div className="shrink-0 rounded-full bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-600">
          {progressText}
        </div>
      </div>
      <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-slate-200">
        <div className="h-full rounded-full bg-primary-600 transition-all" style={{ width: `${percent}%` }} />
      </div>
      <div className="mt-2 flex items-center justify-between gap-2 text-[11px] text-slate-500">
        <span className="min-w-0 truncate">{progress.message}</span>
        <span className="shrink-0">{percent}%</span>
      </div>
    </div>
  );
}
