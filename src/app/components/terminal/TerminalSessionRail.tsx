import { Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { TerminalTab, TranslationFn } from "./terminalTypes";

function terminalStatusClass(tab: TerminalTab) {
  if (tab.error || tab.status === "failed") {
    return "bg-rose-500";
  }
  if (tab.status === "running") {
    return "bg-emerald-500";
  }
  if (tab.status === "starting") {
    return "bg-amber-500";
  }
  return "bg-slate-400";
}

export function TerminalSessionRail(props: {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onNew: () => void;
  onReorder: (sourceId: string, targetId: string) => void;
  t: TranslationFn;
}) {
  const { tabs, activeTabId, onSelect, onClose, onNew, onReorder, t } = props;
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    lastTargetId: string;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      const distance = Math.abs(event.clientX - drag.startX) + Math.abs(event.clientY - drag.startY);
      if (!drag.active && distance < 4) {
        return;
      }
      drag.active = true;
      setDraggingId(drag.id);
      const target = document.elementFromPoint(event.clientX, event.clientY)?.closest("[data-terminal-tab-id]") as HTMLElement | null;
      const targetId = target?.dataset.terminalTabId ?? "";
      if (targetId && targetId !== drag.id && targetId !== drag.lastTargetId) {
        drag.lastTargetId = targetId;
        onReorder(drag.id, targetId);
      }
      event.preventDefault();
    };
    const handleUp = (event: PointerEvent) => {
      const drag = dragRef.current;
      if (!drag || event.pointerId !== drag.pointerId) {
        return;
      }
      suppressClickRef.current = drag.active;
      dragRef.current = null;
      setDraggingId(null);
      window.setTimeout(() => {
        suppressClickRef.current = false;
      }, 0);
    };
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
    window.addEventListener("pointercancel", handleUp);
    return () => {
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
      window.removeEventListener("pointercancel", handleUp);
    };
  }, [onReorder]);

  return (
    <aside className="flex w-24 shrink-0 flex-col border-r border-[color:var(--editor-shell-divider)] bg-[color:var(--editor-widget-bg)]">
      <div className="flex min-h-9 items-center justify-between border-b border-[color:var(--editor-shell-divider)] px-2">
        <span className="truncate text-[11px] font-semibold text-[color:var(--editor-tab-muted)]">
          {t("terminal.title")}
        </span>
        <button
          type="button"
          className="panel-topbar-btn editor-toolbar-btn h-6 w-6"
          onClick={onNew}
          title={t("terminal.new")}
          aria-label={t("terminal.new")}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
      <div className="hide-scrollbar min-h-0 flex-1 space-y-1 overflow-y-auto p-1">
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          return (
            <div
              key={tab.id}
              data-terminal-tab-id={tab.id}
              className={`group flex w-full min-w-0 items-stretch gap-1 rounded-md border text-[11px] transition ${
                active
                  ? "border-primary-400 bg-primary-50 text-primary-900"
                  : "border-transparent text-[color:var(--editor-tab-muted)] hover:border-[color:var(--editor-widget-border)] hover:bg-[color:var(--editor-paper-bg)]"
              } ${draggingId === tab.id ? "opacity-70 ring-1 ring-primary-300" : ""}`}
              title={tab.cwd || tab.relativePath || tab.title}
              onPointerDown={(event) => {
                if (event.button !== 0) {
                  return;
                }
                dragRef.current = {
                  id: tab.id,
                  pointerId: event.pointerId,
                  startX: event.clientX,
                  startY: event.clientY,
                  active: false,
                  lastTargetId: "",
                };
              }}
            >
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left"
                onClick={() => {
                  if (!suppressClickRef.current) {
                    onSelect(tab.id);
                  }
                }}
              >
                <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${terminalStatusClass(tab)}`} />
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              </button>
              <button
                type="button"
                className="mr-1 hidden h-4 w-4 shrink-0 items-center justify-center rounded text-slate-500 hover:bg-white/70 hover:text-rose-600 group-hover:flex"
                onClick={(event) => {
                  event.stopPropagation();
                  if (!suppressClickRef.current) {
                    onClose(tab.id);
                  }
                }}
                onPointerDown={(event) => event.stopPropagation()}
                title={t("terminal.close")}
                aria-label={t("terminal.close")}
              >
                <X className="h-3 w-3" />
              </button>
            </div>
          );
        })}
      </div>
    </aside>
  );
}
