import { cn } from "../../../lib/utils";
import type { AgentEventCard } from "../../hooks/analysisWorkspaceHelpers";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import { AgentActionRenderer } from "./AgentActionRenderer";

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

function normalizePathRef(value: string): string {
  return value
    .replace(/^file:/i, "")
    .replace(/^paper:/i, "")
    .trim();
}

function extractContentPaths(content: string): string[] {
  return content
    .split(/\r?\n/g)
    .map((line) => line.match(/path:\s*(.+)$/i)?.[1]?.trim() ?? "")
    .filter((value) => value.length > 0);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values.filter((item) => item.trim().length > 0)));
}

function isAnalysisCard(card: AgentEventCard): boolean {
  const haystack = `${card.stage} ${card.title} ${card.content}`.toLowerCase();
  return haystack.includes("analysis") || haystack.includes("paper analyze") || haystack.includes("synthesize");
}

function isFileCard(card: AgentEventCard): boolean {
  const haystack = `${card.stage} ${card.title} ${card.content}`.toLowerCase();
  return haystack.includes("edit")
    || haystack.includes("write")
    || haystack.includes("apply")
    || haystack.includes("checkpoint")
    || card.artifactRefs?.some((item) => item.startsWith("file:")) === true;
}

function taskKey(card: AgentEventCard): string {
  return card.nodeId
    || card.parentNodeId
    || card.artifactRefs?.find((item) => item.startsWith("file:"))
    || `${card.stage}:${card.cardKey}`;
}

function taskLabel(card: AgentEventCard, t: (key: any) => string): string {
  if (isAnalysisCard(card)) {
    return t("agent.task.analysis");
  }
  if (isFileCard(card)) {
    return t("agent.task.fileEdit");
  }
  return card.title || card.stage || t("agent.task.generic");
}

type TaskGroup = {
  key: string;
  label: string;
  status: string;
  steps: AgentEventCard[];
  inputRefs: string[];
  outputRefs: string[];
  requiresApproval: boolean;
  teamRoleName?: string;
};

function buildTaskGroups(cards: AgentEventCard[], t: (key: any) => string): TaskGroup[] {
  const groups = new Map<string, TaskGroup>();
  for (const card of cards) {
    const key = taskKey(card);
    const refs = unique([
      ...(card.artifactRefs ?? []).map(normalizePathRef),
      ...extractContentPaths(card.content),
    ]);
    const nextLabel = taskLabel(card, t);
    const outputLike = isAnalysisCard(card)
      || `${card.stage} ${card.title}`.toLowerCase().includes("checkpoint")
      || `${card.stage} ${card.title}`.toLowerCase().includes("output")
      || `${card.stage} ${card.title}`.toLowerCase().includes("apply");
    const group = groups.get(key) ?? {
      key,
      label: nextLabel,
      status: card.status,
      steps: [],
      inputRefs: [],
      outputRefs: [],
      requiresApproval: false,
      teamRoleName: card.teamRoleName,
    };
    group.label = group.label || nextLabel;
    group.status = card.status || group.status;
    group.steps.push(card);
    group.requiresApproval = group.requiresApproval || card.requiresApproval === true;
    group.teamRoleName = card.teamRoleName ?? group.teamRoleName;
    if (outputLike) {
      group.outputRefs = unique([...group.outputRefs, ...refs]);
    } else {
      group.inputRefs = unique([...group.inputRefs, ...refs]);
    }
    if (group.outputRefs.length === 0 && isFileCard(card) && refs.length > 0) {
      group.outputRefs = unique([...group.outputRefs, ...refs]);
    }
    groups.set(key, group);
  }
  return Array.from(groups.values());
}

export function AgentTraceCards(props: {
  cards: AgentEventCard[];
  title: string;
  pendingAction?: AgentPendingAction;
  pendingActionTitle?: string;
  pendingActionDescription?: string;
  pendingActionYesLabel?: string;
  pendingActionNoLabel?: string;
  onPendingActionResolve?: (accept: boolean) => void;
  t: (key: any) => string;
  className?: string;
  bodyClassName?: string;
}) {
  const {
    cards,
    title,
    pendingAction,
    pendingActionTitle,
    pendingActionDescription,
    pendingActionYesLabel,
    pendingActionNoLabel,
    onPendingActionResolve,
    t,
    className,
    bodyClassName,
  } = props;
  const groups = buildTaskGroups(cards, t);
  if (groups.length === 0 && !pendingAction) {
    return null;
  }

  return (
    <section className={cn("flex min-h-0 flex-col border-b border-slate-200 px-3 py-2", className)}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className={cn("min-h-0 overflow-auto space-y-2", bodyClassName)}>
        {groups.map((group) => (
          <article key={group.key} className={cn("rounded border px-2 py-2 text-[11px]", tone(group.status))}>
            <div className="flex items-center justify-between gap-2">
              <span className="truncate font-semibold">{group.teamRoleName ?? group.label}</span>
              <span className="max-w-[40%] truncate uppercase opacity-80">{group.steps[group.steps.length - 1]?.status || group.status}</span>
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {group.steps[group.steps.length - 1]?.phase ? badge(group.steps[group.steps.length - 1]?.phase ?? "", "phase") : null}
              {group.steps[group.steps.length - 1]?.decision ? badge(group.steps[group.steps.length - 1]?.decision ?? "", "decision") : null}
              {group.steps[group.steps.length - 1]?.riskLevel ? badge(group.steps[group.steps.length - 1]?.riskLevel ?? "", "risk") : null}
              {group.requiresApproval ? badge(t("agent.task.approvalBadge"), "approval") : null}
            </div>
            {group.inputRefs.length > 0 ? (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("agent.task.inputs")}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {group.inputRefs.slice(0, 6).map((item) => (
                    <span key={`${group.key}:in:${item}`} className="rounded border border-slate-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-slate-600">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            {group.outputRefs.length > 0 ? (
              <div className="mt-2">
                <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("agent.task.outputs")}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {group.outputRefs.slice(0, 6).map((item) => (
                    <span key={`${group.key}:out:${item}`} className="rounded border border-emerald-200 bg-white px-1.5 py-0.5 font-mono text-[10px] text-emerald-700">
                      {item}
                    </span>
                  ))}
                </div>
              </div>
            ) : null}
            <div className="mt-2">
              <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{t("agent.task.steps")}</div>
              <div className="mt-1 space-y-1">
                {group.steps.slice(-5).map((card) => (
                  <div key={`${card.runId}:${card.cardKey}`} className="rounded border border-slate-200 bg-white/70 px-2 py-1">
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate font-medium text-slate-700">{card.title}</span>
                      <span className="truncate text-[10px] uppercase text-slate-500">{card.stage}</span>
                    </div>
                    {card.content ? (
                      <p className="mt-1 whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-700">
                        {card.content}
                      </p>
                    ) : null}
                    <AgentActionRenderer actions={card.actions ?? []} />
                  </div>
                ))}
              </div>
            </div>
          </article>
        ))}
        {pendingAction?.kind === "autoCommit" && onPendingActionResolve ? (
          <article className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-800">
            <div className="font-semibold">{pendingActionTitle}</div>
            <div className="mt-1">{pendingActionDescription}</div>
            <div className="mt-2 flex gap-2">
              <button
                className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs text-white"
                onClick={() => onPendingActionResolve(true)}
              >
                {pendingActionYesLabel}
              </button>
              <button
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700"
                onClick={() => onPendingActionResolve(false)}
              >
                {pendingActionNoLabel}
              </button>
            </div>
          </article>
        ) : null}
      </div>
    </section>
  );
}
