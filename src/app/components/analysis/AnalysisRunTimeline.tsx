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
  phase?: string;
  decision?: string;
  riskLevel?: string;
  nodeId?: string;
  parentNodeId?: string;
  artifactRefs?: string[];
  requiresApproval?: boolean;
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

function metaBadgeTone(kind: "phase" | "decision" | "risk" | "approval", value: string): string {
  if (kind === "decision") {
    if (value === "accept") {
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    }
    if (value === "revise") {
      return "border-amber-200 bg-amber-100 text-amber-700";
    }
    if (value === "block" || value === "user_approval_required") {
      return "border-rose-200 bg-rose-100 text-rose-700";
    }
  }
  if (kind === "risk") {
    if (value === "high") {
      return "border-rose-200 bg-rose-100 text-rose-700";
    }
    if (value === "medium") {
      return "border-amber-200 bg-amber-100 text-amber-700";
    }
  }
  if (kind === "approval") {
    return "border-violet-200 bg-violet-100 text-violet-700";
  }
  return "border-slate-200 bg-white/80 text-slate-600";
}

function metaBadge(label: string, kind: "phase" | "decision" | "risk" | "approval") {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        metaBadgeTone(kind, label),
      )}
    >
      {label}
    </span>
  );
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
      "flex min-h-0 flex-col overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2",
      compact ? "motion-card-pop" : "",
    )}>
      <h4 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">{t("analysis.timeline")}</h4>
      {displayCards.length === 0 ? (
        <div className="rounded border border-dashed border-slate-300 px-2 py-2 text-[11px] text-slate-500">
          {t("analysis.timelineEmpty")}
        </div>
      ) : (
        <div className="min-h-0 overflow-auto space-y-1.5 pr-1">
          {displayCards.map((card) => (
            <article
              key={`${card.runId}:${card.id}`}
              className={cn(
                "rounded border px-2 py-1.5 text-xs",
                statusTone(card.status),
                compact ? "motion-hover-rise" : "",
              )}
            >
              <div className="flex items-center justify-between gap-2 text-[11px]">
                <span className="truncate font-semibold">{card.title}</span>
                <span className="max-w-[45%] truncate uppercase">{card.stage}</span>
              </div>
              {(card.phase || card.decision || card.riskLevel || card.requiresApproval) ? (
                <div className="mt-1 flex flex-wrap gap-1">
                  {card.phase ? metaBadge(card.phase, "phase") : null}
                  {card.decision ? metaBadge(card.decision, "decision") : null}
                  {card.riskLevel ? metaBadge(card.riskLevel, "risk") : null}
                  {card.requiresApproval ? metaBadge("approval", "approval") : null}
                </div>
              ) : null}
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
              {Array.isArray(card.artifactRefs) && card.artifactRefs.length > 0 ? (
                <p className="mt-1 truncate text-[10px] text-slate-500">
                  {card.artifactRefs.slice(0, 3).join(" · ")}
                </p>
              ) : null}
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
