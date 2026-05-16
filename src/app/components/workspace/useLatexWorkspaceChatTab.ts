import { useEffect, useState } from "react";
import { runtimeLogWrite } from "../../../shared/api/runtime";
import { createChatSessionInStore, loadChatStore, type ChatSessionOpenDetail } from "../../hooks/chatSessionStore";
import {
  loadLatexWorkspaceSession,
  persistLatexWorkspaceChatSession,
} from "./latexWorkspaceSession";
import { buildNewChatTabState } from "./workspaceChatTab";

type TranslationFn = (key: any) => string;

export function useLatexWorkspaceChatTab(params: {
  activeProjectId: string | null;
  page: string;
  agentCollapsed: boolean;
  onPageChange: (page: any) => void;
  onAgentToggle: () => void;
  onChatReviewRequest: (prompt: string) => void;
  t: TranslationFn;
}) {
  const {
    activeProjectId,
    page,
    agentCollapsed,
    onPageChange,
    onAgentToggle,
    onChatReviewRequest,
    t,
  } = params;
  const [chatTabOpen, setChatTabOpen] = useState(false);
  const [chatTabActive, setChatTabActive] = useState(false);
  const [chatTabTitle, setChatTabTitle] = useState<string | null>(null);

  useEffect(() => {
    setChatTabTitle(null);
    if (!activeProjectId) {
      setChatTabOpen(false);
      setChatTabActive(false);
      return;
    }
    const restored = loadLatexWorkspaceSession(activeProjectId);
    if (!restored?.chatTabOpen) {
      setChatTabOpen(false);
      setChatTabActive(false);
      return;
    }
    const store = loadChatStore(activeProjectId);
    const activeTitle = store.activeSessionId
      ? store.sessions.find((item) => item.id === store.activeSessionId)?.title ?? null
      : null;
    setChatTabOpen(true);
    setChatTabActive(restored.chatTabActive);
    setChatTabTitle(activeTitle);
    void runtimeLogWrite(
      "INFO",
      `latex_chat_tab_restore: project=${activeProjectId}, active=${restored.chatTabActive}`,
    ).catch(() => undefined);
  }, [activeProjectId]);

  useEffect(() => {
    if (!activeProjectId) {
      return;
    }
    const timer = window.setTimeout(() => {
      persistLatexWorkspaceChatSession({
        projectId: activeProjectId,
        chatTabOpen,
        chatTabActive,
      });
    }, 250);
    return () => {
      window.clearTimeout(timer);
    };
  }, [activeProjectId, chatTabActive, chatTabOpen]);

  useEffect(() => {
    if (page !== "latex") {
      setChatTabActive(false);
    }
  }, [page]);

  useEffect(() => {
    if (!activeProjectId || typeof window === "undefined") {
      return;
    }
    const handleOpenChatSession = (event: Event) => {
      const custom = event as CustomEvent<ChatSessionOpenDetail>;
      if (!custom.detail || custom.detail.projectId !== activeProjectId) {
        return;
      }
      const store = loadChatStore(activeProjectId);
      const title = store.sessions.find((item) => item.id === custom.detail.sessionId)?.title ?? null;
      setChatTabOpen(true);
      setChatTabActive(true);
      setChatTabTitle(title);
      onPageChange("latex");
    };
    window.addEventListener("latotex.chat.session.open", handleOpenChatSession as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.session.open", handleOpenChatSession as EventListener);
    };
  }, [activeProjectId, onPageChange]);

  const handleCreateChatTab = () => {
    const next = buildNewChatTabState(activeProjectId, t("chat.sessionNew"), createChatSessionInStore);
    if (!next) {
      return;
    }
    setChatTabOpen(next.chatTabOpen);
    setChatTabActive(next.chatTabActive);
    setChatTabTitle(next.chatTabTitle);
  };

  const handleChatReviewRequest = (prompt: string) => {
    setChatTabActive(false);
    if (agentCollapsed) {
      onAgentToggle();
    }
    onChatReviewRequest(prompt);
  };

  return {
    chatTabOpen,
    chatTabActive,
    chatTabTitle,
    showChatWorkspace: chatTabOpen && chatTabActive,
    setChatTabActive,
    setChatTabTitle,
    handleCreateChatTab,
    handleOpenChatTab: () => {
      setChatTabOpen(true);
      setChatTabActive(true);
    },
    handleCloseChatTab: () => {
      setChatTabOpen(false);
      setChatTabActive(false);
    },
    handleChatReviewRequest,
  };
}
