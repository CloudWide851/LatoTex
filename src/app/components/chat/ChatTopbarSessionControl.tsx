import { ChevronDown, MessageSquareMore } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { loadChatStore, type ChatStoreChangeDetail } from "../../hooks/chatSessionStore";
import { ChatTabMenuContent } from "./ChatTabMenuContent";
import { dropdownSurfaceClassName, useDropdownDismiss } from "../../../components/ui/dropdown";

type TranslationFn = (key: any) => string;

function resolveActiveSessionTitle(projectId: string): string | null {
  const store = loadChatStore(projectId);
  if (!store.activeSessionId) {
    return null;
  }
  return store.sessions.find((item) => item.id === store.activeSessionId)?.title ?? null;
}

export function ChatTopbarSessionControl(props: {
  activeProjectId: string | null;
  onOpenChatTab: () => void;
  onSessionStateChanged?: (activeTitle: string | null) => void;
  t: TranslationFn;
}) {
  const { activeProjectId, onOpenChatTab, onSessionStateChanged, t } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useDropdownDismiss({ open: menuOpen, rootRef, onClose: () => setMenuOpen(false) });

  useEffect(() => {
    if (!activeProjectId) {
      setMenuOpen(false);
    }
  }, [activeProjectId]);

  useEffect(() => {
    if (!onSessionStateChanged) {
      return;
    }
    if (!activeProjectId) {
      onSessionStateChanged(null);
      return;
    }

    onSessionStateChanged(resolveActiveSessionTitle(activeProjectId));

    if (typeof window === "undefined") {
      return;
    }
    const handleStoreChanged = (event: Event) => {
      const custom = event as CustomEvent<ChatStoreChangeDetail>;
      if (!custom.detail || custom.detail.projectId !== activeProjectId) {
        return;
      }
      const title = custom.detail.activeSessionId
        ? custom.detail.sessions.find((item) => item.id === custom.detail.activeSessionId)?.title ?? null
        : null;
      onSessionStateChanged(title);
    };
    window.addEventListener("latotex.chat.store.changed", handleStoreChanged as EventListener);
    return () => {
      window.removeEventListener("latotex.chat.store.changed", handleStoreChanged as EventListener);
    };
  }, [activeProjectId, onSessionStateChanged]);

  return (
    <div ref={rootRef} className="relative">
      <div className="inline-flex overflow-hidden rounded border border-slate-300 bg-white">
        <button
          className="panel-topbar-btn rounded-none border-r border-slate-300 text-slate-700 transition hover:bg-slate-100"
          title={t("nav.chat")}
          aria-label={t("nav.chat")}
          onClick={onOpenChatTab}
        >
          <MessageSquareMore className="h-3.5 w-3.5" />
        </button>
        <button
          className="panel-topbar-btn !w-7 rounded-none text-slate-700 transition hover:bg-slate-100"
          title={t("chat.session.select")}
          aria-label={t("chat.session.select")}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          onClick={() => setMenuOpen((prev) => !prev)}
          disabled={!activeProjectId}
        >
          <ChevronDown className="h-3.5 w-3.5" />
        </button>
      </div>
      {menuOpen ? (
        <div className={dropdownSurfaceClassName("absolute left-0 top-[calc(100%+8px)] w-[320px] max-w-[80vw]")}>
          <ChatTabMenuContent
            projectId={activeProjectId}
            onActivateChat={onOpenChatTab}
            onCloseMenu={() => setMenuOpen(false)}
            onSessionStateChanged={onSessionStateChanged}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}
