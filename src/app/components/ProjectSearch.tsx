import { Search, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { cn } from "../../lib/utils";
import type { ProjectSearchHit } from "../../shared/types/app";
import { SvgSpinner } from "../../components/ui/svg-spinner";
import {
  buildFloatingSurfaceStyle,
  dropdownItemClassName,
  dropdownSurfaceClassName,
  useDropdownDismiss,
} from "../../components/ui/dropdown";

type TranslationFn = (key: any) => string;

export function ProjectSearch(props: {
  query: string;
  onQueryChange: (value: string) => void;
  searching: boolean;
  searched: boolean;
  results: ProjectSearchHit[];
  onSearch: () => void;
  onSelect: (hit: ProjectSearchHit) => void;
  onClear: () => void;
  disabled?: boolean;
  t: TranslationFn;
}) {
  const {
    query,
    onQueryChange,
    searching,
    searched,
    results,
    onSearch,
    onSelect,
    onClear,
    disabled,
    t,
  } = props;
  const [open, setOpen] = useState(false);
  const [queuedSearch, setQueuedSearch] = useState(false);
  const [panelStyle, setPanelStyle] = useState({});
  const rootRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const normalizedQuery = query.trim();
  const pathHits = useMemo(
    () => results.filter((item) => item.matchKind === "path"),
    [results],
  );
  const contentHits = useMemo(
    () => results.filter((item) => item.matchKind !== "path"),
    [results],
  );
  const showSearching = normalizedQuery.length > 0 && (queuedSearch || searching);

  useDropdownDismiss({
    open,
    rootRef,
    includeRefs: [panelRef],
    onClose: () => setOpen(false),
  });

  const updatePanelPosition = useCallback(() => {
    const trigger = rootRef.current;
    if (!trigger) {
      return;
    }
    const rect = trigger.getBoundingClientRect();
    setPanelStyle(buildFloatingSurfaceStyle(trigger, {
      minWidth: Math.max(rect.width, 320),
      preferredWidth: Math.max(rect.width, 420),
      maxWidth: 620,
      align: "start",
      desiredHeight: 320,
    }));
  }, []);

  useEffect(() => {
    if (disabled) {
      setOpen(false);
      setQueuedSearch(false);
      return;
    }
    if (normalizedQuery.length > 0) {
      setOpen(true);
    }
    if (searched || searching || normalizedQuery.length === 0) {
      setQueuedSearch(false);
    }
  }, [disabled, normalizedQuery, searched, searching]);

  useEffect(() => {
    if (disabled) {
      setQueuedSearch(false);
      return;
    }
    if (!normalizedQuery) {
      onClear();
      setOpen(false);
      setQueuedSearch(false);
      return;
    }
    setQueuedSearch(true);
    const timer = window.setTimeout(() => {
      onSearch();
    }, 220);
    return () => window.clearTimeout(timer);
  }, [disabled, normalizedQuery, onClear, onSearch]);

  useEffect(() => {
    if (!open) {
      return;
    }
    updatePanelPosition();
    const handleReposition = () => updatePanelPosition();
    window.addEventListener("resize", handleReposition);
    window.addEventListener("scroll", handleReposition, true);
    return () => {
      window.removeEventListener("resize", handleReposition);
      window.removeEventListener("scroll", handleReposition, true);
    };
  }, [open, updatePanelPosition]);

  const panel = open && normalizedQuery.length > 0 && (showSearching || searched) ? (
    <div
      ref={panelRef}
      className={dropdownSurfaceClassName("fixed z-[520] max-h-[min(24rem,calc(100vh-3.5rem))] overflow-y-auto overflow-x-hidden")}
      style={panelStyle}
    >
      {showSearching ? (
        <div className="px-2 py-1.5 text-xs text-[color:var(--control-muted)]">{t("topbar.searching")}</div>
      ) : results.length === 0 ? (
        <div className="px-2 py-1.5 text-xs text-[color:var(--control-muted)]">{t("topbar.noSearchResults")}</div>
      ) : (
        <div className="space-y-1 p-1">
          {pathHits.length > 0 ? (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--control-muted)]">
                {t("topbar.searchGroupFiles")}
              </div>
              {pathHits.map((hit, index) => (
                <button
                  key={`path:${hit.relativePath}:${index}`}
                  className={dropdownItemClassName(cn(
                    "mb-1 flex-col items-start px-2.5 py-2 last:mb-0",
                    "text-xs",
                  ))}
                  onClick={() => {
                    setOpen(false);
                    setQueuedSearch(false);
                    onSelect(hit);
                  }}
                >
                  <div className="truncate font-mono text-[11px] text-[color:var(--control-muted)]">
                    {hit.relativePath}
                  </div>
                  <div className="truncate text-[color:var(--control-muted)]">{t("topbar.searchPathMatch")}</div>
                </button>
              ))}
            </>
          ) : null}
          {contentHits.length > 0 ? (
            <>
              <div className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-[color:var(--control-muted)]">
                {t("topbar.searchGroupContent")}
              </div>
              {contentHits.map((hit, index) => (
                <button
                  key={`content:${hit.relativePath}:${hit.lineNumber ?? 0}:${index}`}
                  className={dropdownItemClassName(cn(
                    "mb-1 flex-col items-start px-2.5 py-2 last:mb-0",
                    "text-xs",
                  ))}
                  onClick={() => {
                    setOpen(false);
                    setQueuedSearch(false);
                    onSelect(hit);
                  }}
                >
                  <div className="truncate font-mono text-[11px] text-[color:var(--control-muted)]">
                    {hit.relativePath}{hit.lineNumber ? `:${hit.lineNumber}` : ""}
                  </div>
                  <div className="truncate text-[color:var(--control-muted)]">{hit.snippet}</div>
                </button>
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  ) : null;

  return (
    <div className="relative min-w-0 w-full" ref={rootRef}>
      <div className="app-topbar-field flex h-9 items-center gap-2 px-2.5">
        <Search className="app-topbar-search-icon h-4 w-4 shrink-0" />
        <input
          value={query}
          disabled={disabled}
          placeholder={t("topbar.searchPlaceholder")}
          className="app-topbar-search-input h-full w-full border-none bg-transparent text-sm outline-none"
          onChange={(event) => onQueryChange(event.target.value)}
          onFocus={() => {
            if (normalizedQuery.length > 0 || searched || searching) {
              setOpen(true);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter") {
              setQueuedSearch(true);
              setOpen(true);
              onSearch();
            }
          }}
        />
        {searching ? (
          <SvgSpinner className="h-4 w-4 shrink-0 text-zinc-400" />
        ) : query.trim().length > 0 ? (
          <button
            type="button"
            className="app-topbar-clear-btn inline-flex h-6 w-6 items-center justify-center rounded-md"
            onClick={() => {
              onClear();
              setOpen(false);
              setQueuedSearch(false);
            }}
            aria-label={t("topbar.clearSearch")}
          >
            <X className="h-4 w-4" />
          </button>
        ) : null}
      </div>

      {panel && typeof document !== "undefined" ? createPortal(panel, document.body) : panel}
    </div>
  );
}
