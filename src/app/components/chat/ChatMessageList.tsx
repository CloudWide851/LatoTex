import { useMemo } from "react";
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
    <div className="space-y-2">
      {messages.map((item) => {
        const isRunningAssistant = running
          && item.role === "assistant"
          && item.id === latestRunningAssistantMessageId;
        const traceCards = item.runId ? (cardsByRunId.get(item.runId) ?? []) : [];
        return (
          <div
            key={item.id}
            className={cn(
              "max-w-[85%] rounded border px-3 py-2 text-sm",
              item.role === "user"
                ? "ml-auto border-primary-200 bg-primary-50 text-primary-900"
                : "border-slate-200 bg-slate-50 text-slate-800",
            )}
          >
            <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">
              {item.role === "user" ? t("chat.roleUser") : t("chat.roleAssistant")}
            </div>
            <div className="whitespace-pre-wrap break-words">
              {item.text.trim() ? item.text : null}
              {isRunningAssistant ? (
                <ChatRunningIndicator
                  label={t("chat.running")}
                  inline={!item.text.trim()}
                />
              ) : null}
            </div>
            {traceCards.length > 0 || (isRunningAssistant && agentPendingAction?.kind === "autoCommit") ? (
              <div className="mt-2 rounded-md border border-slate-200 bg-white/90">
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
                  bodyClassName="max-h-56 pr-1"
                />
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
