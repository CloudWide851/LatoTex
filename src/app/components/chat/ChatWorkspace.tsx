import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { startChatWorkflow } from "../../../shared/api/agent";
import {
  channelsTelegramPoll,
  channelsTelegramSend,
  getEvents,
  executeWorkflowCancel,
} from "../../../shared/api/desktop";
import type { ChannelPrefs, SwarmEvent } from "../../../shared/types/app";
import type { AgentPhase } from "../AgentChatOverlay";
import type { AgentChatMessage, AgentFileProposal } from "../../hooks/agentTypes";
import type { AgentPendingAction } from "../../hooks/useAppContainerState";
import {
  newChatSession,
  type ChatMessage,
  type ChatSession,
} from "../../hooks/chatSessionStore";
import { parseAgentPrompt } from "../../hooks/agentCommands";
import { ChatMessageList } from "./ChatMessageList";
import { ChatWorkspaceComposer } from "./ChatWorkspaceComposer";
import { updateSession } from "./chatWorkspaceUtils";
import { useChatWorkspaceState } from "./useChatWorkspaceState";
import { useChatRunEventHydration } from "./useChatRunEventHydration";

type TranslationFn = (key: any) => string;


const HEARTBEAT_EXCLUDE = ["agent.run.heartbeat"];
const RESEARCH_MODE_INSTRUCTION = "Research mode is explicitly enabled. Separate claims from evidence, cite available sources, state limitations, and label unsupported claims as unconfirmed.";

type ChatAutoFixRequest = {
  projectId: string | null;
  prompt: string;
  forceNewSession?: boolean;
  source?: string;
  requestId?: string;
};

function renderRunFailureMessage(t: TranslationFn, error: unknown): string {
  void error;
  return t("chat.runFailed");
}
function titleFromPrompt(prompt: string, fallback: string) {
  const firstLine = prompt.replace(/\s+/g, " ").trim().slice(0, 42);
  return firstLine || fallback;
}

function ensureTelegramSession(
  sessions: ChatSession[],
  chatId: string,
  username: string,
  fallbackTitle: string,
): { sessions: ChatSession[]; sessionId: string } {
  const title = `[TG:${username || chatId}]`;
  const existing = sessions.find((item) => item.title === title);
  if (existing) {
    return { sessions, sessionId: existing.id };
  }
  const next = newChatSession(fallbackTitle);
  next.title = title;
  return {
    sessions: [next, ...sessions].slice(0, 80),
    sessionId: next.id,
  };
}

