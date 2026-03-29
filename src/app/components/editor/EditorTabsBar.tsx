import { ChevronDown, ChevronLeft, ChevronRight, Circle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../lib/utils";
import type { CloseTabsAction, EditorTab } from "../../../shared/types/app";
import { EditorTabContextMenu } from "./EditorTabContextMenu";

type TranslationFn = (key: any) => string;

type ContextMenuState = {
  x: number;
  y: number;
  tabId: string;
} | null;

type ExtraTabMenuState = {
  tabId: string;
  x: number;
  y: number;
} | null;

type ExtraEditorTab = {
  id: string;
  title: string;
  active: boolean;
  dirty?: boolean;
  tooltip?: string;
  closeLabel?: string;
  onSelect: () => void;
  onClose?: () => void;
  renderMenu?: (close: () => void) => ReactNode;
  menuLabel?: string;
};

const TAB_GAP_PX = 4;
const TAB_ROW_TRAILING_SPACE_PX = 8;
const FILE_TAB_MIN_WIDTH = 120;
const FILE_TAB_MAX_WIDTH = 240;
const EXTRA_TAB_MIN_WIDTH = 136;
const EXTRA_TAB_MAX_WIDTH = 280;
const PREVIEW_BADGE_MIN_WIDTH = 170;

function clampTabWidth(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function EditorTabsBar(props: {
  tabs: EditorTab[];
  activeTabId: string | null;
  dirtyByPath: Record<string, boolean>;
  busy?: boolean;
  extraTabs?: ExtraEditorTab[];
  onSelect: (tabId: string) => void;
  onClose: (tabId: string) => void;
  onCloseAction: (action: CloseTabsAction, tabId: string) => void;
  onPin: (tabId: string) => void;
  t: TranslationFn;
}) {
  const { tabs, activeTabId, dirtyByPath, busy, extraTabs = [], onSelect, onClose, onCloseAction, onPin, t } = props;
  const rootRef = useRef<HTMLDivElement | null>(null);
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [hasOverflow, setHasOverflow] = useState(false);
  const [canScrollLeft, setCanScrollLeft] = useState(false);
  const [canScrollRight, setCanScrollRight] = useState(false);
  const [tabViewportWidth, setTabViewportWidth] = useState(0);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [extraTabMenu, setExtraTabMenu] = useState<ExtraTabMenuState>(null);

  const activeExtraId = useMemo(() => extraTabs.find((item) => item.active)?.id ?? null, [extraTabs]);
  const activeDomTabId = activeTabId ?? activeExtraId;
  const activeExtraTab = useMemo(
    () => (extraTabMenu ? extraTabs.find((item) => item.id === extraTabMenu.tabId) ?? null : null),
    [extraTabMenu, extraTabs],
  );

  const totalTabCount = tabs.length + extraTabs.length;
  const sharedTabWidth = useMemo(() => {
    if (totalTabCount === 0) {
      return FILE_TAB_MAX_WIDTH;
    }
    const gapWidth = Math.max(totalTabCount - 1, 0) * TAB_GAP_PX;
    const availableWidth = Math.max(
      tabViewportWidth - gapWidth - TAB_ROW_TRAILING_SPACE_PX,
      FILE_TAB_MIN_WIDTH,
    );
    return Math.floor(availableWidth / totalTabCount);
  }, [tabViewportWidth, totalTabCount]);
  const fileTabWidth = clampTabWidth(sharedTabWidth, FILE_TAB_MIN_WIDTH, FILE_TAB_MAX_WIDTH);
  const extraTabWidth = clampTabWidth(sharedTabWidth, EXTRA_TAB_MIN_WIDTH, EXTRA_TAB_MAX_WIDTH);
  const showPreviewBadge = fileTabWidth >= PREVIEW_BADGE_MIN_WIDTH;

  useEffect(() => {
    const element = viewportRef.current;
    if (!element) {
      return;
    }
    const refreshOverflow = () => {
      setTabViewportWidth(element.clientWidth);
      const overflow = element.scrollWidth > element.clientWidth + 4;
      setHasOverflow(overflow);
      setCanScrollLeft(element.scrollLeft > 2);
      setCanScrollRight(element.scrollLeft + element.clientWidth < element.scrollWidth - 2);
    };
    refreshOverflow();
    const observer = new ResizeObserver(refreshOverflow);
    observer.observe(element);
    element.addEventListener("scroll", refreshOverflow, { passive: true });
    const raf = window.requestAnimationFrame(refreshOverflow);
    return () => {
      observer.disconnect();
      element.removeEventListener("scroll", refreshOverflow);
      window.cancelAnimationFrame(raf);
    };
  }, [tabs, extraTabs]);

  useEffect(() => {
    if (!activeDomTabId || !rootRef.current) {
      return;
    }
    const target = rootRef.current.querySelector<HTMLElement>(`[data-tab-id="${activeDomTabId}"]`);
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "nearest" });
  }, [activeDomTabId, tabs, extraTabs, fileTabWidth, extraTabWidth]);

  useEffect(() => {
    const closeAll = (event: MouseEvent) => {
      const target = event.target as Node | null;
      if (target && rootRef.current?.contains(target)) {
        return;
      }
      setOverflowOpen(false);
      setMenu(null);
      setExtraTabMenu(null);
    };
    const closeOnBlur = () => {
      setOverflowOpen(false);
      setMenu(null);
      setExtraTabMenu(null);
    };
    window.addEventListener("blur", closeOnBlur);
    window.addEventListener("mousedown", closeAll);
    return () => {
      window.removeEventListener("blur", closeOnBlur);
      window.removeEventListener("mousedown", closeAll);
    };
  }, []);

  const overflowItems = useMemo(() => {
    const fileItems = [...tabs]
      .sort((a, b) => b.lastAccessed - a.lastAccessed)
      .map((tab) => ({
        id: tab.id,
        title: tab.title,
        active: tab.id === activeTabId,
        dirty: Boolean(dirtyByPath[tab.path]),
        onClick: () => onSelect(tab.id),
      }));
    const extItems = extraTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      active: tab.active,
      dirty: Boolean(tab.dirty),
      onClick: tab.onSelect,
    }));
    return [...extItems, ...fileItems];
  }, [activeTabId, dirtyByPath, extraTabs, onSelect, tabs]);

  return (
    <div ref={rootRef} className="editor-tabs-shell relative flex h-full items-center gap-1 px-1.5">
      <div ref={viewportRef} className="min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
        <div className="flex w-max min-w-full items-center gap-1 pr-2">
          {tabs.map((tab) => {
            const active = tab.id === activeTabId;
            const dirty = Boolean(dirtyByPath[tab.path]);
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={cn(
                  "editor-tab group inline-flex h-7 shrink-0 items-center gap-1 rounded-[11px] px-2 text-xs transition",
                  active
                    ? "editor-tab--active"
                    : "editor-tab--inactive",
                )}
                style={{ width: `${fileTabWidth}px`, maxWidth: `${fileTabWidth}px`, flexBasis: `${fileTabWidth}px` }}
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
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                {dirty && (
                  <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" />
                )}
                {tab.preview && !tab.pinned && showPreviewBadge ? (
                  <span className="editor-tab-preview-badge shrink-0 rounded-full px-1.5 text-[10px]">
                    {t("editor.tab.preview")}
                  </span>
                ) : null}
                <button
                  className="editor-tab-action shrink-0 rounded p-0.5"
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

          {extraTabs.map((tab) => (
            <div
              key={tab.id}
              data-tab-id={tab.id}
              className={cn(
                "editor-tab group inline-flex h-7 shrink-0 items-center gap-1 rounded-[11px] px-2 text-xs transition",
                tab.active
                  ? "editor-tab--active"
                  : "editor-tab--inactive",
              )}
              style={{ width: `${extraTabWidth}px`, maxWidth: `${extraTabWidth}px`, flexBasis: `${extraTabWidth}px` }}
              onClick={(event) => {
                event.stopPropagation();
                tab.onSelect();
              }}
              title={tab.tooltip ?? tab.title}
            >
              <span className="min-w-0 flex-1 truncate">{tab.title}</span>
              {tab.dirty && <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" />}
              {tab.renderMenu ? (
                <button
                  className="editor-tab-action shrink-0 rounded p-0.5"
                  onClick={(event) => {
                    event.stopPropagation();
                    const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                    setExtraTabMenu((prev) =>
                      prev && prev.tabId === tab.id
                        ? null
                        : { tabId: tab.id, x: rect.left, y: rect.bottom + 4 },
                    );
                  }}
                  disabled={busy}
                  title={tab.menuLabel ?? t("editor.tab.more")}
                  aria-label={tab.menuLabel ?? t("editor.tab.more")}
                >
                  <ChevronDown className="h-3 w-3" />
                </button>
              ) : null}
              {tab.onClose ? (
                <button
                  className="editor-tab-action shrink-0 rounded p-0.5"
                  onClick={(event) => {
                    event.stopPropagation();
                    tab.onClose?.();
                  }}
                  disabled={busy}
                  title={tab.closeLabel ?? t("editor.tab.close")}
                  aria-label={tab.closeLabel ?? t("editor.tab.close")}
                >
                  <X className="h-3 w-3" />
                </button>
              ) : null}
            </div>
          ))}
        </div>
      </div>

      {hasOverflow && (
        <div className="flex shrink-0 items-center gap-1">
          <button
            className="editor-tabs-scroll-btn rounded-full p-1 disabled:opacity-40"
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
            className="editor-tabs-scroll-btn rounded-full p-1 disabled:opacity-40"
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
              className="editor-tabs-scroll-btn rounded-full p-1"
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
              <div className="editor-tabs-overflow-menu absolute right-0 top-8 z-[65] max-h-64 min-w-56 overflow-auto py-1">
                {overflowItems.map((item) => (
                  <button
                    key={item.id}
                    className={cn(
                      "editor-tabs-overflow-item flex w-full items-center justify-between gap-2 px-3 py-1.5 text-left text-xs",
                      item.active
                        ? "editor-tabs-overflow-item--active"
                        : "editor-tabs-overflow-item--inactive",
                    )}
                    onClick={() => {
                      setOverflowOpen(false);
                      item.onClick();
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                    {item.dirty && (
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

      {extraTabMenu && activeExtraTab?.renderMenu ? (
        <div
          className="editor-tabs-floating-menu fixed z-[72] min-w-56 max-w-[320px] overflow-hidden py-1"
          style={{ left: extraTabMenu.x, top: extraTabMenu.y }}
          onMouseDown={(event) => event.stopPropagation()}
        >
          {activeExtraTab.renderMenu(() => setExtraTabMenu(null))}
        </div>
      ) : null}
    </div>
  );
}

