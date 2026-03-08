import {
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  MessageSquareMore,
  Send,
  Sparkles,
  Square,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { SwarmEvent } from "../../shared/types/app";
import { cn } from "../../lib/utils";
import { AgentSessionPicker } from "./agent/AgentSessionPicker";
import { pickCommandSuggestions } from "../hooks/agentCommands";
import type {
  AgentChatMessage,
  AgentFileProposal,
  AgentSessionSummary,
} from "../hooks/agentTypes";
import type { AgentPendingAction } from "../hooks/useAppContainerState";

export type AgentPhase = "idle" | "starting" | "running" | "done" | "error";

export type AgentCommandItem = {
  token: "/review" | "/check-ref" | "/new" | "/memory" | "/resume";
  label: string;
  description: string;
};

type ActivityLine = {
  id: string;
  text: string;
  tone: "neutral" | "success" | "error";
};

function normalizeLine(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\r?\n/g, " ")
    .trim();
}

function lineFromEvent(event: SwarmEvent): ActivityLine | null {
  const payload = event.payload ?? {};
  const status = typeof payload.status === "string" ? payload.status : "";
  const stage = typeof payload.stage === "string" ? payload.stage : "";
  const title = typeof payload.title === "string" ? payload.title : "";
  const tool = typeof payload.toolName === "string" ? payload.toolName : "";
  const content = typeof payload.content === "string" ? payload.content : "";

  const pathMatch = content.match(/path:\s*([^\n\r]+)/i);
  if (pathMatch?.[1]) {
    return {
      id: event.id,
      text: normalizeLine(pathMatch[1]),
      tone: "neutral",
    };
  }

  if (event.kind === "mcp.tool.call.started" || event.kind === "mcp.tool.call.completed") {
    const tone: ActivityLine["tone"] = event.kind.endsWith(".completed") ? "success" : "neutral";
    return {
      id: event.id,
      text: normalizeLine([tool || title || stage || event.kind, status].filter(Boolean).join(" · ")),
      tone,
    };
  }

  if (event.kind === "a2a.task.started" || event.kind === "a2a.task.completed") {
    return {
      id: event.id,
      text: normalizeLine([title || stage || event.kind, status].filter(Boolean).join(" · ")),
      tone: event.kind.endsWith(".completed") ? "success" : "neutral",
    };
  }

  if (event.kind === "agent.run.failed") {
    return {
      id: event.id,
      text: normalizeLine(content || title || event.kind),
      tone: "error",
    };
  }

  if (event.kind === "agent.run.cancelled" || event.kind === "agent.run.completed") {
    return {
      id: event.id,
      text: normalizeLine(title || event.kind),
      tone: event.kind.endsWith(".completed") ? "success" : "neutral",
    };
  }

  if (event.kind === "responses.output_text.delta") {
    const short = normalizeLine(content).slice(0, 180);
    if (!short) {
      return null;
    }
    return { id: event.id, text: short, tone: "neutral" };
  }

  if (!title && !status) {
    return null;
  }
  return {
    id: event.id,
    text: normalizeLine([title || stage || event.kind, status].filter(Boolean).join(" · ")),
    tone: "neutral",
  };
}

function toActivityLines(events: SwarmEvent[], runId: string | null): ActivityLine[] {
  if (!runId) {
    return [];
  }
  const lines = events
    .filter((event) => event.runId === runId)
    .sort((a, b) => a.seq - b.seq)
    .map((event) => lineFromEvent(event))
    .filter((line): line is ActivityLine => Boolean(line));
  const deduped: ActivityLine[] = [];
  for (const item of lines) {
    const prev = deduped[deduped.length - 1];
    if (prev?.text === item.text && prev.tone === item.tone) {
      continue;
    }
    deduped.push(item);
  }
  return deduped.slice(-120);
}

function toneClass(tone: ActivityLine["tone"]): string {
  if (tone === "error") {
    return "text-rose-700";
  }
  if (tone === "success") {
    return "text-emerald-700";
  }
  return "text-slate-700";
}

