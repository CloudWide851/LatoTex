export type ChatMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  text: string;
  createdAt: string;
};

export type ChatSession = {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messages: ChatMessage[];
};

type ChatStorePayload = {
  sessions: ChatSession[];
  activeSessionId: string | null;
};

function nowIso() {
  return new Date().toISOString();
}

function sessionStorageKey(projectId: string) {
  return `latotex.chat.sessions.${projectId}`;
}

export function newChatSession(title?: string): ChatSession {
  const now = nowIso();
  return {
    id: `chat-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
    title: (title?.trim() || "New Chat").slice(0, 80),
    createdAt: now,
    updatedAt: now,
    messages: [],
  };
}

function sanitizeMessage(raw: unknown): ChatMessage | null {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!source) {
    return null;
  }
  const role = typeof source.role === "string" ? source.role : "";
  if (role !== "user" && role !== "assistant" && role !== "system") {
    return null;
  }
  const text = typeof source.text === "string" ? source.text : "";
  return {
    id: typeof source.id === "string" ? source.id : `msg-${Date.now().toString(36)}`,
    role,
    text,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : nowIso(),
  };
}

function sanitizeSession(raw: unknown): ChatSession | null {
  const source = raw && typeof raw === "object" ? raw as Record<string, unknown> : null;
  if (!source || typeof source.id !== "string") {
    return null;
  }
  const messages = Array.isArray(source.messages)
    ? source.messages.map(sanitizeMessage).filter((item): item is ChatMessage => Boolean(item)).slice(-500)
    : [];
  return {
    id: source.id,
    title: (typeof source.title === "string" && source.title.trim() ? source.title : "New Chat").slice(0, 80),
    createdAt: typeof source.createdAt === "string" ? source.createdAt : nowIso(),
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : nowIso(),
    messages,
  };
}

export function loadChatStore(projectId: string): ChatStorePayload {
  if (typeof window === "undefined") {
    const session = newChatSession();
    return { sessions: [session], activeSessionId: session.id };
  }
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(projectId));
    if (!raw) {
      const session = newChatSession();
      return { sessions: [session], activeSessionId: session.id };
    }
    const parsed = JSON.parse(raw) as Partial<ChatStorePayload>;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(sanitizeSession).filter((item): item is ChatSession => Boolean(item)).slice(-80)
      : [];
    if (sessions.length === 0) {
      const session = newChatSession();
      return { sessions: [session], activeSessionId: session.id };
    }
    const activeSessionId = typeof parsed.activeSessionId === "string"
      && sessions.some((item) => item.id === parsed.activeSessionId)
      ? parsed.activeSessionId
      : sessions[0]!.id;
    return { sessions, activeSessionId };
  } catch {
    const session = newChatSession();
    return { sessions: [session], activeSessionId: session.id };
  }
}

export function saveChatStore(
  projectId: string,
  sessions: ChatSession[],
  activeSessionId: string | null,
) {
  if (typeof window === "undefined") {
    return;
  }
  const payload: ChatStorePayload = {
    sessions: sessions.slice(-80),
    activeSessionId,
  };
  window.localStorage.setItem(sessionStorageKey(projectId), JSON.stringify(payload));
}

