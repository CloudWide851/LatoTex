import { ChevronDown, ChevronRight } from "lucide-react";
import { useMemo, useState } from "react";
import { cn } from "../../../lib/utils";
import type { AgentEventCard } from "../../hooks/analysisWorkspaceHelpers";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import { VirtualizedList } from "../virtual/VirtualizedList";
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
  compact?: boolean;
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
    compact = false,
  } = props;
  const groups = useMemo(() => buildTaskGroups(cards, t), [cards, t]);
  const [expanded, setExpanded] = useState(false);
  if (groups.length === 0 && !pendingAction) {
    return null;
  }
  const latestGroup = groups[groups.length - 1];
  const latestStep = latestGroup?.steps[latestGroup.steps.length - 1];

  if (compact) {
    return (
      <section className={cn("flex min-h-0 flex-col border-b border-slate-200 px-3 py-2", className)}>
        <button
          type="button"
          className="flex min-w-0 items-center justify-between gap-2 rounded-md px-1 py-1 text-left text-[11px] text-slate-600 hover:bg-slate-50"
          onClick={() => setExpanded((prev) => !prev)}
        >
          <span className="flex min-w-0 items-center gap-1.5">
            {expanded ? <ChevronDown className="h-3 w-3 shrink-0" /> : <ChevronRight className="h-3 w-3 shrink-0" />}
            <span className="shrink-0 font-semibold uppercase tracking-wide">{title}</span>
            <span className="truncate">
              {latestStep
                ? `${latestStep.title || latestStep.stage} · ${latestStep.content || latestStep.source || latestStep.status}`
                : pendingActionTitle}
            </span>
          </span>
          <span className="shrink-0 tabular-nums text-slate-400">{groups.length}</span>
        </button>
        {expanded ? (
          <div className="mt-1 min-h-0">
            <TraceGroupList groups={groups} t={t} className={bodyClassName} />
            <PendingActionCard
              pendingAction={pendingAction}
              pendingActionTitle={pendingActionTitle}
              pendingActionDescription={pendingActionDescription}
              pendingActionYesLabel={pendingActionYesLabel}
              pendingActionNoLabel={pendingActionNoLabel}
              onPendingActionResolve={onPendingActionResolve}
            />
          </div>
        ) : null}
      </section>
    );
  }

  return (
    <section className={cn("flex min-h-0 flex-col border-b border-slate-200 px-3 py-2", className)}>
      <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500">{title}</div>
      <div className="min-h-0">
        <TraceGroupList groups={groups} t={t} className={bodyClassName} />
        <PendingActionCard
          pendingAction={pendingAction}
          pendingActionTitle={pendingActionTitle}
          pendingActionDescription={pendingActionDescription}
          pendingActionYesLabel={pendingActionYesLabel}
          pendingActionNoLabel={pendingActionNoLabel}
          onPendingActionResolve={onPendingActionResolve}
        />
      </div>
    </section>
  );
}

function TraceGroupList(props: { groups: TaskGroup[]; t: (key: any) => string; className?: string }) {
  const { groups, t, className } = props;
  if (groups.length > 18) {
    return (
      <VirtualizedList
        items={groups}
        estimatedItemHeight={220}
        overscan={6}
        fallbackViewportHeight={360}
        className={cn("min-h-0 [content-visibility:auto] [contain-intrinsic-size:360px]", className)}
        contentClassName="space-y-2"
        getKey={(group) => group.key}
        renderItem={(group) => <TraceGroup group={group} t={t} />}
      />
    );
  }
  return (
    <div className={cn("min-h-0 overflow-auto space-y-2 [content-visibility:auto] [contain-intrinsic-size:360px]", className)}>
      {groups.map((group) => <TraceGroup key={group.key} group={group} t={t} />)}
    </div>
  );
}

function TraceGroup(props: { group: TaskGroup; t: (key: any) => string }) {
  const { group, t } = props;
  const latest = group.steps[group.steps.length - 1];
  return (
    <article className={cn("rounded border px-2 py-2 text-[11px] [content-visibility:auto] [contain-intrinsic-size:180px]", tone(group.status))}>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-semibold">{group.teamRoleName ?? group.label}</span>
        <span className="max-w-[40%] truncate uppercase opacity-80">{latest?.status || group.status}</span>
      </div>
      <div className="mt-1 flex flex-wrap gap-1">
        {latest?.phase ? badge(latest.phase, "phase") : null}
        {latest?.decision ? badge(latest.decision, "decision") : null}
        {latest?.riskLevel ? badge(latest.riskLevel, "risk") : null}
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
  );
}

function PendingActionCard(props: {
  pendingAction?: AgentPendingAction;
  pendingActionTitle?: string;
  pendingActionDescription?: string;
  pendingActionYesLabel?: string;
  pendingActionNoLabel?: string;
  onPendingActionResolve?: (accept: boolean) => void;
}) {
  const {
    pendingAction,
    pendingActionTitle,
    pendingActionDescription,
    pendingActionYesLabel,
    pendingActionNoLabel,
    onPendingActionResolve,
  } = props;
  if (pendingAction?.kind !== "autoCommit" || !onPendingActionResolve) {
    return null;
  }
  return (
    <article className="rounded border border-amber-200 bg-amber-50 px-2 py-2 text-[11px] text-amber-800">
      <div className="font-semibold">{pendingActionTitle}</div>
      <div className="mt-1">{pendingActionDescription}</div>
      <div className="mt-2 flex gap-2">
        <button className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs text-white" onClick={() => onPendingActionResolve(true)}>
          {pendingActionYesLabel}
        </button>
        <button className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700" onClick={() => onPendingActionResolve(false)}>
          {pendingActionNoLabel}
        </button>
      </div>
    </article>
  );
}
