import { ChevronDown, ChevronUp, MessageSquareMore, Send, Sparkles, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { SwarmEvent } from "../../shared/types/app";
import { cn } from "../../lib/utils";
import { pickCommandSuggestions } from "../hooks/agentCommands";
import type { AgentChatMessage, AgentEventCard, AgentFileProposal } from "../hooks/agentTypes";

export type AgentPhase = "idle" | "starting" | "running" | "done" | "error";

export type AgentCommandItem = {
  token: "/review" | "/check-ref";
  label: string;
  description: string;
};

function messageLineCount(text: string): number {
  return text.split(/\r?\n/).length;
}

function MarkdownMessage(props: { content: string }) {
  const { content } = props;
  return (
    <article className="markdown-preview text-xs leading-5 text-slate-700">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
    </article>
  );
}

function toCardKind(kind: string): string {
  if (kind.startsWith("a2a.")) {
    return "a2a";
  }
  if (kind.startsWith("mcp.")) {
    return "mcp";
  }
  if (kind.startsWith("responses.")) {
    return "responses";
  }
  if (kind.startsWith("agent.run")) {
    return "run";
  }
  return "other";
}

function extractEventCards(events: SwarmEvent[], runId: string | null): AgentEventCard[] {
  if (!runId) {
    return [];
  }
  const filtered = events
    .filter((event) => event.runId === runId)
    .filter((event) => {
      const kind = toCardKind(event.kind);
      return kind === "a2a" || kind === "mcp" || kind === "responses" || kind === "run";
    })
    .sort((a, b) => a.seq - b.seq);
  const byCard = new Map<string, AgentEventCard>();
  for (const event of filtered) {
    const payload = event.payload ?? {};
    const cardKey =
      typeof payload.cardKey === "string" && payload.cardKey.trim().length > 0
        ? payload.cardKey
        : event.id;
    const append = payload.append === true;
    const content =
      typeof payload.content === "string"
        ? payload.content
        : typeof payload.output === "string"
          ? payload.output
          : "";
    const existing = byCard.get(cardKey);
    if (!existing) {
      byCard.set(cardKey, {
        id: event.id,
        runId: event.runId,
        kind: event.kind,
        stage: typeof payload.stage === "string" ? payload.stage : "run",
        source: typeof payload.source === "string" ? payload.source : event.role,
        status: typeof payload.status === "string" ? payload.status : "running",
        title: typeof payload.title === "string" ? payload.title : event.kind,
        content,
        cardKey,
        createdAt: event.createdAt,
      });
      continue;
    }
    existing.kind = event.kind;
    existing.status =
      typeof payload.status === "string" && payload.status.trim().length > 0
        ? payload.status
        : existing.status;
    existing.title =
      typeof payload.title === "string" && payload.title.trim().length > 0
        ? payload.title
        : existing.title;
    existing.stage =
      typeof payload.stage === "string" && payload.stage.trim().length > 0
        ? payload.stage
        : existing.stage;
    existing.source =
      typeof payload.source === "string" && payload.source.trim().length > 0
        ? payload.source
        : existing.source;
    existing.content = append ? `${existing.content}${content}` : content || existing.content;
  }
  return Array.from(byCard.values());
}

function statusTone(status: string): string {
  if (status === "error" || status === "failed") {
    return "border-rose-300 bg-rose-50 text-rose-700";
  }
  if (status === "success" || status === "completed") {
    return "border-emerald-300 bg-emerald-50 text-emerald-700";
  }
  return "border-slate-300 bg-slate-50 text-slate-700";
}

function ProposalBar(props: {
  proposal: AgentFileProposal;
  busy: boolean;
  applyLabel: string;
  rejectLabel: string;
  autoAnalyzeLabel: string;
  onAccept: (withAnalysis: boolean) => void;
  onReject: () => void;
}) {
  const { proposal, busy, applyLabel, rejectLabel, autoAnalyzeLabel, onAccept, onReject } = props;
  const [withAnalysis, setWithAnalysis] = useState(false);
  useEffect(() => {
    setWithAnalysis(false);
  }, [proposal.id]);
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-3 py-2">
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-amber-900">{proposal.targetPath}</p>
          <p className="truncate text-[11px] text-amber-700">
            +{proposal.insertions ?? 0} / -{proposal.deletions ?? 0}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button
            className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-700 hover:bg-slate-100 disabled:opacity-40"
            onClick={onReject}
            disabled={busy}
          >
            {rejectLabel}
          </button>
          <button
            className="rounded border border-primary-600 bg-primary-600 px-2 py-1 text-[11px] text-white hover:bg-primary-700 disabled:opacity-40"
            onClick={() => onAccept(withAnalysis)}
            disabled={busy}
          >
            {applyLabel}
          </button>
        </div>
      </div>
      <label className="mb-1 flex items-center gap-2 text-[11px] text-amber-900">
        <input
          type="checkbox"
          className="h-3.5 w-3.5"
          checked={withAnalysis}
          onChange={(event) => setWithAnalysis(event.target.checked)}
          disabled={busy}
        />
        <span>{autoAnalyzeLabel}</span>
      </label>
      {proposal.changedLines && proposal.changedLines.length > 0 ? (
        <p className="truncate text-[11px] text-amber-800">
          {proposal.changedLines.slice(0, 16).join(", ")}
        </p>
      ) : null}
    </div>
  );
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
  runId: string | null;
  events: SwarmEvent[];
  onPromptChange: (value: string) => void;
  onRun: () => void;
  onToggle: () => void;
  onAcceptProposal: (withAnalysis: boolean) => void;
  onRejectProposal: () => void;
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
}) {
  const {
    collapsed,
    phase,
    statusLine,
    title,
    collapseLabel,
    prompt,
    busy,
    messages,
    proposal,
    runId,
    events,
    onPromptChange,
    onRun,
    onToggle,
    onAcceptProposal,
    onRejectProposal,
    runLabel,
    placeholder,
    activityShowLabel,
    activityHideLabel,
    applyLabel,
    rejectLabel,
    autoAnalyzeLabel,
    showMoreLabel,
    showLessLabel,
    commands,
  } = props;

  const [activityExpanded, setActivityExpanded] = useState(true);
  const [commandIndex, setCommandIndex] = useState(0);
  const [expandedMessageIds, setExpandedMessageIds] = useState<Record<string, boolean>>({});
  const [expandedCardKeys, setExpandedCardKeys] = useState<Record<string, boolean>>({});
  const canShowActivity = phase !== "idle" || messages.length > 0 || events.length > 0;
  const eventCards = useMemo(() => extractEventCards(events, runId), [events, runId]);
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

  if (collapsed) {
    return (
      <button
        className={cn(
          "absolute bottom-3 left-1/2 z-20 flex max-w-[min(520px,calc(100%-24px))] -translate-x-1/2 items-center gap-2 rounded-lg border px-3 py-2 text-left text-xs shadow-soft transition",
          phase === "error"
            ? "border-rose-300 bg-rose-50 text-rose-700"
            : "border-slate-300 bg-white text-slate-700 hover:bg-slate-50",
        )}
        onClick={onToggle}
        title={statusLine}
      >
        <Sparkles className="h-3.5 w-3.5 shrink-0" />
        <span className="truncate">{statusLine}</span>
      </button>
    );
  }

  return (
    <div className="pointer-events-none absolute inset-x-3 bottom-3 z-20 flex justify-center">
      <div
        className="pointer-events-auto grid w-[min(82%,980px)] max-w-[calc(100%-6px)] min-w-[340px] max-h-[calc(100%-12px)] grid-rows-[40px_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-300 bg-white/95 shadow-soft motion-slide-up"
        style={{
          height: activityExpanded ? "clamp(280px, 70%, 760px)" : "clamp(160px, 32%, 300px)",
        }}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-3">
          <div className="flex min-w-0 items-center gap-2 text-xs font-semibold text-slate-700">
            <MessageSquareMore className="h-3.5 w-3.5 shrink-0" />
            <span className="truncate">{title}</span>
            <span className="rounded border border-slate-300 bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-600">
              {statusLine}
            </span>
          </div>
          <div className="flex items-center gap-1">
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

        <div className="flex min-h-0 flex-1 flex-col">
          {proposal ? (
            <ProposalBar
              proposal={proposal}
              busy={busy}
              applyLabel={applyLabel}
              rejectLabel={rejectLabel}
              autoAnalyzeLabel={autoAnalyzeLabel}
              onAccept={onAcceptProposal}
              onReject={onRejectProposal}
            />
          ) : null}

          {activityExpanded ? (
            <div className="min-h-0 flex-1 space-y-1 overflow-auto border-b border-slate-200 px-3 py-2">
              {messages.map((message) => {
                const longMessage =
                  messageLineCount(message.text) > 12 || message.text.length > 720;
                const expanded = expandedMessageIds[message.id] ?? false;
                const isMarkdown = message.format === "markdown";
                return (
                  <div
                    key={message.id}
                    className={cn(
                      "rounded-md border px-2 py-1 text-xs leading-5",
                      message.role === "user"
                        ? "border-primary-200 bg-primary-50 text-primary-900"
                        : "border-slate-200 bg-slate-100 text-slate-700",
                    )}
                  >
                    <div className={cn(!expanded && longMessage ? "max-h-32 overflow-hidden" : "")}>
                      {isMarkdown ? (
                        <MarkdownMessage content={message.text} />
                      ) : (
                        <p className="whitespace-pre-wrap">{message.text}</p>
                      )}
                    </div>
                    {longMessage ? (
                      <button
                        className="mt-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                        onClick={() =>
                          setExpandedMessageIds((prev) => ({
                            ...prev,
                            [message.id]: !expanded,
                          }))
                        }
                      >
                        {expanded ? showLessLabel : showMoreLabel}
                      </button>
                    ) : null}
                  </div>
                );
              })}

              {eventCards.map((card) => {
                const expanded = expandedCardKeys[card.cardKey] ?? false;
                const longCard = messageLineCount(card.content) > 10 || card.content.length > 680;
                return (
                  <div
                    key={card.cardKey}
                    className={cn("rounded-md border px-2 py-1 text-xs", statusTone(card.status))}
                  >
                    <div className="mb-1 flex items-center justify-between gap-2 text-[11px]">
                      <span className="truncate font-semibold">{card.title}</span>
                      <span className="shrink-0 uppercase">{card.stage}</span>
                    </div>
                    <div className={cn(!expanded && longCard ? "max-h-32 overflow-hidden" : "")}>
                      {card.content.trim().length > 0 ? (
                        <MarkdownMessage content={card.content} />
                      ) : (
                        <p className="text-[11px] opacity-70">{card.source}</p>
                      )}
                    </div>
                    {longCard ? (
                      <button
                        className="mt-1 rounded border border-slate-300 bg-white px-1.5 py-0.5 text-[11px] text-slate-600 hover:bg-slate-50"
                        onClick={() =>
                          setExpandedCardKeys((prev) => ({
                            ...prev,
                            [card.cardKey]: !expanded,
                          }))
                        }
                      >
                        {expanded ? showLessLabel : showMoreLabel}
                      </button>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}

          <div className="mt-auto p-3">
            <div className="relative">
              <textarea
                className={cn(
                  "w-full resize-none rounded-lg border border-slate-300 px-2 py-1.5 pr-10 text-xs outline-none transition focus:border-primary-500 focus:ring-2 focus:ring-primary-100",
                  activityExpanded
                    ? "h-[clamp(84px,16vh,132px)]"
                    : "h-[clamp(78px,15vh,112px)]",
                )}
                value={prompt}
                placeholder={placeholder}
                onChange={(event) => onPromptChange(event.target.value)}
                onKeyDown={(event) => {
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
                <div className="absolute bottom-10 left-1 right-10 z-20 max-h-36 overflow-auto rounded-md border border-slate-200 bg-white p-1 shadow-soft">
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
                      <span className="font-mono">{item.label}</span>
                      <span className="text-[11px] text-slate-500">{item.description}</span>
                    </button>
                  ))}
                </div>
              ) : null}
              <button
                className="absolute bottom-2 right-2 inline-flex h-7 w-7 items-center justify-center rounded-md border border-primary-600 bg-primary-600 text-white transition hover:bg-primary-500 disabled:cursor-not-allowed disabled:opacity-40"
                onClick={onRun}
                disabled={busy || !prompt.trim()}
                title={runLabel}
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
