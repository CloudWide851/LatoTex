import { Check, Pencil, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import {
  deleteChatSessionInStore,
  loadChatStore,
  renameChatSessionInStore,
  setActiveChatSessionInStore,
  type ChatSession,
  type ChatStoreChangeDetail,
} from "../../hooks/chatSessionStore";

type TranslationFn = (key: any) => string;

export function ChatTabMenuContent(props: {
  projectId: string | null;
  onActivateChat: () => void;
  onCloseMenu: () => void;
  t: TranslationFn;
}) {
  const { projectId, onActivateChat, onCloseMenu, t } = props;
  const [sessions, setSessions] = useState<ChatSession[]>([]);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [editingSessionId, setEditingSessionId] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setActiveSessionId(null);
      setEditingSessionId(null);
      setEditingDraft("");
      return;
    }
    const loaded = loadChatStore(projectId);
    setSessions(loaded.sessions);
    setActiveSessionId(loaded.activeSessionId);
  }, [projectId]);

  useEffect(() => {
    if (!projectId || typeof window === "undefined") {
      return;
    }
    const onStoreChanged = (event: Event) => {
      const custom = event as CustomEvent<ChatStoreChangeDetail>;
      if (!custom.detail || custom.detail.projectId !== projectId) {
        return;
      }
      setSessions(custom.detail.sessions);
      setActiveSessionId(custom.detail.activeSessionId);
      if (editingSessionId && !custom.detail.sessions.some((item) => item.id === editingSessionId)) {
        setEditingSessionId(null);
        setEditingDraft("");
      }
    };
    window.addEventListener("latotex.chat.store.changed", onStoreChanged as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.store.changed", onStoreChanged as EventListener);
    };
  }, [editingSessionId, projectId]);

  const handleSelectSession = (sessionId: string) => {
    if (!projectId) {
      return;
    }
    const next = setActiveChatSessionInStore(projectId, sessionId);
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
    setEditingSessionId(null);
    setEditingDraft("");
    onActivateChat();
    onCloseMenu();
  };

  const handleStartRename = (session: ChatSession) => {
    setEditingSessionId(session.id);
    setEditingDraft(session.title);
  };

  const handleCommitRename = () => {
    if (!projectId || !editingSessionId) {
      return;
    }
    const nextTitle = editingDraft.trim().slice(0, 80);
    if (!nextTitle) {
      return;
    }
    const next = renameChatSessionInStore(projectId, editingSessionId, nextTitle);
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
    setEditingSessionId(null);
    setEditingDraft("");
  };

  const handleDelete = (sessionId: string) => {
    if (!projectId) {
      return;
    }
    const next = deleteChatSessionInStore(projectId, sessionId);
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
    if (editingSessionId === sessionId) {
      setEditingSessionId(null);
      setEditingDraft("");
    }
    onActivateChat();
  };

  if (!projectId) {
    return null;
  }

  return (
    <div className="max-h-[320px] overflow-auto p-2">
      {sessions.length === 0 ? (
        <div className="rounded border border-slate-200 bg-slate-50 px-2 py-2 text-xs text-slate-500">
          {t("chat.session.emptyHistory")}
        </div>
      ) : (
        <div className="space-y-1">
          {sessions.map((session) => {
            const selected = session.id === activeSessionId;
            const editing = session.id === editingSessionId;
            return (
              <div
                key={session.id}
                className={`group flex items-center gap-1 rounded border px-1 py-1 ${
                  selected ? "border-primary-500 bg-primary-50" : "border-slate-200 bg-white"
                }`}
              >
                {editing ? (
                  <>
                    <input
                      value={editingDraft}
                      onChange={(event) => setEditingDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          event.preventDefault();
                          handleCommitRename();
                        }
                        if (event.key === "Escape") {
                          event.preventDefault();
                          setEditingSessionId(null);
                          setEditingDraft("");
                        }
                      }}
                      maxLength={80}
                      className="h-7 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700"
                      placeholder={t("chat.rename")}
                      autoFocus
                    />
                    <button
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700"
                      onClick={handleCommitRename}
                      title={t("common.confirm")}
                      disabled={!editingDraft.trim()}
                    >
                      <Check className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                      onClick={() => {
                        setEditingSessionId(null);
                        setEditingDraft("");
                      }}
                      title={t("common.cancel")}
                    >
                      <X className="h-3.5 w-3.5" />
                    </button>
                  </>
                ) : (
                  <>
                    <button
                      className="min-w-0 flex-1 truncate rounded px-1.5 py-1 text-left text-xs text-slate-700 hover:bg-slate-100"
                      onClick={() => handleSelectSession(session.id)}
                      title={session.title}
                    >
                      {session.title}
                    </button>
                    <button
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleStartRename(session);
                      }}
                      title={t("chat.session.rename")}
                    >
                      <Pencil className="h-3.5 w-3.5" />
                    </button>
                    <button
                      className="inline-flex h-7 w-7 items-center justify-center rounded border border-rose-300 bg-white text-rose-600 hover:bg-rose-50"
                      onClick={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        handleDelete(session.id);
                      }}
                      title={t("chat.session.delete")}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