export function ChatWorkspace(props: {
  projectId: string | null;
  modelOverride?: string | null;
  channelPrefs?: ChannelPrefs | null;
  suspended?: boolean;
  chatAgentModelId?: string | null;
  selectedFile?: string | null;
  agentPhase?: AgentPhase;
  agentRunId?: string | null;
  agentMessages?: AgentChatMessage[];
  agentProposal?: AgentFileProposal | null;
  agentPendingAction?: AgentPendingAction;
  events?: unknown[];
  onRunWorkspaceAgent?: (prompt: string, options?: { forceNewSession?: boolean }) => void | Promise<void>;
  onAcceptWorkspaceAgentProposal?: (withAnalysis: boolean) => void | Promise<void>;
  onRejectWorkspaceAgentProposal?: () => void | Promise<void>;
  onResolveWorkspaceAgentPendingAction?: (accept: boolean) => void | Promise<void>;
  onRequestAgentReview?: (prompt: string) => void;
  t: TranslationFn;
}) {
  const { projectId, modelOverride, channelPrefs, t } = props;
  const {
    activeSession,
    activeSessionId,
    appendMessage,
    draft,
    ensureSession,
    lastError,
    loadProjectMemoryText,
    pendingRunId,
    running,
    sessionsRef,
    setActiveSessionId,
    setDraft,
    setLastError,
    setPendingRunId,
    setRunning,
    setSessions,
    updateMessageRunId,
    updateMessageText,
  } = useChatWorkspaceState({
    projectId,
    agentMessages: props.agentMessages ?? [],
    agentRunId: props.agentRunId ?? null,
    t,
  });
  const [runningAssistantMessageId, setRunningAssistantMessageId] = useState<string | null>(null);
  const [chatMode, setChatMode] = useState<"general" | "research">("research");
  const [contextScope, setContextScope] = useState<"conversation" | "current-file">("conversation");
  const listRef = useRef<HTMLDivElement | null>(null);
  const telegramOffsetRef = useRef(0);
  const telegramQueueRef = useRef<Array<{ chatId: string; username: string; text: string; messageId: number }>>([]);
  const telegramProcessingRef = useRef(false);
  const pendingAutoFixRef = useRef<ChatAutoFixRequest | null>(null);
  const lastHandledAutoFixKeyRef = useRef<string>("");

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activeSession?.updatedAt, activeSessionId]);

  const activeMessages = activeSession?.messages ?? [];
  const incomingEvents = useMemo(
    () => (Array.isArray(props.events) ? (props.events as SwarmEvent[]) : []),
    [props.events],
  );
  const hydratedEvents = useChatRunEventHydration({
    messages: activeMessages,
    events: incomingEvents,
    suspended: Boolean(props.suspended),
  });

  useEffect(() => {
    if (!props.selectedFile && contextScope === "current-file") {
      setContextScope("conversation");
    }
  }, [contextScope, props.selectedFile]);

  const runPrompt = useCallback(async (
    promptRaw: string,
    options?: {
      sessionId?: string;
      telegramChatId?: string;
      telegramMessageId?: number;
      telegramUser?: string;
      forceNewSession?: boolean;
      teamMode?: "auto" | "force";
    },
  ) => {
    const prompt = promptRaw.trim();
    if (!projectId || !prompt || running) {
      return;
    }
    const parsed = parseAgentPrompt(prompt);
    if (parsed.kind === "command" && parsed.command === "new") {
      const title = parsed.args.trim().slice(0, 80) || t("chat.sessionNew");
      const next = newChatSession(title);
      setSessions((prev) => [next, ...prev].slice(0, 80));
      setActiveSessionId(next.id);
      setDraft("");
      if (options?.telegramChatId) {
        await channelsTelegramSend({
          chatId: options.telegramChatId,
          text: t("chat.command.new.done"),
          replyToMessageId: options.telegramMessageId,
        }).catch(() => undefined);
      }
      return;
    }
    let sessionId = options?.sessionId ?? null;
    if (options?.forceNewSession) {
      const next = newChatSession(t("chat.sessionNew"));
      setSessions((prev) => [next, ...prev].slice(0, 80));
      setActiveSessionId(next.id);
      sessionId = next.id;
    }
    if (!sessionId) {
      sessionId = ensureSession();
    }
    const currentSession = sessionsRef.current.find((item) => item.id === sessionId) ?? null;
    const shouldRetitle = !currentSession || currentSession.messages.length === 0;
    setLastError("");
    if (!options?.telegramChatId) {
      setDraft("");
    }
    const userMessage: ChatMessage = {
      id: `u-${Date.now().toString(36)}`,
      role: "user",
      text: options?.telegramUser ? `[TG:${options.telegramUser}] ${prompt}` : prompt,
      createdAt: new Date().toISOString(),
    };
    appendMessage(sessionId, userMessage);
    if (parsed.kind === "command" && parsed.command === "memory") {
      const memory = await loadProjectMemoryText();
      const responseText = memory || t("chat.command.memory.empty");
      appendMessage(sessionId, {
        id: `a-${Date.now().toString(36)}`,
        role: "assistant",
        text: responseText,
        createdAt: new Date().toISOString(),
      });
      if (options?.telegramChatId) {
        await channelsTelegramSend({
          chatId: options.telegramChatId,
          text: responseText.slice(0, 3900),
          replyToMessageId: options.telegramMessageId,
        }).catch(() => undefined);
      }
      return;
    }
    if (shouldRetitle) {
      setSessions((prev) =>
        updateSession(prev, sessionId, (session) => ({
          ...session,
          title: titleFromPrompt(prompt, session.title),
        })),
      );
    }
    const assistantMessageId = `a-${Date.now().toString(36)}`;
    appendMessage(sessionId, {
      id: assistantMessageId,
      role: "assistant",
      text: "",
      createdAt: new Date().toISOString(),
    });
    setRunning(true);
    setRunningAssistantMessageId(assistantMessageId);
    try {
      const accepted = await startChatWorkflow({
        projectId,
        prompt: chatMode === "research" ? `${RESEARCH_MODE_INSTRUCTION}\n\n${prompt}` : prompt,
        contextPaths: contextScope === "current-file" && props.selectedFile
          ? [props.selectedFile]
          : [],
        modelOverride: modelOverride ?? undefined,
        teamMode: options?.teamMode ?? "auto",
      });
      setPendingRunId(accepted.runId);
      updateMessageRunId(sessionId, assistantMessageId, accepted.runId);
      let cursor = 0;
      let output = "";
      const startedAt = Date.now();
      while (Date.now() - startedAt < 900_000) {
        const batch = await getEvents(cursor, 220, accepted.runId, 2_500, HEARTBEAT_EXCLUDE);
        cursor = batch.nextCursor;
        let completed = false;
        for (const event of batch.events) {
          const payload = (event.payload ?? {}) as Record<string, unknown>;
          if (event.kind === "responses.output_text.delta") {
            const chunk = typeof payload.content === "string" ? payload.content : "";
            if (chunk) {
              output += chunk;
              updateMessageText(sessionId, assistantMessageId, output);
            }
            continue;
          }
          if (event.kind === "agent.run.completed") {
            const finalOutput = typeof payload.output === "string" && payload.output.trim()
              ? payload.output
              : output;
            output = finalOutput;
            updateMessageText(sessionId, assistantMessageId, finalOutput);
            if (options?.telegramChatId && finalOutput.trim()) {
              await channelsTelegramSend({
                chatId: options.telegramChatId,
                text: finalOutput.slice(0, 3900),
                replyToMessageId: options.telegramMessageId,
              }).catch(() => undefined);
            }
            completed = true;
            break;
          }
          if (event.kind === "agent.run.failed") {
            throw new Error(
              (typeof payload.content === "string" && payload.content)
              || (typeof payload.message === "string" && payload.message)
              || "agent.run.failed",
            );
          }
          if (event.kind === "agent.run.cancelled") {
            throw new Error("agent.run.cancelled");
          }
        }
        if (completed) {
          setPendingRunId(null);
          setRunning(false);
          return;
        }
      }
      throw new Error("agent.run.timeout.total");
    } catch (error) {
      const failureText = renderRunFailureMessage(t, error);
      setLastError(failureText);
      updateMessageText(sessionId, assistantMessageId, failureText);
      if (options?.telegramChatId) {
        await channelsTelegramSend({
          chatId: options.telegramChatId,
          text: failureText.slice(0, 3900),
          replyToMessageId: options.telegramMessageId,
        }).catch(() => undefined);
      }
    } finally {
      setRunning(false);
      setPendingRunId(null);
      setRunningAssistantMessageId(null);
    }
  }, [appendMessage, chatMode, contextScope, ensureSession, loadProjectMemoryText, modelOverride, projectId, props.selectedFile, running, t, updateMessageText]);

  const sendMessage = async () => {
    await runPrompt(draft);
  };

  const processTelegramQueue = useCallback(async () => {
    if (!projectId || telegramProcessingRef.current || running) {
      return;
    }
    const next = telegramQueueRef.current.shift();
    if (!next) {
      return;
    }
    telegramProcessingRef.current = true;
    try {
      const ensured = ensureTelegramSession(
        sessionsRef.current,
        next.chatId,
        next.username,
        t("chat.sessionNew"),
      );
      if (ensured.sessions !== sessionsRef.current) {
        sessionsRef.current = ensured.sessions;
        setSessions(ensured.sessions);
      }
      setActiveSessionId(ensured.sessionId);
      await runPrompt(next.text, {
        sessionId: ensured.sessionId,
        telegramChatId: next.chatId,
        telegramMessageId: next.messageId,
        telegramUser: next.username,
      });
    } finally {
      telegramProcessingRef.current = false;
      if (telegramQueueRef.current.length > 0) {
        void processTelegramQueue();
      }
    }
  }, [projectId, runPrompt, running, t]);

  useEffect(() => {
    if (!projectId || !channelPrefs?.telegramEnabled) {
      return;
    }
    let cancelled = false;
    const offsetKey = `latotex.chat.telegram.offset.${projectId}`;
    const savedOffset = Number(localStorage.getItem(offsetKey) || "0");
    telegramOffsetRef.current = Number.isFinite(savedOffset) ? savedOffset : 0;

    const pollLoop = async () => {
      if (cancelled) {
        return;
      }
      try {
        const result = await channelsTelegramPoll({
          offset: telegramOffsetRef.current,
          limit: 30,
          timeoutSecs: 8,
        });
        const nextOffset = Number(result.nextOffset || 0);
        if (Number.isFinite(nextOffset) && nextOffset > telegramOffsetRef.current) {
          telegramOffsetRef.current = nextOffset;
          localStorage.setItem(offsetKey, String(nextOffset));
        }
        if (Array.isArray(result.updates) && result.updates.length > 0) {
          for (const item of result.updates) {
            const text = String(item.text || "").trim();
            if (!text) {
              continue;
            }
            telegramQueueRef.current.push({
              chatId: String(item.chatId),
              username: String(item.username || "telegram"),
              text,
              messageId: Number(item.messageId || 0),
            });
          }
          void processTelegramQueue();
        }
      } catch (error) {
        setLastError(String(error));
      } finally {
        if (!cancelled) {
          window.setTimeout(() => void pollLoop(), 1800);
        }
      }
    };

    void pollLoop();
    return () => {
      cancelled = true;
    };
  }, [channelPrefs?.telegramEnabled, processTelegramQueue, projectId]);

  useEffect(() => {
    if (!running) {
      void processTelegramQueue();
    }
  }, [processTelegramQueue, running]);

  useEffect(() => {
    if (running || !pendingAutoFixRef.current) {
      return;
    }
    const next = pendingAutoFixRef.current;
    pendingAutoFixRef.current = null;
    if (!next) {
      return;
    }
    void runPrompt(next.prompt, {
      forceNewSession: next.forceNewSession !== false,
    });
  }, [runPrompt, running]);

  useEffect(() => {
    if (!projectId || typeof window === "undefined") {
      return;
    }

    const resolveAutoFixKey = (input: ChatAutoFixRequest) => {
      const requestId = String(input.requestId || "").trim();
      if (requestId) {
        return requestId;
      }
      return `${input.projectId ?? "unknown"}:${input.source ?? "chat"}:${input.prompt}`;
    };

    const handleAutoFixRequest = (request: ChatAutoFixRequest) => {
      const prompt = String(request.prompt || "").trim();
      if (!prompt) {
        return;
      }
      if (request.projectId && request.projectId !== projectId) {
        return;
      }
      const key = resolveAutoFixKey(request);
      if (lastHandledAutoFixKeyRef.current === key) {
        return;
      }
      if (running) {
        pendingAutoFixRef.current = request;
        return;
      }
      lastHandledAutoFixKeyRef.current = key;
      pendingAutoFixRef.current = null;
      const global = window as Window & { __latotexPendingChatAutoFix?: ChatAutoFixRequest };
      if (global.__latotexPendingChatAutoFix) {
        const pendingKey = resolveAutoFixKey(global.__latotexPendingChatAutoFix);
        if (pendingKey === key) {
          global.__latotexPendingChatAutoFix = undefined;
        }
      }
      void runPrompt(prompt, {
        forceNewSession: request.forceNewSession !== false,
      });
    };

    const global = window as Window & { __latotexPendingChatAutoFix?: ChatAutoFixRequest };
    if (global.__latotexPendingChatAutoFix) {
      handleAutoFixRequest(global.__latotexPendingChatAutoFix);
    }

    const onAutoFix = (event: Event) => {
      const custom = event as CustomEvent<ChatAutoFixRequest>;
      if (!custom.detail) {
        return;
      }
      handleAutoFixRequest(custom.detail);
    };
    window.addEventListener("latotex.chat.autofix", onAutoFix as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.autofix", onAutoFix as EventListener);
    };
  }, [projectId, runPrompt, running]);

  const stopRun = async () => {
    const runId = pendingRunId;
    if (!runId) {
      return;
    }
    try {
      await executeWorkflowCancel(runId);
    } catch {
      // ignore
    }
  };

  if (!projectId) {
    return (
      <section className="app-material-panel flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed text-xs text-slate-500">
        {t("workspace.noProject")}
      </section>
    );
  }

  return (
    <section className="app-material-panel grid h-full min-h-0 grid-rows-[minmax(0,1fr)_auto] overflow-hidden rounded-lg border">
      <div ref={listRef} className="min-h-0 overflow-auto px-4 py-3">
        {!activeSession || activeSession.messages.length === 0 ? (
          <div className="grid h-full place-items-center px-6 text-center">
            <div className="max-w-md">
              <p className="font-serif text-base font-semibold text-[color:var(--app-fg)]">{t("chat.emptyTitle")}</p>
              <p className="mt-2 text-xs leading-5 text-[color:var(--app-muted)]">{t("chat.emptyHint")}</p>
            </div>
          </div>
        ) : (
          <ChatMessageList
            messages={activeSession.messages}
            events={hydratedEvents}
            running={running}
            latestRunningAssistantMessageId={runningAssistantMessageId}
            agentPendingAction={props.agentPendingAction ?? null}
            onResolveWorkspaceAgentPendingAction={props.onResolveWorkspaceAgentPendingAction}
            t={t}
          />
        )}
      </div>

      <ChatWorkspaceComposer
        draft={draft}
        running={running}
        lastError={lastError}
        agentPhase={props.agentPhase ?? "idle"}
        agentProposal={props.agentProposal ?? null}
        agentPendingAction={props.agentPendingAction ?? null}
        mode={chatMode}
        contextScope={contextScope}
        selectedFile={props.selectedFile}
        onDraftChange={setDraft}
        onModeChange={setChatMode}
        onContextScopeChange={setContextScope}
        onSend={() => void sendMessage()}
        onSendTeams={() => void runPrompt(draft, { teamMode: "force" })}
        onStop={() => void stopRun()}
        onAcceptWorkspaceAgentProposal={props.onAcceptWorkspaceAgentProposal}
        onRejectWorkspaceAgentProposal={props.onRejectWorkspaceAgentProposal}
        onResolveWorkspaceAgentPendingAction={props.onResolveWorkspaceAgentPendingAction}
        t={t}
      />
    </section>
  );
}





