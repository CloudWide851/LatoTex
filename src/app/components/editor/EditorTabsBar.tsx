import { ChevronDown, Circle, X } from "lucide-react";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { cn } from "../../../lib/utils";
import { runtimeLogWrite } from "../../../shared/api/runtime";
import type { CloseTabsAction, EditorTab } from "../../../shared/types/app";
import { EditorTabContextMenu } from "./EditorTabContextMenu";
import { runTabButtonAction, swallowTabButtonEvent } from "./editorTabButtonAction";
import { editorTabOverflowConstants, resolveEditorTabOverflow } from "./editorTabOverflow";
import { resolveExtraTabWidth, resolveFileTabLayout } from "./editorTabSizing";

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

type OverflowItem = {
  id: string;
  title: string;
  active: boolean;
  dirty: boolean;
  onClick: () => void;
  onClose?: () => void;
  closeLabel?: string;
};

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
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [availableWidth, setAvailableWidth] = useState(0);
  const [menu, setMenu] = useState<ContextMenuState>(null);
  const [extraTabMenu, setExtraTabMenu] = useState<ExtraTabMenuState>(null);

  const activeExtraId = useMemo(() => extraTabs.find((item) => item.active)?.id ?? null, [extraTabs]);
  const activeDomTabId = activeTabId ?? activeExtraId;
  const activeExtraTab = useMemo(
    () => (extraTabMenu ? extraTabs.find((item) => item.id === extraTabMenu.tabId) ?? null : null),
    [extraTabMenu, extraTabs],
  );
  const fileTabLayouts = useMemo(
    () => Object.fromEntries(tabs.map((tab) => [tab.id, resolveFileTabLayout(tab, Boolean(dirtyByPath[tab.path]))])),
    [dirtyByPath, tabs],
  );
  const extraTabWidths = useMemo(
    () => Object.fromEntries(extraTabs.map((tab) => [tab.id, resolveExtraTabWidth(tab.title, {
      dirty: Boolean(tab.dirty),
      hasMenu: Boolean(tab.renderMenu),
      hasClose: Boolean(tab.onClose),
    })])),
    [extraTabs],
  );
  const sizedItems = useMemo(
    () => [
      ...tabs.map((tab) => ({ id: tab.id, width: fileTabLayouts[tab.id]?.width ?? resolveFileTabLayout(tab, Boolean(dirtyByPath[tab.path])).width })),
      ...extraTabs.map((tab) => ({
        id: tab.id,
        width: extraTabWidths[tab.id] ?? resolveExtraTabWidth(tab.title, {
          dirty: Boolean(tab.dirty),
          hasMenu: Boolean(tab.renderMenu),
          hasClose: Boolean(tab.onClose),
        }),
      })),
    ],
    [dirtyByPath, extraTabWidths, extraTabs, fileTabLayouts, tabs],
  );
  const overflowLayout = useMemo(
    () => {
      try {
        return resolveEditorTabOverflow(
          sizedItems,
          activeDomTabId,
          availableWidth,
          {
            gap: editorTabOverflowConstants.DEFAULT_TAB_GAP,
            overflowButtonWidth: editorTabOverflowConstants.DEFAULT_OVERFLOW_BUTTON_WIDTH,
          },
        );
      } catch (error) {
        void runtimeLogWrite(
          "ERROR",
          `editor_tabs_overflow.error: tabs=${tabs.length}, extraTabs=${extraTabs.length}, width=${availableWidth}, active=${activeDomTabId ?? "-"}, reason=${String(error)}`,
        ).catch(() => undefined);
        const visibleId = activeDomTabId && sizedItems.some((item) => item.id === activeDomTabId)
          ? activeDomTabId
          : sizedItems[0]?.id ?? "";
        return {
          visibleIds: visibleId ? [visibleId] : [],
          hiddenIds: sizedItems.map((item) => item.id).filter((id) => id !== visibleId),
          hasOverflow: sizedItems.length > 1,
        };
      }
    },
    [activeDomTabId, availableWidth, extraTabs.length, sizedItems, tabs.length],
  );
  const hiddenTabIds = overflowLayout.hiddenIds;
  const hiddenTabIdSet = useMemo(() => new Set(hiddenTabIds), [hiddenTabIds]);
  const visibleTabs = useMemo(
    () => tabs.filter((tab) => !hiddenTabIdSet.has(tab.id)),
    [hiddenTabIdSet, tabs],
  );
  const visibleExtraTabs = useMemo(
    () => extraTabs.filter((tab) => !hiddenTabIdSet.has(tab.id)),
    [extraTabs, hiddenTabIdSet],
  );
  const overflowItems = useMemo<OverflowItem[]>(() => {
    const fileItems = tabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      active: tab.id === activeTabId,
      dirty: Boolean(dirtyByPath[tab.path]),
      onClick: () => onSelect(tab.id),
      onClose: () => onClose(tab.id),
      closeLabel: t("editor.tab.close"),
    }));
    const extItems = extraTabs.map((tab) => ({
      id: tab.id,
      title: tab.title,
      active: tab.active,
      dirty: Boolean(tab.dirty),
      onClick: tab.onSelect,
      onClose: tab.onClose,
      closeLabel: tab.closeLabel ?? t("editor.tab.close"),
    }));
    return [...fileItems, ...extItems].filter((item) => hiddenTabIdSet.has(item.id));
  }, [activeTabId, dirtyByPath, extraTabs, hiddenTabIdSet, onClose, onSelect, t, tabs]);

  useEffect(() => {
    const element = rootRef.current;
    if (!element) {
      return;
    }
    const refreshWidth = () => {
      setAvailableWidth(element.clientWidth);
    };
    refreshWidth();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      window.requestAnimationFrame(refreshWidth);
    });
    observer.observe(element);
    const raf = window.requestAnimationFrame(refreshWidth);
    return () => {
      observer.disconnect();
      window.cancelAnimationFrame(raf);
    };
  }, []);

  useEffect(() => {
    if (!overflowLayout.hasOverflow) {
      setOverflowOpen(false);
    }
  }, [overflowLayout.hasOverflow]);

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

  return (
    <div ref={rootRef} className="editor-tabs-shell relative flex h-full items-center gap-0 px-1">
      <div className="min-w-0 flex-1 overflow-hidden">
        <div className="flex min-w-0 items-center gap-1 pr-0.5">
          {visibleTabs.map((tab) => {
            const active = tab.id === activeTabId;
            const dirty = Boolean(dirtyByPath[tab.path]);
            const layout = fileTabLayouts[tab.id] ?? resolveFileTabLayout(tab, dirty);
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={cn(
                  "editor-tab group inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[11px] px-1.5 text-xs transition",
                  active
                    ? "editor-tab--active"
                    : "editor-tab--inactive",
                )}
                style={{ width: `${layout.width}px`, maxWidth: `${layout.width}px`, flexBasis: `${layout.width}px` }}
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
                {dirty ? (
                  <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" />
                ) : null}
                {layout.showPreviewBadge ? (
                  <span className="editor-tab-preview-badge shrink-0 rounded-full px-1.5 text-[10px]">
                    {t("editor.tab.preview")}
                  </span>
                ) : null}
                <button
                  className="editor-tab-action shrink-0 rounded p-0.5"
                  onMouseDown={swallowTabButtonEvent}
                  onClick={(event) => {
                    runTabButtonAction(event, () => onClose(tab.id));
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

          {visibleExtraTabs.map((tab) => {
            const tabWidth = extraTabWidths[tab.id] ?? resolveExtraTabWidth(tab.title, {
              dirty: Boolean(tab.dirty),
              hasMenu: Boolean(tab.renderMenu),
              hasClose: Boolean(tab.onClose),
            });
            return (
              <div
                key={tab.id}
                data-tab-id={tab.id}
                className={cn(
                  "editor-tab group inline-flex h-7 shrink-0 items-center gap-0.5 rounded-[11px] px-1.5 text-xs transition",
                  tab.active
                    ? "editor-tab--active"
                    : "editor-tab--inactive",
                )}
                style={{ width: `${tabWidth}px`, maxWidth: `${tabWidth}px`, flexBasis: `${tabWidth}px` }}
                onClick={(event) => {
                  event.stopPropagation();
                  tab.onSelect();
                }}
                title={tab.tooltip ?? tab.title}
              >
                <span className="min-w-0 flex-1 truncate">{tab.title}</span>
                {tab.dirty ? <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" /> : null}
                {tab.renderMenu ? (
                  <button
                    className="editor-tab-action shrink-0 rounded p-0.5"
                    onMouseDown={swallowTabButtonEvent}
                    onClick={(event) => {
                      runTabButtonAction(event, () => {
                        const rect = (event.currentTarget as HTMLButtonElement).getBoundingClientRect();
                        setExtraTabMenu((prev) =>
                          prev && prev.tabId === tab.id
                            ? null
                            : { tabId: tab.id, x: rect.left, y: rect.bottom + 4 },
                        );
                      });
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
                    onMouseDown={swallowTabButtonEvent}
                    onClick={(event) => {
                      runTabButtonAction(event, () => {
                        tab.onClose?.();
                      });
                    }}
                    disabled={busy}
                    title={tab.closeLabel ?? t("editor.tab.close")}
                    aria-label={tab.closeLabel ?? t("editor.tab.close")}
                  >
                    <X className="h-3 w-3" />
                  </button>
                ) : null}
              </div>
            );
          })}
        </div>
      </div>

      {overflowLayout.hasOverflow ? (
        <div className="editor-tabs-overflow-wrap relative ml-1 shrink-0 self-stretch">
          <span className="editor-tabs-overflow-fade" aria-hidden="true" />
          <button
            className="editor-tabs-scroll-btn editor-tabs-overflow-trigger"
            onMouseDown={swallowTabButtonEvent}
            onClick={(event) => {
              runTabButtonAction(event, () => {
                setOverflowOpen((prev) => !prev);
              });
            }}
            title={`${t("editor.tab.more")} (${overflowItems.length})`}
            aria-label={t("editor.tab.more")}
          >
            <ChevronDown className="h-3.5 w-3.5" />
          </button>
          {overflowOpen ? (
            <div className="editor-tabs-overflow-menu absolute right-0 top-8 z-[65] max-h-64 min-w-56 overflow-auto py-1">
              {overflowItems.map((item) => (
                <div
                  key={item.id}
                  className={cn(
                    "editor-tabs-overflow-item flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs",
                    item.active
                      ? "editor-tabs-overflow-item--active"
                      : "editor-tabs-overflow-item--inactive",
                  )}
                >
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => {
                      setOverflowOpen(false);
                      item.onClick();
                    }}
                  >
                    <span className="truncate">{item.title}</span>
                  </button>
                  {item.dirty ? (
                    <Circle className="h-2 w-2 shrink-0 fill-current text-slate-400" />
                  ) : null}
                  {item.onClose ? (
                    <button
                      className="editor-tab-action shrink-0 rounded p-0.5"
                      onMouseDown={swallowTabButtonEvent}
                      onClick={(event) => {
                        runTabButtonAction(event, () => {
                          setOverflowOpen(false);
                          item.onClose?.();
                        });
                      }}
                      disabled={busy}
                      title={item.closeLabel ?? t("editor.tab.close")}
                      aria-label={item.closeLabel ?? t("editor.tab.close")}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      ) : null}

      {menu ? (
        <EditorTabContextMenu
          x={menu.x}
          y={menu.y}
          tabId={menu.tabId}
          onAction={onCloseAction}
          onClose={() => setMenu(null)}
          t={t}
        />
      ) : null}

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