export function AgentChatOverlay(props: {
  collapsed: boolean;
  phase: AgentPhase;
  statusLine: string;
  title: string;
  collapseLabel: string;
  prompt: string;
  busy: boolean;
  messages: AgentChatMessage[];
  proposal: AgentFileProposal | null;
  pendingAction: AgentPendingAction;
  runId: string | null;
  sessions: AgentSessionSummary[];
  sessionPickerOpen: boolean;
  sessionPickerIndex: number;
  rollbackVisible: boolean;
  events: SwarmEvent[];
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onSessionPickerOpenChange: (value: boolean) => void;
  onSessionPickerIndexChange: (value: number) => void;
  onSessionConfirm: () => void;
  onRollback: () => void;
  onToggle: () => void;
  onAcceptProposal: (withAnalysis: boolean) => void;
  onRejectProposal: () => void;
  onPendingActionResolve: (accept: boolean) => void;
  runLabel: string;
  placeholder: string;
  activityShowLabel: string;
  activityHideLabel: string;
  applyLabel: string;
  rejectLabel: string;
  autoAnalyzeLabel: string;
  showMoreLabel: string;
  showLessLabel: string;
  commands: AgentCommandItem[];
  resumeTitle: string;
  resumeHint: string;
  resumeEmptyLabel: string;
  rollbackLabel: string;
  pendingActionTitle: string;
  pendingActionDesc: string;
  pendingActionWaitLabel: string;
  pendingActionYesLabel: string;
  pendingActionNoLabel: string;
}) {
  const {
    collapsed,
    phase,
    statusLine,
    title,
    collapseLabel,
    prompt,
    busy,
    runId,
    pendingAction,
    sessions,
    sessionPickerOpen,
    sessionPickerIndex,
    rollbackVisible,
    events,
    onPromptChange,
    onRun,
    onSessionPickerOpenChange,
    onSessionPickerIndexChange,
    onSessionConfirm,
    onRollback,
    onToggle,
    onPendingActionResolve,
    runLabel,
    placeholder,
    activityShowLabel,
    activityHideLabel,
    commands,
    resumeTitle,
    resumeHint,
    resumeEmptyLabel,
    rollbackLabel,
    pendingActionTitle,
    pendingActionDesc,
    pendingActionWaitLabel,
    pendingActionYesLabel,
    pendingActionNoLabel,
  } = props;

  const [activityExpanded, setActivityExpanded] = useState(true);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandPlacement, setCommandPlacement] = useState<"above" | "below">("above");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
  const activityContainerRef = useRef<HTMLDivElement | null>(null);
  const suggestedTokens = useMemo(() => pickCommandSuggestions(prompt), [prompt]);
  const commandSuggestions = useMemo(
    () =>
      suggestedTokens
        .map((token) => commands.find((item) => item.token === token))
        .filter((item): item is AgentCommandItem => Boolean(item)),
    [commands, suggestedTokens],
  );
  const activeCommandIndex = Math.min(
    Math.max(commandIndex, 0),
    Math.max(commandSuggestions.length - 1, 0),
  );
  const commandPanelWidth = useMemo(() => {
    const maxLength = commandSuggestions.reduce((max, item) => {
      return Math.max(max, item.label.length + item.description.length);
    }, 0);
    return Math.min(320, Math.max(170, maxLength * 2.2 + 64));
  }, [commandSuggestions]);

  const activityLines = useMemo(() => toActivityLines(events, runId), [events, runId]);
  const pendingActionLabel = useMemo(() => {
    if (!pendingAction) {
      return "";
    }
    if (pendingAction.kind === "autoCommit") {
      return pendingActionWaitLabel;
    }
    return pendingActionWaitLabel;
  }, [pendingAction, pendingActionWaitLabel]);
  const currentStatusLine = pendingActionLabel
    || activityLines[activityLines.length - 1]?.text
    || ((phase === "running" || phase === "starting" || Boolean(runId)) ? statusLine : "");
  const pendingActionDescription = useMemo(() => {
    if (!pendingAction) {
      return "";
    }
    if (pendingAction.kind === "autoCommit") {
      return pendingActionDesc.replace("{path}", pendingAction.targetPath);
    }
    return pendingActionDesc;
  }, [pendingAction, pendingActionDesc]);
  const canShowActivity = activityLines.length > 0;
  const showActivityPanel = activityExpanded && canShowActivity;

  useEffect(() => {
    if (!showActivityPanel || !activityContainerRef.current) {
      return;
    }
    const el = activityContainerRef.current;
    el.scrollTop = el.scrollHeight;
  }, [activityLines, showActivityPanel]);

  const updateCommandPlacement = () => {
    if (!promptRef.current || commandSuggestions.length === 0 || typeof window === "undefined") {
      return;
    }
    const el = promptRef.current;
    const rect = el.getBoundingClientRect();
    const caret = el.selectionStart ?? prompt.length;
    const beforeCaret = el.value.slice(0, caret);
    const currentLine = beforeCaret.split(/\r?\n/g).length;
    const totalLines = Math.max(el.value.split(/\r?\n/g).length, 1);
    const prefersBelow = currentLine <= Math.ceil(totalLines / 2);
    const spaceBelow = window.innerHeight - rect.bottom;
    const spaceAbove = rect.top;
    if (prefersBelow && spaceBelow >= 120) {
      setCommandPlacement("below");
      return;
    }
    if (!prefersBelow && spaceAbove >= 120) {
      setCommandPlacement("above");
      return;
    }
    setCommandPlacement(spaceBelow >= spaceAbove ? "below" : "above");
  };

  useEffect(() => {
    updateCommandPlacement();
  }, [prompt, commandSuggestions.length]);

  if (collapsed) {
    const collapsedText = currentStatusLine || title;
    return (
      <button
        className={cn(
          "absolute bottom-4 left-1/2 z-30 flex max-w-[min(620px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs shadow-soft transition",
          phase === "error"
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        )}
        onClick={onToggle}
        title={collapsedText}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{collapsedText}</span>
      </button>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-2 bottom-3 z-20 flex items-end">
      <div className="pointer-events-auto w-full max-w-full min-w-0 max-h-[calc(100vh-132px)] overflow-hidden rounded-lg border border-slate-300 bg-white/95 shadow-soft motion-slide-up">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-700">
            <MessageSquareMore className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{title}</span>
            {currentStatusLine ? (
              <span className="min-w-0 flex-1 truncate rounded border border-slate-300 bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700">
                {currentStatusLine}
              </span>
            ) : null}
          </div>
          <div className="ml-2 flex items-center gap-1">
            {canShowActivity ? (
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
                onClick={() => setActivityExpanded((prev) => !prev)}
                title={activityExpanded ? activityHideLabel : activityShowLabel}
                aria-label={activityExpanded ? activityHideLabel : activityShowLabel}
              >
                {activityExpanded ? (
                  <ChevronDown className="h-3.5 w-3.5" />
                ) : (
                  <ChevronUp className="h-3.5 w-3.5" />
                )}
              </button>
            ) : null}
            <button
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800"
              onClick={onToggle}
              title={collapseLabel}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {showActivityPanel ? (
          <div
            ref={activityContainerRef}
            className="max-h-[26vh] space-y-1 overflow-x-hidden overflow-y-auto border-b border-slate-200 px-3 py-2"
          >
            {activityLines.map((line) => (
              <p
                key={line.id}
                className={cn(
                  "whitespace-pre-wrap break-words rounded px-1 py-0.5 text-[11px] leading-5",
                  toneClass(line.tone),
                )}
              >
                {line.text}
              </p>
            ))}
          </div>
        ) : null}

        {pendingAction?.kind === "autoCommit" ? (
          <div className="space-y-2 border-b border-slate-200 bg-amber-50/70 px-3 py-2">
            <p className="text-xs font-semibold text-amber-700">{pendingActionTitle}</p>
            <p className="text-xs text-amber-700">{pendingActionDescription}</p>
            <div className="flex items-center gap-2">
              <button
                className="rounded border border-emerald-600 bg-emerald-600 px-2 py-1 text-xs text-white hover:bg-emerald-700"
                onClick={() => onPendingActionResolve(true)}
              >
                {pendingActionYesLabel}
              </button>
              <button
                className="rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
                onClick={() => onPendingActionResolve(false)}
              >
                {pendingActionNoLabel}
              </button>
            </div>
          </div>
        ) : null}

        <div className="p-3">
          <div className="relative">
            <AgentSessionPicker
              open={sessionPickerOpen}
              sessions={sessions}
              sessionPickerIndex={sessionPickerIndex}
              resumeTitle={resumeTitle}
              resumeHint={resumeHint}
              resumeEmptyLabel={resumeEmptyLabel}
              onSessionPickerIndexChange={onSessionPickerIndexChange}
              onSessionConfirm={onSessionConfirm}
            />
            <textarea
              ref={promptRef}
              className="h-[clamp(84px,16vh,132px)] w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 pr-10 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              value={prompt}
              placeholder={placeholder}
              onChange={(event) => onPromptChange(event.target.value)}
              onClick={updateCommandPlacement}
              onKeyUp={updateCommandPlacement}
              onSelect={updateCommandPlacement}
              onKeyDown={(event) => {
                if (sessionPickerOpen) {
                  if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                    event.preventDefault();
                    if (sessions.length === 0) {
                      return;
                    }
                    const delta = event.key === "ArrowDown" ? 1 : -1;
                    const nextIndex = Math.max(0, Math.min(sessions.length - 1, sessionPickerIndex + delta));
                    onSessionPickerIndexChange(nextIndex);
                    return;
                  }
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    onSessionConfirm();
                    return;
                  }
                  if (event.key === "Escape") {
                    event.preventDefault();
                    onSessionPickerOpenChange(false);
                    return;
                  }
                }
                if (
                  commandSuggestions.length > 0 &&
                  (event.key === "ArrowDown" || event.key === "ArrowUp")
                ) {
                  event.preventDefault();
                  setCommandIndex((prev) => {
                    if (event.key === "ArrowDown") {
                      return Math.min(prev + 1, commandSuggestions.length - 1);
                    }
                    return Math.max(prev - 1, 0);
                  });
                  return;
                }
                if (commandSuggestions.length > 0 && event.key === "Tab") {
                  event.preventDefault();
                  const next = commandSuggestions[activeCommandIndex];
                  if (next) {
                    onPromptChange(`${next.token} `);
                    setCommandIndex(0);
                  }
                  return;
                }
                if (event.key === "Enter" && !event.shiftKey) {
                  event.preventDefault();
                  if (!busy && prompt.trim()) {
                    onRun();
                  }
                }
              }}
            />
            {commandSuggestions.length > 0 ? (
              <div
                className={cn(
                  "absolute left-1 z-20 max-h-32 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-soft",
                  commandPlacement === "above"
                    ? "bottom-[calc(100%+6px)]"
                    : "top-[calc(100%+6px)]",
                )}
                style={{
                  width: commandPanelWidth,
                  maxWidth: "min(360px, calc(100% - 2rem))",
                }}
              >
                {commandSuggestions.map((item, index) => (
                  <button
                    key={item.token}
                    className={cn(
                      "flex w-full items-start justify-between gap-2 rounded px-2 py-1 text-left text-xs transition",
                      index === activeCommandIndex
                        ? "bg-primary-50 text-primary-700"
                        : "hover:bg-slate-100",
                    )}
                    onMouseDown={(event) => {
                      event.preventDefault();
                      onPromptChange(`${item.token} `);
                      setCommandIndex(0);
                    }}
                  >
                    <span className="shrink-0 font-mono">{item.label}</span>
                    <span className="truncate text-[11px] text-slate-500">{item.description}</span>
                  </button>
                ))}
              </div>
            ) : null}
            {rollbackVisible ? (
              <button
                className="absolute bottom-2 left-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                title={rollbackLabel}
                aria-label={rollbackLabel}
                onClick={onRollback}
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <button
              className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
              onClick={onRun}
              disabled={busy || (phase !== "running" && !prompt.trim())}
              title={runLabel}
            >
              {phase === "running" ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
