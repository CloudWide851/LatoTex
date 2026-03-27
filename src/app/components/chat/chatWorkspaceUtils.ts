import type { ChatSession } from "../../hooks/chatSessionStore";

type TranslationFn = (key: any) => string;

export type ChatAutoFixRequest = {
  projectId: string | null;
  prompt: string;
  forceNewSession?: boolean;
  source?: string;
  requestId?: string;
};

export function renderRunFailureMessage(t: TranslationFn, error: unknown): string {
  const detail = String(error ?? "").trim();
  if (!detail) {
    return t("chat.runFailed");
  }
  return t("chat.runFailedWithReason").replace("{reason}", detail);
}

export function titleFromPrompt(prompt: string, fallback: string) {
  const firstLine = prompt.replace(/\s+/g, " ").trim().slice(0, 42);
  return firstLine || fallback;
}

export function updateSession(
  sessions: ChatSession[],
  sessionId: string,
  updater: (session: ChatSession) => ChatSession,
): ChatSession[] {
  return sessions.map((item) => (item.id === sessionId ? updater(item) : item));
}

export function ensureTelegramSession(
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
  const next = {
    id: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: fallbackTitle,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    messages: [],
  };
  next.title = title;
  return {
    sessions: [next, ...sessions].slice(0, 80),
    sessionId: next.id,
  };
}

export function resolveAutoFixKey(input: ChatAutoFixRequest) {
  const requestId = String(input.requestId || "").trim();
  if (requestId) {
    return requestId;
  }
  return `${input.projectId ?? "unknown"}:${input.source ?? "chat"}:${input.prompt}`;
}