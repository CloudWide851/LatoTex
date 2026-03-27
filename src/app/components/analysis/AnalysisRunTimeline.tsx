import { cn } from "../../../lib/utils";

type TranslationFn = (key: any) => string;

export type AnalysisTimelineCard = {
  id: string;
  runId: string;
  stage: string;
  source: string;
  status: string;
  title: string;
  content: string;
  createdAt: string;
};

function statusTone(status: string): string {
  if (status === "error" || status === "failed") {
    return "border-rose-300 bg-rose-50 text-rose-700";
  }
  if (status === "success" || status === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

export function AnalysisRunTimeline(props: {
  cards: AnalysisTimelineCard[];
  t: TranslationFn;
  compact?: boolean;
  maxCards?: number;
}) {
  const { cards, t, compact = false, maxCards } = props;
  const displayCards = typeof maxCards === "number" ? cards.slice(-maxCards) : cards;

  return (
    <section className={cn(
      "min-h-0 overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2",
      compact ? "motion-card-pop" : "",
    )}>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analysis.timeline")}</h4>
      {displayCards.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 px-2 py-2 text-[11px] text-slate-500">
          {t("analysis.timelineEmpty")}
        </div>
      ) : (
        <div className="space-y-1">
          {displayCards.map((card) => (
            <article
              key={`${card.runId}:${card.id}`}
              className={cn(
                "rounded border px-2 py-1 text-xs",
                statusTone(card.status),
                compact ? "motion-hover-rise" : "",
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-semibold">{card.title}</span>
                <span className="max-w-[45%] truncate uppercase">{card.stage}</span>
              </div>
              {card.content ? (
                <p className={cn(
                  "mt-1 whitespace-pre-wrap break-words text-[11px]",
                  compact ? "line-clamp-3 leading-4" : "leading-5",
                )}>
                  {card.content}
                </p>
              ) : (
                <p className="mt-1 text-[11px] opacity-80">{card.source}</p>
              )}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}

