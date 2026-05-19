import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { readFile } from "../../../shared/api/workspace";
import type { AgentChatMessage } from "../../hooks/agentTypes";
import {
  loadChatStore,
  newChatSession,
  saveChatStore,
  type ChatStoreChangeDetail,
  type ChatMessage,
  type ChatSession,
} from "../../hooks/chatSessionStore";
import { updateSession } from "./chatWorkspaceUtils";

type TranslationFn = (key: any) => string;

function chatStoreMatchesCurrent(
  current: ChatSession[],
  currentActiveSessionId: string | null,
  nextSessions: ChatSession[],
  nextActiveSessionId: string | null,
): boolean {
  if (currentActiveSessionId !== nextActiveSessionId || current.length !== nextSessions.length) {
    return false;
  }
  return current.every((session, index) => {
    const next = nextSessions[index];
    return Boolean(next)
      && session.id === next.id
      && session.updatedAt === next.updatedAt
      && session.messages.length === next.messages.length;
  });
}

export function useChatWorkspaceState(props: {
  projectId: string | null;
  agentMessages: AgentChatMessage[];
  agentRunId: string | null;
  t: TranslationFn;
}) {
  const { projectId, agentMessages, agentRunId, t } = props;
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [running, setRunning] = useState(false);
  const [pendingRunId, setPendingRunId] = useState<string | null>(null);
  const [lastError, setLastError] = useState("");
  const [workspaceAgentSync, setWorkspaceAgentSync] = useState<{
    sessionId: string;
    messageId: string;
    startIndex: number;
  } | null>(null);
  const latestWorkspaceAgentTextRef = useRef("");
  const sessionsRef = useRef<ChatSession[]>([]);
  const activeSessionIdRef = useRef<string | null>(null);
  sessionsRef.current = sessions;
  activeSessionIdRef.current = activeSessionId;

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
      if (
        chatStoreMatchesCurrent(
          sessionsRef.current,
          activeSessionIdRef.current,
          custom.detail.sessions,
          custom.detail.activeSessionId,
        )
      ) {
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

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  const updateMessageText = useCallback((sessionId: string, messageId: string, text: string) => {
    setSessions((prev) =>
      updateSession(prev, sessionId, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((item) => (item.id === messageId ? { ...item, text } : item)),
      })),
    );
  }, []);

  const updateMessageRunId = useCallback((sessionId: string, messageId: string, runId: string | null) => {
    setSessions((prev) =>
      updateSession(prev, sessionId, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map((item) => (item.id === messageId ? { ...item, runId } : item)),
      })),
    );
  }, []);

  const latestWorkspaceAgentText = useMemo(() => {
    if (!workspaceAgentSync) {
      return "";
    }
    const nextMessages = agentMessages
      .slice(workspaceAgentSync.startIndex)
      .filter((item) => item.role === "agent" && item.text.trim().length > 0);
    return nextMessages[nextMessages.length - 1]?.text ?? "";
  }, [agentMessages, workspaceAgentSync]);

  useEffect(() => {
    latestWorkspaceAgentTextRef.current = latestWorkspaceAgentText;
  }, [latestWorkspaceAgentText]);

  useEffect(() => {
    if (!workspaceAgentSync || !latestWorkspaceAgentText) {
      return;
    }
    updateMessageText(workspaceAgentSync.sessionId, workspaceAgentSync.messageId, latestWorkspaceAgentText);
  }, [latestWorkspaceAgentText, updateMessageText, workspaceAgentSync]);

  useEffect(() => {
    if (!workspaceAgentSync || !agentRunId) {
      return;
    }
    updateMessageRunId(workspaceAgentSync.sessionId, workspaceAgentSync.messageId, agentRunId);
  }, [agentRunId, updateMessageRunId, workspaceAgentSync]);

  const ensureSession = useCallback(() => {
    if (activeSessionId && sessions.some((item) => item.id === activeSessionId)) {
      return activeSessionId;
    }
    const session = newChatSession(t("chat.sessionNew"));
    setSessions((prev) => [session, ...prev].slice(0, 80));
    setActiveSessionId(session.id);
    return session.id;
  }, [activeSessionId, sessions, t]);

  const appendMessage = useCallback((sessionId: string, message: ChatMessage) => {
    setSessions((prev) =>
      updateSession(prev, sessionId, (session) => ({
        ...session,
        updatedAt: new Date().toISOString(),
        messages: [...session.messages, message].slice(-600),
      })),
    );
  }, []);

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

  return {
    activeSession,
    activeSessionId,
    appendMessage,
    draft,
    ensureSession,
    lastError,
    latestWorkspaceAgentTextRef,
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
    setWorkspaceAgentSync,
    updateMessageRunId,
    updateMessageText,
    workspaceAgentSync,
  };
}
