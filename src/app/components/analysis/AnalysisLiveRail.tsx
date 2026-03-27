import type { AnalysisTimelineCard } from "./AnalysisRunTimeline";

type TranslationFn = (key: any) => string;

function latestTicker(cards: AnalysisTimelineCard[], fallback: string): string {
  const latest = cards[cards.length - 1];
  if (!latest) {
    return fallback;
  }
  return latest.content?.trim() || latest.title?.trim() || latest.source?.trim() || fallback;
}

export function AnalysisLiveRail(props: {
  stageLabel: string;
  cards: AnalysisTimelineCard[];
  running: boolean;
  t: TranslationFn;
}) {
  const { stageLabel, cards, running, t } = props;
  const normalizedStage = stageLabel.trim() || t("analysis.centerRunning");
  const tickerText = latestTicker(cards, "");
  const eventCount = cards.length;

  return (
    <section className="rounded-lg border border-slate-200 bg-slate-50 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${running ? "bg-blue-500 animate-pulse" : "bg-slate-400"}`} />
          <span className="text-xs font-medium uppercase text-blue-700">{t("analysis.liveStage")}</span>
          <span className="truncate text-sm font-medium text-slate-700">{normalizedStage}</span>
        </div>
        <span className="text-xs tabular-nums text-slate-500">{String(eventCount).padStart(2, "0")}</span>
      </div>
      {tickerText && (
        <div className="mt-2 truncate text-xs text-slate-600">
          {tickerText}
        </div>
      )}
    </section>
  );
}
