import {
  ChevronDown,
  ChevronUp,
  CornerDownLeft,
  MessageSquareMore,
  Send,
  Sparkles,
  Square,
  UsersRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState, type DragEvent } from "react";
import type { SwarmEvent } from "../../shared/types/app";
import { cn } from "../../lib/utils";
import { useI18n } from "../../i18n";
import { AgentSessionPicker } from "./agent/AgentSessionPicker";
import { AgentTraceCards } from "./agent/AgentTraceCards";
import { pickCommandSuggestions } from "../hooks/agentCommands";
import type {
  AgentChatMessage,
  AgentFileProposal,
  AgentSessionSummary,
} from "../hooks/agentTypes";
import type { AgentPendingAction } from "../hooks/useAppContainerState";
import { extractEventCards } from "../hooks/analysisWorkspaceHelpers";

export type AgentPhase = "idle" | "starting" | "running" | "done" | "error";

export type AgentCommandItem = {
  token: "/review" | "/check-ref" | "/new" | "/memory" | "/resume" | "/paper";
  label: string;
  description: string;
};


function parseDroppedPaths(event: DragEvent<HTMLTextAreaElement>): string[] {
  const dataTransfer = event.dataTransfer;
  const customRaw = dataTransfer.getData("application/x-latotex-path");
  const customPaths = customRaw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  const plainRaw = dataTransfer.getData("text/plain");
  const plainPaths = plainRaw
    .split(/\r?\n/g)
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  return Array.from(new Set([...customPaths, ...plainPaths]));
}

function toPromptRef(path: string): string {
  const normalized = path.replace(/\\/g, "/").replace(/^\.\/+/, "").trim();
  if (!normalized) {
    return "";
  }
  return /\s/.test(normalized) ? `@"${normalized}"` : `@${normalized}`;
}

function appendDroppedPromptRefs(prompt: string, paths: string[]): string {
  const refs = paths
    .map((item) => toPromptRef(item))
    .filter((item) => item.length > 0);
  if (refs.length === 0) {
    return prompt;
  }
  const suffix = `${refs.join(" ")} `;
  if (!prompt.trim()) {
    return suffix;
  }
  return `${prompt.trimEnd()} ${suffix}`;
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
  onRunTeams: () => void;
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
    onRunTeams,
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

  const { t } = useI18n();
  const [activityExpanded, setActivityExpanded] = useState(true);
  const [commandIndex, setCommandIndex] = useState(0);
  const [commandPlacement, setCommandPlacement] = useState<"above" | "below">("above");
  const promptRef = useRef<HTMLTextAreaElement | null>(null);
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

  const traceCards = useMemo(() => (runId ? extractEventCards(events, [runId]).slice(-24) : []), [events, runId]);
  const canShowActivity = traceCards.length > 0 || Boolean(pendingAction);

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
    const collapsedText = traceCards[traceCards.length - 1]?.title
      || ((phase === "running" || phase === "starting" || Boolean(runId)) ? statusLine : title);
    return (
      <button
        className={cn(
          "agent-overlay-trigger absolute inset-x-0 bottom-4 z-30 mx-auto flex w-fit max-w-[min(620px,calc(100%-24px))] items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs shadow-soft transition-[background-color,border-color,color,box-shadow]",
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
      <div className="agent-overlay-shell pointer-events-auto w-full max-w-full min-w-0 max-h-[calc(100vh-132px)] overflow-hidden rounded-lg border border-slate-300 bg-white/95 shadow-soft motion-card-pop transition-[box-shadow,border-color,opacity] duration-150">
        <div className="flex items-center justify-between border-b border-slate-200 px-3 py-2">
          <div className="flex min-w-0 flex-1 items-center gap-2 text-xs font-semibold text-slate-700">
            <MessageSquareMore className="h-3.5 w-3.5 shrink-0" />
            <span className="shrink-0">{title}</span>
          </div>
          <div className="ml-2 flex items-center gap-1">
            {canShowActivity ? (
              <button
                className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 motion-hover-rise"
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
              className="rounded p-1 text-slate-500 hover:bg-slate-100 hover:text-slate-800 motion-hover-rise"
              onClick={onToggle}
              title={collapseLabel}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {canShowActivity ? (
          <div className={cn(
            "overflow-hidden transition-[max-height,opacity] duration-150",
            activityExpanded ? "max-h-[42vh] opacity-100" : "max-h-0 opacity-0",
          )}>
            <AgentTraceCards
              cards={traceCards}
              title={t("agent.traceTitle")}
              pendingAction={pendingAction}
              pendingActionTitle={pendingActionTitle}
              pendingActionDescription={pendingAction?.kind === "autoCommit"
                ? pendingActionDesc.replace("{path}", pendingAction.targetPath)
                : pendingActionDesc}
              pendingActionYesLabel={pendingActionYesLabel}
              pendingActionNoLabel={pendingActionNoLabel}
              onPendingActionResolve={onPendingActionResolve}
              t={t}
              bodyClassName="max-h-[calc(42vh-2.75rem)] pr-1"
              compact
            />
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
              className="editor-chat-input hide-scrollbar h-[clamp(84px,16vh,132px)] w-full resize-none overflow-auto rounded-lg border px-2 pb-10 pt-1.5 pr-20 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100"
              value={prompt}
              placeholder={placeholder}
              onChange={(event) => onPromptChange(event.target.value)}
              onClick={updateCommandPlacement}
              onKeyUp={updateCommandPlacement}
              onSelect={updateCommandPlacement}
              onDragOver={(event) => {
                const types = Array.from(event.dataTransfer.types ?? []);
                if (!types.includes("application/x-latotex-path") && !types.includes("text/plain")) {
                  return;
                }
                event.preventDefault();
              }}
              onDrop={(event) => {
                event.preventDefault();
                const nextPrompt = appendDroppedPromptRefs(prompt, parseDroppedPaths(event));
                if (nextPrompt !== prompt) {
                  onPromptChange(nextPrompt);
                }
              }}
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
                  "absolute left-1 z-20 max-h-32 overflow-auto rounded-md border border-slate-200 bg-[color:var(--editor-widget-bg)] p-1 shadow-soft",
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
                className="absolute bottom-2 left-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-[color:var(--editor-widget-bg)] text-slate-700 transition hover:bg-slate-100 motion-hover-rise"
                title={rollbackLabel}
                aria-label={rollbackLabel}
                onClick={onRollback}
              >
                <CornerDownLeft className="h-3.5 w-3.5" />
              </button>
            ) : null}
            <div className="absolute bottom-2 right-2 flex items-center gap-1.5">
              {phase !== "running" ? (
                <button
                  className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-slate-300 bg-[color:var(--editor-widget-bg)] text-slate-700 transition hover:bg-slate-100 disabled:cursor-not-allowed disabled:opacity-40 motion-hover-rise"
                  onClick={onRunTeams}
                  disabled={busy || !prompt.trim()}
                  title={t("agent.teams.run")}
                  aria-label={t("agent.teams.run")}
                >
                  <UsersRound className="h-3.5 w-3.5" />
                </button>
              ) : null}
              <button
                className="inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40 motion-hover-rise"
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
    </div>
  );
}
