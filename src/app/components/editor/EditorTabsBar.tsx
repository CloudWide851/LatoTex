import { ChevronDown, ChevronLeft, ChevronRight, Circle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import { cn } from "../../../lib/utils";
import type { CloseTabsAction, EditorTab } from "../../../shared/types/app";
import { EditorTabContextMenu } from "./EditorTabContextMenu";

type TranslationFn = (key: any) => string;

type ContextMenuState = {
  x: number;
  y: number;
  tabId: string;
} | null;

export function EditorTabsBar(props: {
  tabs: EditorTab[];
  activeTabId: string | null;
  dirtyByPath: Record<string, boolean>;
  busy?: boolean;
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseAction: (action: CloseTabsAction, tabId: string) => void;
  onPin: (tabId: string) => void;
  t: TranslationFn;
}) {
  const { tabs, activeTabId, dirtyByPath, busy, onSelect, onClose, onCloseAction, onPin, t } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [menu, setMenu] = useState<ContextMenuState>(null);

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const refreshOverflow = () => {
      const overflow = element.scrollWidth > element.clientWidth + 4;
      setHasOverflow(overflow);
      setCanScrollLeft(element.scrollLeft > 2);
      setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
    };
    refreshOverflow();
    const observer = new ResizeObserver(refreshOverflow);
    observer.observe(element);
    element.addEventListener("scroll", refreshOverflow, { passive: true });
    let raf = window.requestAnimationFrame(refreshOverflow);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", refreshOverflow);
      window.cancelAnimationFrame(raf);
    };
  }, [tabs]);

  useEffect(() => {
    if (!activeTabId || !rootRef.current) {
      return;
    }
    const target = rootRef.current.querySelector<HTMLElement>(`[data-tab-id="${activeTabId}"]`);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeTabId, tabs]);

  useEffect(() => {
    const closeAll = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) {
        return;
      }
      setOverflowOpen(false);
      setMenu(null);
    };
    const closeOnBlur = () => {
      setOverflowOpen(false);
      setMenu(null);
    };
    window.addEventListener("blur", closeOnBlur);
    window.addEventListener("mousedown", closeAll);
    return () => {
      window.removeEventListener("blur", closeOnBlur);
      window.removeEventListener("mousedown", closeAll);
    };
  }, []);

  const sortedOverflowTabs = useMemo(
    () => [...tabs].sort((a, b) => b.lastAccessed - a.lastAccessed),
    [tabs],
  );

  return (
    <div ref={rootRef} className="relative flex h-full items-center gap-1 border-b border-slate-200 bg-slate-50/80 px-1.5">
      <div ref={viewportRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex min-w-max items-center gap-1 pr-2">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const dirty = Boolean(dirtyByPath[tab.path]);
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={cn(
                  "group inline-flex h-7 max-w-[240px] items-center gap-1 rounded-md border px-2 text-xs transition",
                  active
                    ? "border-primary-500 bg-primary-50 text-primary-900"
                    : "border-slate-200 bg-white text-slate-700 hover:bg-slate-100",
                )}
                onClick={(event) => {
                  event.stopPropagation();
                  onSelect(tab.id);
                }}
                onDoubleClick={(event) => {
                  event.stopPropagation();
                  onPin(tab.id);
                }}
                onContextMenu={(event) => {
                  event.preventDefault();
                  event.stopPropagation();
                  setMenu({ x: event.clientX, y: event.clientY, tabId: tab.id });
                }}
                title={tab.path}
              >
                <span className="truncate">{tab.title}</span>
                {dirty && (
                  <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" />
                )}
                {tab.preview && !tab.pinned && (
                  <span className="rounded border border-slate-300 px-1 text-[10px] text-slate-500">
                    {t("editor.tab.preview")}
                  </span>
                )}
                <button
                  className="rounded p-0.5 text-slate-500 hover:bg-slate-200 hover:text-slate-800"
                  onClick={(event) => {
                    event.stopPropagation();
                    onClose(tab.id);
                  }}
                  disabled={busy}
                  title={t("editor.tab.close")}
                  aria-label={t("editor.tab.close")}
                >
                  <X className="h-3 w-3" />
                </button>
              </div>
            );
          })}
        </div>
      </div>

      {hasOverflow && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={() => {
              const node = viewportRef.current;
              if (!node) {
                return;
              }
              node.scrollBy({ left: -Math.max(120, Math.floor(node.clientWidth * 0.6)), behavior: "smooth" });
            }}
            disabled={!canScrollLeft}
            title={t("editor.tab.scrollLeft")}
            aria-label={t("editor.tab.scrollLeft")}
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100 disabled:opacity-40"
            onClick={() => {
              const node = viewportRef.current;
              if (!node) {
                return;
              }
              node.scrollBy({ left: Math.max(120, Math.floor(node.clientWidth * 0.6)), behavior: "smooth" });
            }}
            disabled={!canScrollRight}
            title={t("editor.tab.scrollRight")}
            aria-label={t("editor.tab.scrollRight")}
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
          <div className="relative shrink-0">
            <button
              className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
              onClick={(event) => {
                event.stopPropagation();
                setOverflowOpen((prev) => !prev);
              }}
              title={t("editor.tab.more")}
              aria-label={t("editor.tab.more")}
            >
              <ChevronDown className="h-3.5 w-3.5" />
            </button>
            {overflowOpen && (
              <div className="absolute right-0 top-8 z-[65] max-h-64 min-w-56 overflow-auto rounded-md border border-slate-300 bg-white py-1 shadow-lg">
                {sortedOverflowTabs.map((tab) => (
                  <button
                    key={tab.id}
                    className={cn(
                      "flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs",
                      tab.id === activeTabId
                        ? "bg-primary-50 text-primary-900"
                        : "text-slate-700 hover:bg-slate-100",
                    )}
                    onClick={() => {
                      setOverflowOpen(false);
                      onSelect(tab.id);
                    }}
                  >
                    <span className="truncate">{tab.title}</span>
                    {dirtyByPath[tab.path] && (
                      <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {menu && (
        <EditorTabContextMenu
          x={menu.x}
          y={menu.y}
          tabId={menu.tabId}
          onAction={onCloseAction}
          onClose={() => setMenu(null)}
          t={t}
        />
      )}
    </div>
  );
}
