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

export type ChatStoreChangeDetail = {
  projectId: string;
  sessions: ChatSession[];
  activeSessionId: string | null;
};

export type ChatSessionOpenDetail = {
  projectId: string;
  sessionId: string;
};

function nowIso() {
  return new Date().toISOString();
}

function sessionStorageKey(projectId: string) {
  return `latotex.chat.sessions.${projectId}`;
}

export function createChatStoreChangedEvent(
  detail: ChatStoreChangeDetail,
): CustomEvent<ChatStoreChangeDetail> | null {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return null;
  }
  return new CustomEvent<ChatStoreChangeDetail>("latotex.chat.store.changed", { detail });
}

export function createChatSessionOpenEvent(
  detail: ChatSessionOpenDetail,
): CustomEvent<ChatSessionOpenDetail> | null {
  if (typeof window === "undefined" || typeof CustomEvent === "undefined") {
    return null;
  }
  return new CustomEvent<ChatSessionOpenDetail>("latotex.chat.session.open", { detail });
}

function emitChatStoreChanged(detail: ChatStoreChangeDetail) {
  const event = createChatStoreChangedEvent(detail);
  if (!event || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(event);
}

export function requestOpenChatSession(detail: ChatSessionOpenDetail) {
  const event = createChatSessionOpenEvent(detail);
  if (!event || typeof window === "undefined") {
    return;
  }
  window.dispatchEvent(event);
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
    return { sessions: [], activeSessionId: null };
  }
  try {
    const raw = window.localStorage.getItem(sessionStorageKey(projectId));
    if (!raw) {
      return { sessions: [], activeSessionId: null };
    }
    const parsed = JSON.parse(raw) as Partial<ChatStorePayload>;
    const sessions = Array.isArray(parsed.sessions)
      ? parsed.sessions.map(sanitizeSession).filter((item): item is ChatSession => Boolean(item)).slice(-80)
      : [];
    if (sessions.length === 0) {
      return { sessions: [], activeSessionId: null };
    }
    const activeSessionId = typeof parsed.activeSessionId === "string"
      && sessions.some((item) => item.id === parsed.activeSessionId)
      ? parsed.activeSessionId
      : sessions[0]!.id;
    return { sessions, activeSessionId };
  } catch {
    return { sessions: [], activeSessionId: null };
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
  emitChatStoreChanged({ projectId, sessions: payload.sessions, activeSessionId });
}

export function createChatSessionInStore(projectId: string, title?: string): ChatStorePayload {
  const loaded = loadChatStore(projectId);
  const next = newChatSession(title);
  const sessions = [next, ...loaded.sessions].slice(0, 80);
  saveChatStore(projectId, sessions, next.id);
  return { sessions, activeSessionId: next.id };
}

export function setActiveChatSessionInStore(projectId: string, sessionId: string): ChatStorePayload {
  const loaded = loadChatStore(projectId);
  const exists = loaded.sessions.some((item) => item.id === sessionId);
  const activeSessionId = exists ? sessionId : (loaded.sessions[0]?.id ?? null);
  saveChatStore(projectId, loaded.sessions, activeSessionId);
  return { sessions: loaded.sessions, activeSessionId };
}

export function renameChatSessionInStore(
  projectId: string,
  sessionId: string,
  title: string,
): ChatStorePayload {
  const loaded = loadChatStore(projectId);
  const trimmed = title.trim().slice(0, 80);
  const sessions = loaded.sessions.map((item) =>
    item.id === sessionId && trimmed
      ? { ...item, title: trimmed, updatedAt: nowIso() }
      : item
  );
  saveChatStore(projectId, sessions, loaded.activeSessionId);
  return { sessions, activeSessionId: loaded.activeSessionId };
}

export function deleteChatSessionInStore(projectId: string, sessionId: string): ChatStorePayload {
  const loaded = loadChatStore(projectId);
  const sessions = loaded.sessions.filter((item) => item.id !== sessionId);
  if (sessions.length === 0) {
    saveChatStore(projectId, [], null);
    return { sessions: [], activeSessionId: null };
  }
  const activeSessionId = loaded.activeSessionId === sessionId
    ? sessions[0]!.id
    : loaded.activeSessionId;
  saveChatStore(projectId, sessions, activeSessionId);
  return { sessions, activeSessionId };
}
