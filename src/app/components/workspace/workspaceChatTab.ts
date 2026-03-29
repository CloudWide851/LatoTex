type ChatSessionLike = {
  id: string;
  title: string;
};

type ChatStorePayloadLike = {
  sessions: ChatSessionLike[];
  activeSessionId: string | null;
};

type CreateChatSession = (projectId: string, title: string) => ChatStorePayloadLike;

export function buildNewChatTabState(
  activeProjectId: string | null,
  defaultTitle: string,
  createSession: CreateChatSession,
) {
  if (!activeProjectId) {
    return null;
  }
  const next = createSession(activeProjectId, defaultTitle);
  const activeTitle = next.activeSessionId
    ? next.sessions.find((item) => item.id === next.activeSessionId)?.title ?? null
    : null;
  const fallbackTitle = defaultTitle.trim() || null;
  return {
    chatTabOpen: true,
    chatTabActive: true,
    chatTabTitle: activeTitle ?? fallbackTitle,
  };
}
