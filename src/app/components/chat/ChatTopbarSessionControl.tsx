import { ChevronDown, MessageSquareMore } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { ChatTabMenuContent } from "./ChatTabMenuContent";

type TranslationFn = (key: any) => string;

export function ChatTopbarSessionControl(props: {
  activeProjectId: string | null;
  onOpenChatTab: () => void;
  t: TranslationFn;
}) {
  const { activeProjectId, onOpenChatTab, t } = props;
  const [menuOpen, setMenuOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const handleOutsideClick = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (rootRef.current && target && rootRef.current.contains(target)) {
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", handleOutsideClick);
    return () => window.removeEventListener("mousedown", handleOutsideClick);
  }, [menuOpen]);

  return (
    <div ref={rootRef} className="relative flex items-center gap-1">
      <button
        className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
        title={t("nav.chat")}
        aria-label={t("nav.chat")}
        onClick={onOpenChatTab}
      >
        <MessageSquareMore className="h-3.5 w-3.5" />
      </button>
      <button
        className="panel-topbar-btn rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
        title={t("chat.session.select")}
        aria-label={t("chat.session.select")}
        onClick={() => {
          onOpenChatTab();
          setMenuOpen((prev) => !prev);
        }}
        disabled={!activeProjectId}
      >
        <ChevronDown className="h-3.5 w-3.5" />
      </button>
      {menuOpen ? (
        <div className="absolute left-0 top-[calc(100%+8px)] z-[240] w-[300px] max-w-[80vw] rounded-md border border-slate-300 bg-white shadow-soft">
          <ChatTabMenuContent
            projectId={activeProjectId}
            onActivateChat={onOpenChatTab}
            onCloseMenu={() => setMenuOpen(false)}
            t={t}
          />
        </div>
      ) : null}
    </div>
  );
}
