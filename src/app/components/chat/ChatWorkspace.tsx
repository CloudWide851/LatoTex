import { Send, Square } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  channelsTelegramPoll,
  channelsTelegramSend,
  getEvents,
  readFile,
  executeWorkflowCancel,
  executeWorkflowStart,
} from "../../../shared/api/desktop";
import { cn } from "../../../lib/utils";
import type { ChannelPrefs } from "../../../shared/types/app";
import {
  loadChatStore,
  newChatSession,
  saveChatStore,
  type ChatStoreChangeDetail,
  type ChatMessage,
  type ChatSession,
} from "../../hooks/chatSessionStore";
import { parseAgentPrompt } from "../../hooks/agentCommands";

type TranslationFn = (key: any) => string;


const HEARTBEAT_EXCLUDE = ["agent.run.heartbeat"];

type ChatAutoFixRequest = {
  projectId: string | null;
  prompt: string;
  forceNewSession?: boolean;
  source?: string;
  requestId?: string;
};

function renderRunFailureMessage(t: TranslationFn, error: unknown): string {
  const detail = String(error ?? "").trim();
  if (!detail) {
    return t("chat.runFailed");
  }
  return t("chat.runFailedWithReason").replace("{reason}", detail);
}
function titleFromPrompt(prompt: string, fallback: string) {
  const firstLine = prompt.replace(/\s+/g, " ").trim().slice(0, 42);
  return firstLine || fallback;
}

function updateSession(
  sessions: ChatSession[],
  sessionId: string,
  updater: (session: ChatSession) => ChatSession,
): ChatSession[] {
  return sessions.map((item) => (item.id === sessionId ? updater(item) : item));
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
  t: TranslationFn;
}) {
  const { projectId, modelOverride, channelPrefs, t } = props;
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [lastError, setLastError] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const sessionsRef = useRef<ChatSession[]>([]);
  const telegramOffsetRef = useRef(0);
  const telegramQueueRef = useRef<Array<{ chatId: string; username: string; text: string; messageId: number }>>([]);
  const telegramProcessingRef = useRef(false);
  const pendingAutoFixRef = useRef<ChatAutoFixRequest | null>(null);
  const lastHandledAutoFixKeyRef = useRef<string>("");

  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setActiveSessionId(null);
      return;
    }
    const loaded = loadChatStore(projectId);
    setSessions(loaded.sessions);
    setActiveSessionId(loaded.activeSessionId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId) {
      return;
    }
    saveChatStore(projectId, sessions, activeSessionId);
  }, [activeSessionId, projectId, sessions]);

  useEffect(() => {
    if (!projectId || typeof window === "undefined") {
      return;
    }
    const handleStoreChanged = (event: Event) => {
      const custom = event as CustomEvent<ChatStoreChangeDetail>;
      if (!custom.detail || custom.detail.projectId !== projectId) {
        return;
      }
      setSessions(custom.detail.sessions);
      setActiveSessionId(custom.detail.activeSessionId);
    };
    window.addEventListener("latotex.chat.store.changed", handleStoreChanged as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.store.changed", handleStoreChanged as EventListener);
    };
  }, [projectId]);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [activeSessionId, sessions]);

  useEffect(() => {
    sessionsRef.current = sessions;
  }, [sessions]);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const ensureSession = useCallback(() => {
    if (activeSessionId && sessions.some((item) => item.id === activeSessionId)) {
      return activeSessionId;
    }
    const session = newChatSession(t("chat.sessionNew"));
    setSessions((prev) => [session, ...prev].slice(0, 80));
    setActiveSessionId(session.id);
    return session.id;
  }, [activeSessionId, sessions, t]);

  const appendMessage = (sessionId: string, message: ChatMessage) => {
    setSessions((prev) =>
      updateSession(prev, sessionId, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: [...session.messages, message].slice(-600),
      })),
    );
  };

  const updateMessageText = (sessionId: string, messageId: string, text: string) => {
    setSessions((prev) =>
      updateSession(prev, sessionId, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((item) => (item.id === messageId ? { ...item, text } : item)),
      })),
    );
  };

  const loadProjectMemoryText = useCallback(async () => {
    if (!projectId) {
      return "";
    }
    const candidates = [".latotex/MEMORY.md", "MEMORY.md", "memory.md"];
    for (const path of candidates) {
      try {
        const loaded = await readFile(projectId, path);
        const text = String(loaded.content || "").trim();
        if (text) {
          return text;
        }
      } catch {
        // Try next candidate.
      }
    }
    return "";
  }, [projectId]);

  const runPrompt = useCallback(async (
    promptRaw: string,
    options?: {
      sessionId?: string;
      telegramChatId?: string;
      telegramMessageId?: number;
      telegramUser?: string;
      forceNewSession?: boolean;
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
    try {
      const accepted = await executeWorkflowStart({
        projectId,
        workflowId: "chat.general",
        callsite: "chat.workspace",
        prompt,
        contextRefs: [],
        modelOverride: modelOverride ?? undefined,
      });
      setPendingRunId(accepted.runId);
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
    }
  }, [appendMessage, ensureSession, loadProjectMemoryText, modelOverride, projectId, running, t, updateMessageText]);

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
      <section className="flex h-full min-h-0 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-xs text-slate-500">
        {t("workspace.noProject")}
      </section>
    );
  }

  return (
    <section className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_128px] overflow-hidden rounded-lg border border-slate-200 bg-white shadow-soft">
      <div ref={listRef} className="min-h-0 overflow-auto px-4 py-3">
        {!activeSession || activeSession.messages.length === 0 ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-400">{t("chat.empty")}</div>
        ) : (
          <div className="space-y-2">
            {activeSession.messages.map((item) => (
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
                <div className="whitespace-pre-wrap break-words">{item.text || (running ? "..." : "")}</div>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="flex h-full min-h-0 flex-col border-t border-slate-200 px-2 pb-2 pt-1.5">
        <div className="relative min-h-0 flex-1">
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t("chat.inputPlaceholder")}
            className="h-full w-full resize-none rounded-md border border-slate-300 bg-white px-3 py-2 pr-12 text-sm leading-5 outline-none focus:border-primary-500"
          />
          <button
            className={`absolute bottom-2 right-2 inline-flex h-8 w-8 items-center justify-center rounded-full border transition ${
              running
                ? "border-amber-400 bg-amber-50 text-amber-700 hover:bg-amber-100"
                : "border-primary-600 bg-primary-600 text-white hover:bg-primary-700"
            }`}
            onClick={() => {
              if (running) {
                void stopRun();
                return;
              }
              void sendMessage();
            }}
            disabled={!running && !draft.trim()}
            title={running ? t("agent.run.cancel") : t("chat.send")}
            aria-label={running ? t("agent.run.cancel") : t("chat.send")}
          >
            {running ? <Square className="h-3.5 w-3.5" /> : <Send className="h-3.5 w-3.5" />}
          </button>
        </div>
        {lastError ? <div className="mt-1 truncate text-[11px] text-rose-600">{lastError}</div> : null}
      </div>
    </section>
  );
}





