import { cn } from "../../../lib/utils";
import type { AgentEventCard } from "../../hooks/analysisWorkspaceHelpers";

function tone(status: string): string {
  if (status === "error" || status === "failed") {
    return "border-rose-200 bg-rose-50 text-rose-700";
  }
  if (status === "success" || status === "completed") {
    return "border-emerald-200 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function badgeTone(kind: "phase" | "decision" | "risk" | "approval", value: string): string {
  if (kind === "decision") {
    if (value === "accept") {
      return "border-emerald-200 bg-emerald-100 text-emerald-700";
    }
    if (value === "revise") {
      return "border-amber-200 bg-amber-100 text-amber-700";
    }
    return "border-rose-200 bg-rose-100 text-rose-700";
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
  return "border-slate-200 bg-white text-slate-600";
}

function badge(label: string, kind: "phase" | "decision" | "risk" | "approval") {
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full border px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide",
        badgeTone(kind, label),
      )}
    >
      {label}
    </span>
  );
}

export function AgentTraceCards(props: {
  cards: AgentEventCard[];
  title: string;
  maxCards?: number;
}) {
  const { cards, title, maxCards } = props;
  const displayCards = typeof maxCards === "number" ? cards.slice(-maxCards) : cards;
  if (displayCards.length === 0) {
    return null;
  }

  return (
    <section className="border-b border-slate-200 px-3 py-2">
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="space-y-1.5">
        {displayCards.map((card) => (
          <article key={`${card.runId}:${card.cardKey}`} className={cn("rounded border px-2 py-1.5 text-[11px]", tone(card.status))}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{card.title}</span>
              <span className="max-w-[40%] truncate uppercase opacity-80">{card.stage}</span>
            </div>
            {(card.phase || card.decision || card.riskLevel || card.requiresApproval) ? (
              <div className="mt-1 flex flex-wrap gap-1">
                {card.phase ? badge(card.phase, "phase") : null}
                {card.decision ? badge(card.decision, "decision") : null}
                {card.riskLevel ? badge(card.riskLevel, "risk") : null}
                {card.requiresApproval ? badge("approval", "approval") : null}
              </div>
            ) : null}
            {card.content ? (
              <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-700">
                {card.content}
              </p>
            ) : null}
            {Array.isArray(card.artifactRefs) && card.artifactRefs.length > 0 ? (
              <p className="mt-1 truncate text-[10px] text-slate-500">
                {card.artifactRefs.slice(0, 3).join(" · ")}
              </p>
            ) : null}
          </article>
        ))}
      </div>
    </section>
  );
}
