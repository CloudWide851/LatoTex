import { useMemo } from "react";
import { Bot, UserRound } from "lucide-react";
import { cn } from "../../../lib/utils";
import type { SwarmEvent } from "../../../shared/types/app";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import type { ChatMessage } from "../../hooks/chatSessionStore";
import { extractEventCards } from "../../hooks/analysisWorkspaceHelpers";
import { AgentTraceCards } from "../agent/AgentTraceCards";
import { ChatRunningIndicator } from "./ChatRunningIndicator";

type TranslationFn = (key: any) => string;

export function ChatMessageList(props: {
  messages: ChatMessage[];
  events: SwarmEvent[];
  running: boolean;
  latestRunningAssistantMessageId: string | null;
  agentPendingAction?: AgentPendingAction | null;
  onResolveWorkspaceAgentPendingAction?: (accept: boolean) => void;
  t: TranslationFn;
}) {
  const {
    messages,
    events,
    running,
    latestRunningAssistantMessageId,
    agentPendingAction,
    onResolveWorkspaceAgentPendingAction,
    t,
  } = props;
  const runIds = useMemo(
    () => Array.from(new Set(
      messages
        .map((item) => item.runId)
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0),
    )),
    [messages],
  );
  const cardsByRunId = useMemo(() => {
    const next = new Map<string, ReturnType<typeof extractEventCards>>();
    for (const runId of runIds) {
      next.set(runId, extractEventCards(events, [runId]));
    }
    return next;
  }, [events, runIds]);

  return (
    <div className="relative mx-auto max-w-4xl space-y-0 before:absolute before:bottom-4 before:left-[15px] before:top-4 before:w-px before:bg-[color:var(--editor-widget-border)]">
      {messages.map((item) => {
        const isRunningAssistant = running
          && item.role === "assistant"
          && item.id === latestRunningAssistantMessageId;
        const traceCards = item.runId ? (cardsByRunId.get(item.runId) ?? []) : [];
        return (
          <article
            key={item.id}
            className="relative grid grid-cols-[2rem_minmax(0,1fr)] gap-3 pb-5"
            data-chat-timeline-message={item.role}
          >
            <div className={cn(
              "relative z-10 flex h-8 w-8 items-center justify-center rounded-full border bg-[color:var(--editor-widget-bg)]",
              item.role === "assistant"
                ? "text-[color:var(--app-accent)]"
                : "text-[color:var(--app-muted)]",
            )}>
              {item.role === "assistant" ? (
                <Bot className="h-3.5 w-3.5" aria-hidden="true" />
              ) : (
                <UserRound className="h-3.5 w-3.5" aria-hidden="true" />
              )}
            </div>
            <div className="min-w-0 pt-0.5">
              <header className="mb-1.5 flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-[color:var(--app-muted)]">
                <span className="font-semibold">
                  {item.role === "user" ? t("chat.roleUser") : t("chat.roleAssistant")}
                </span>
                <time dateTime={item.createdAt} className="normal-case tracking-normal opacity-70">
                  {new Date(item.createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}
                </time>
              </header>
              <div className={cn(
                "whitespace-pre-wrap break-words text-sm leading-6 text-[color:var(--app-fg)]",
                item.role === "user" && "app-material-inset rounded-md border px-3 py-2",
              )}>
                {item.text.trim() ? item.text : null}
                {isRunningAssistant ? (
                  <ChatRunningIndicator
                    label={t("chat.running")}
                    inline={!item.text.trim()}
                  />
                ) : null}
              </div>
              {traceCards.length > 0 || (isRunningAssistant && agentPendingAction?.kind === "autoCommit") ? (
                <div className="app-material-inset mt-3 overflow-hidden rounded-md border">
                  <AgentTraceCards
                    cards={traceCards}
                    title={t("agent.traceTitle")}
                    pendingAction={isRunningAssistant ? agentPendingAction ?? undefined : undefined}
                    pendingActionTitle={t("chat.workspacePendingTitle")}
                    pendingActionDescription={isRunningAssistant && agentPendingAction?.kind === "autoCommit"
                      ? agentPendingAction.targetPath
                      : undefined}
                    pendingActionYesLabel={t("agent.autoCommit.yes")}
                    pendingActionNoLabel={t("agent.autoCommit.no")}
                    onPendingActionResolve={isRunningAssistant ? onResolveWorkspaceAgentPendingAction : undefined}
                    t={t}
                    className="border-0 px-2 py-2"
                    bodyClassName="max-h-60 pr-1"
                    compact
                  />
                </div>
              ) : null}
            </div>
          </article>
        );
      })}
    </div>
  );
}
