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
  const tickerText = latestTicker(cards, normalizedStage);
  const eventCount = cards.length;

  return (
    <section className="analysis-live-rail motion-card-pop">
      <div className="analysis-live-rail__stage min-w-0">
        <span className={`analysis-live-rail__dot ${running ? "analysis-live-rail__dot--active" : ""}`} />
        <span className="motion-status-chip analysis-live-rail__label">{t("analysis.liveStage")}</span>
        <span className="truncate text-sm font-medium text-slate-700">{normalizedStage}</span>
      </div>
      <div className="analysis-live-rail__progress" aria-hidden="true">
        <span className="analysis-live-rail__progress-runner" />
      </div>
      <div className="analysis-live-rail__ticker" aria-live="polite">
        <span key={tickerText} className="analysis-live-rail__ticker-item">
          {tickerText}
        </span>
      </div>
      <span className="analysis-live-rail__count tabular-nums">{String(eventCount).padStart(2, "0")}</span>
    </section>
  );
}
