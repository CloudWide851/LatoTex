import { Check, MessageSquarePlus, Trash2 } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  createChatSessionInStore,
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
  const [renameDraft, setRenameDraft] = useState("");

  useEffect(() => {
    if (!projectId) {
      setSessions([]);
      setActiveSessionId(null);
      setRenameDraft("");
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
    };
    window.addEventListener("latotex.chat.store.changed", onStoreChanged as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.store.changed", onStoreChanged as EventListener);
    };
  }, [projectId]);

  const activeSession = useMemo(
    () => sessions.find((item) => item.id === activeSessionId) ?? null,
    [activeSessionId, sessions],
  );

  useEffect(() => {
    setRenameDraft(activeSession?.title ?? "");
  }, [activeSession?.title]);

  const handleSelectSession = (sessionId: string) => {
    if (!projectId) {
      return;
    }
    const next = setActiveChatSessionInStore(projectId, sessionId);
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
    onActivateChat();
  };

  const handleCreate = () => {
    if (!projectId) {
      return;
    }
    const next = createChatSessionInStore(projectId, t("chat.sessionNew"));
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
    onActivateChat();
  };

  const handleRename = () => {
    if (!projectId || !activeSessionId) {
      return;
    }
    const nextTitle = renameDraft.trim().slice(0, 80);
    if (!nextTitle) {
      return;
    }
    const next = renameChatSessionInStore(projectId, activeSessionId, nextTitle);
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
  };

  const handleDelete = () => {
    if (!projectId || !activeSessionId) {
      return;
    }
    const next = deleteChatSessionInStore(projectId, activeSessionId);
    setSessions(next.sessions);
    setActiveSessionId(next.activeSessionId);
    onActivateChat();
  };

  return (
    <div className="space-y-2 p-2">
      <select
        value={activeSessionId ?? ""}
        onChange={(event) => handleSelectSession(event.target.value)}
        className="h-8 w-full rounded border border-slate-300 bg-white px-2 text-xs text-slate-700"
      >
        {sessions.map((item) => (
          <option key={item.id} value={item.id}>
            {item.title}
          </option>
        ))}
      </select>
      <div className="flex items-center gap-1">
        <input
          value={renameDraft}
          onChange={(event) => setRenameDraft(event.target.value)}
          maxLength={80}
          className="h-8 min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 text-xs text-slate-700"
          placeholder={t("chat.rename")}
        />
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-emerald-600 bg-emerald-600 text-white hover:bg-emerald-700 disabled:opacity-40"
          onClick={handleRename}
          title={t("chat.rename")}
          disabled={!activeSessionId || !renameDraft.trim()}
        >
          <Check className="h-3.5 w-3.5" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-slate-300 bg-white text-slate-600 hover:bg-slate-100"
          onClick={handleCreate}
          title={t("chat.newSession")}
        >
          <MessageSquarePlus className="h-3.5 w-3.5" />
        </button>
        <button
          className="inline-flex h-8 w-8 items-center justify-center rounded border border-rose-300 bg-white text-rose-600 hover:bg-rose-50 disabled:opacity-40"
          onClick={handleDelete}
          title={t("chat.deleteSession")}
          disabled={!activeSessionId}
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="flex justify-end">
        <button
          className="rounded border border-slate-300 bg-white px-2 py-1 text-[11px] text-slate-600 hover:bg-slate-100"
          onClick={onCloseMenu}
        >
          {t("common.close")}
        </button>
      </div>
    </div>
  );
}
