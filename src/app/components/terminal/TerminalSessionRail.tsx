import { GripVertical, Plus, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  MAX_TERMINAL_RAIL_WIDTH,
  MIN_TERMINAL_RAIL_WIDTH,
  clampTerminalRailWidth,
} from "./terminalPersistence";
import { TerminalSessionContextMenu } from "./TerminalSessionContextMenu";
import type { TerminalTab, TranslationFn } from "./terminalTypes";
import { cspStyle } from "../../../shared/ui/cspStyle";

type ContextMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

function terminalStatusClass(tab: TerminalTab) {
  if (tab.failure || tab.status === "failed") {
    return "bg-rose-500";
  }
  if (tab.status === "running") {
    return "bg-emerald-500";
  }
  if (tab.status === "starting" || tab.status === "activating") {
    return "bg-amber-500";
  }
  return "bg-slate-400";
}

export function TerminalSessionRail(props: {
  tabs: TerminalTab[];
  activeTabId: string | null;
  onSelect: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onNew: () => void;
  onRename: (id: string, title: string) => void;
  onRestart: (id: string) => void;
  onReorder: (sourceId: string, targetId: string) => void;
  width: number;
  onWidthChange: (width: number) => void;
  t: TranslationFn;
}) {
  const {
    tabs,
    activeTabId,
    onSelect,
    onClose,
    onCloseOthers,
    onNew,
    onRename,
    onRestart,
    onReorder,
    width,
    onWidthChange,
    t,
  } = props;
  const dragRef = useRef<{
    id: string;
    pointerId: number;
    startX: number;
    startY: number;
    active: boolean;
    lastTargetId: string;
  } | null>(null);
  const resizeRef = useRef<{
    pointerId: number;
    startX: number;
    startWidth: number;
  } | null>(null);
  const suppressClickRef = useRef(false);
  const renamingRef = useRef<string | null>(null);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");

  const startRename = (tab: TerminalTab) => {
    renamingRef.current = tab.id;
    setRenamingId(tab.id);
    setRenameDraft(tab.title);
  };
  const finishRename = (commit: boolean) => {
    const tabId = renamingRef.current;
    renamingRef.current = null;
    setRenamingId(null);
    if (commit && tabId && renameDraft.trim()) {
      onRename(tabId, renameDraft);
    }
    setRenameDraft("");
  };

  useEffect(() => {
    const handleMove = (event: PointerEvent) => {
      const resize = resizeRef.current;
      if (resize && event.pointerId === resize.pointerId) {
        onWidthChange(clampTerminalRailWidth(resize.startWidth + event.clientX - resize.startX));
        event.preventDefault();
        return;
      }
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
      const resize = resizeRef.current;
      if (resize && event.pointerId === resize.pointerId) {
        resizeRef.current = null;
        return;
      }
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
  }, [onReorder, onWidthChange]);

  return (
    <aside
      className="relative flex shrink-0 flex-col border-r border-[color:var(--editor-shell-divider)] bg-[color:var(--editor-widget-bg)]"
      {...cspStyle({ width: clampTerminalRailWidth(width) })}
    >
      <div className="flex h-10 shrink-0 items-center justify-between border-b border-[color:var(--editor-shell-divider)] px-2">
        <span className="truncate text-[11px] font-semibold text-[color:var(--editor-tab-muted)]">
          {t("terminal.title")}
        </span>
        <button
          type="button"
          className="panel-topbar-btn editor-toolbar-btn h-7 w-7"
          onClick={onNew}
          title={t("terminal.new")}
          aria-label={t("terminal.new")}
        >
          <Plus className="h-4 w-4" />
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
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                dragRef.current = null;
                setDraggingId(null);
                onSelect(tab.id);
                setMenu({ tabId: tab.id, x: event.clientX, y: event.clientY });
              }}
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
              {renamingId === tab.id ? (
                <div className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1">
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${terminalStatusClass(tab)}`}
                    title={t(`terminal.status.${tab.status}`)}
                  />
                  <input
                    autoFocus
                    value={renameDraft}
                    aria-label={t("terminal.rename")}
                    placeholder={t("terminal.renamePlaceholder")}
                    className="h-6 min-w-0 flex-1 rounded border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-widget-bg)] px-1.5 text-[11px] outline-none focus:border-[color:var(--app-accent)]"
                    onChange={(event) => setRenameDraft(event.target.value)}
                    onBlur={() => {
                      if (renamingRef.current === tab.id) {
                        finishRename(true);
                      }
                    }}
                    onPointerDown={(event) => event.stopPropagation()}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        event.preventDefault();
                        finishRename(true);
                      } else if (event.key === "Escape") {
                        event.preventDefault();
                        finishRename(false);
                      }
                    }}
                  />
                </div>
              ) : (
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-1 px-1.5 py-1 text-left"
                  onClick={() => {
                    if (!suppressClickRef.current) {
                      onSelect(tab.id);
                    }
                  }}
                >
                  <span
                    className={`h-1.5 w-1.5 shrink-0 rounded-full ${terminalStatusClass(tab)}`}
                    title={t(`terminal.status.${tab.status}`)}
                  />
                  <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                </button>
              )}
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
      <button
        type="button"
        role="separator"
        aria-orientation="vertical"
        className="group absolute inset-y-0 right-[-4px] z-10 flex w-2 cursor-col-resize items-center justify-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)]"
        aria-label={t("terminal.resizeSessions")}
        title={t("terminal.resizeSessions")}
        aria-valuemin={MIN_TERMINAL_RAIL_WIDTH}
        aria-valuemax={MAX_TERMINAL_RAIL_WIDTH}
        aria-valuenow={clampTerminalRailWidth(width)}
        onPointerDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          resizeRef.current = {
            pointerId: event.pointerId,
            startX: event.clientX,
            startWidth: clampTerminalRailWidth(width),
          };
          event.currentTarget.setPointerCapture?.(event.pointerId);
          event.preventDefault();
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowLeft") {
            onWidthChange(clampTerminalRailWidth(width - 8));
          } else if (event.key === "ArrowRight") {
            onWidthChange(clampTerminalRailWidth(width + 8));
          } else if (event.key === "Home") {
            onWidthChange(MIN_TERMINAL_RAIL_WIDTH);
          } else if (event.key === "End") {
            onWidthChange(MAX_TERMINAL_RAIL_WIDTH);
          } else {
            return;
          }
          event.preventDefault();
        }}
      >
        <GripVertical className="h-4 w-4 text-[color:var(--editor-tab-muted)] opacity-0 transition-opacity group-hover:opacity-80 group-focus-visible:opacity-80" />
      </button>
      {menu ? (
        <TerminalSessionContextMenu
          x={menu.x}
          y={menu.y}
          canCloseOthers={tabs.length > 1}
          onRename={() => {
            const tab = tabs.find((item) => item.id === menu.tabId);
            if (tab) startRename(tab);
          }}
          onRestart={() => onRestart(menu.tabId)}
          onCloseSession={() => onClose(menu.tabId)}
          onCloseOthers={() => onCloseOthers(menu.tabId)}
          onClose={() => setMenu(null)}
          t={t}
        />
      ) : null}
    </aside>
  );
}
