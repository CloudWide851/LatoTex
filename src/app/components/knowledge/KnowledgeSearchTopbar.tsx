import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import {
  BookOpen,
  FileText,
  RefreshCw,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import type { KnowledgeSearchHit } from "../../../shared/types/app";
import { cspStyle } from "../../../shared/ui/cspStyle";
import { cn } from "../../../lib/utils";
import { InfoHint } from "../../../components/ui/info-hint";
import { LibraryUploadMenu } from "../LibraryUploadMenu";
import { formatKnowledgeAnchor } from "./knowledgeDocumentFocus";
import { HighlightedText } from "./knowledgeWorkbenchUtils";

type TranslationFn = (key: any) => string;
export type KnowledgeSourceFilter = "all" | "papers" | "documents";
export type KnowledgeStatusFilter = "all" | "ready" | "pending" | "stale" | "failed";
export type KnowledgeSearchScope = "current" | "all";

type SurfacePosition = { left: number; top: number; width: number; maxHeight: number };

function positionBelow(element: HTMLElement | null, minimumWidth: number): SurfacePosition {
  if (!element || typeof window === "undefined") {
    return { left: 12, top: 48, width: minimumWidth, maxHeight: 320 };
  }
  const rect = element.getBoundingClientRect();
  const width = Math.max(240, Math.min(Math.max(rect.width, minimumWidth), window.innerWidth - 24));
  return {
    left: Math.min(Math.max(12, rect.left), Math.max(12, window.innerWidth - width - 12)),
    top: Math.min(rect.bottom + 6, Math.max(12, window.innerHeight - 120)),
    width,
    maxHeight: Math.max(96, window.innerHeight - rect.bottom - 18),
  };
}

export function KnowledgeSearchTopbar(props: {
  query: string;
  hits: KnowledgeSearchHit[];
  searching: boolean;
  errorMessage: string | null;
  deep: boolean;
  scope: KnowledgeSearchScope;
  scopeLoading: boolean;
  sourceFilter: KnowledgeSourceFilter;
  statusFilter: KnowledgeStatusFilter;
  busy: boolean;
  advancedContent?: ReactNode;
  onQueryChange: (query: string) => void;
  onDeepChange: (deep: boolean) => void;
  onScopeChange: (scope: KnowledgeSearchScope) => void;
  onSourceFilterChange: (filter: KnowledgeSourceFilter) => void;
  onStatusFilterChange: (filter: KnowledgeStatusFilter) => void;
  onSelectHit: (hit: KnowledgeSearchHit) => void;
  onClearSelection: () => void;
  onRefresh: () => void;
  onImportPdf: () => void;
  onImportLink: (input: { link: string; scope?: "users" | "groups"; ownerId?: string; apiKey?: string }) => void;
  onSyncZotero: (input: { ownerId: string; apiKey: string; scope?: "users" | "groups" }) => void;
  t: TranslationFn;
}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const resultsRef = useRef<HTMLDivElement | null>(null);
  const filtersButtonRef = useRef<HTMLButtonElement | null>(null);
  const filtersRef = useRef<HTMLDivElement | null>(null);
  const listboxId = useId();
  const filtersId = useId();
  const [resultsOpen, setResultsOpen] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(0);
  const [resultsPosition, setResultsPosition] = useState<SurfacePosition>(() => positionBelow(null, 520));
  const [filtersPosition, setFiltersPosition] = useState<SurfacePosition>(() => positionBelow(null, 320));
  const queryActive = Boolean(props.query.trim());

  const updatePositions = () => {
    setResultsPosition(positionBelow(inputRef.current, 520));
    setFiltersPosition(positionBelow(filtersButtonRef.current, 320));
  };

  useLayoutEffect(() => {
    if (resultsOpen || filtersOpen) {
      updatePositions();
    }
  }, [filtersOpen, props.hits.length, resultsOpen]);

  useEffect(() => {
    if (!resultsOpen && !filtersOpen) {
      return;
    }
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (
        !inputRef.current?.contains(target)
        && !resultsRef.current?.contains(target)
        && !filtersButtonRef.current?.contains(target)
        && !filtersRef.current?.contains(target)
      ) {
        setResultsOpen(false);
        setFiltersOpen(false);
      }
    };
    const close = () => {
      setResultsOpen(false);
      setFiltersOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") close();
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("scroll", updatePositions, true);
    window.addEventListener("resize", updatePositions);
    window.addEventListener("blur", close);
    window.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("scroll", updatePositions, true);
      window.removeEventListener("resize", updatePositions);
      window.removeEventListener("blur", close);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [filtersOpen, resultsOpen]);

  useEffect(() => {
    setActiveIndex(0);
    setResultsOpen(queryActive);
  }, [props.query, queryActive]);

  const activeId = props.hits[activeIndex]
    ? `${listboxId}-option-${activeIndex}`
    : undefined;
  const resultBody = useMemo(() => {
    if (props.searching && props.hits.length === 0) {
      return <div className="px-3 py-2 text-xs text-[color:var(--app-muted)]">{props.t("common.loading")}</div>;
    }
    if (props.hits.length === 0) {
      return <div className="px-3 py-2 text-xs text-[color:var(--app-muted)]">{props.t("knowledge.noResults")}</div>;
    }
    return props.hits.map((hit, index) => (
      <button
        id={`${listboxId}-option-${index}`}
        key={hit.evidenceId}
        type="button"
        role="option"
        aria-selected={activeIndex === index}
        className={cn(
          "grid w-full gap-0.5 border-b border-[color:var(--editor-widget-border)] px-3 py-2 text-left last:border-b-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--app-accent)]",
          activeIndex === index && "bg-[color:var(--editor-selection-bg)]",
        )}
        onPointerMove={() => setActiveIndex(index)}
        onClick={() => {
          props.onSelectHit(hit);
          setResultsOpen(false);
        }}
      >
        <span className="flex min-w-0 items-center gap-1.5 text-xs font-medium">
          {hit.sourceKind === "pdf" ? <BookOpen className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
          <span className="truncate"><HighlightedText text={hit.title} query={props.query} /></span>
        </span>
        <span className="flex min-w-0 gap-2 text-[10px] text-[color:var(--app-muted)]">
          <span className="min-w-0 flex-1 truncate">{hit.relativePath}</span>
          <span className="shrink-0">{formatKnowledgeAnchor(hit.anchor)}</span>
        </span>
        <span className="truncate text-[11px] text-[color:var(--app-muted)]">
          <HighlightedText text={hit.snippet.replace(/\s+/g, " ")} query={props.query} />
        </span>
      </button>
    ));
  }, [activeIndex, listboxId, props]);

  const resultsPortal = resultsOpen && queryActive && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={resultsRef}
          id={listboxId}
          role="listbox"
          aria-label={props.t("knowledge.searchResults")}
          className="app-material-floating fixed z-[430] overflow-auto rounded-md border border-[color:var(--editor-widget-border)] shadow-lg"
          {...cspStyle({ position: "fixed", ...resultsPosition })}
        >
          {resultBody}
        </div>,
        document.body,
      )
    : null;

  const filtersPortal = filtersOpen && typeof document !== "undefined"
    ? createPortal(
        <div
          ref={filtersRef}
          id={filtersId}
          role="dialog"
          aria-label={props.t("knowledge.advancedFilters")}
          className="app-material-floating fixed z-[430] grid gap-3 rounded-md border border-[color:var(--editor-widget-border)] p-3 shadow-lg"
          {...cspStyle({ position: "fixed", ...filtersPosition })}
        >
          <label className="flex items-center gap-2 text-xs">
            <input type="checkbox" checked={props.deep} onChange={(event) => props.onDeepChange(event.target.checked)} />
            {props.t("knowledge.deepSearch")}
          </label>
          <div className="flex gap-1" aria-label={props.t("knowledge.scope")}>
            {(["current", "all"] as const).map((scope) => (
              <button key={scope} type="button" className="rounded border px-2 py-1 text-[11px]" aria-pressed={props.scope === scope} disabled={props.scopeLoading} onClick={() => props.onScopeChange(scope)}>
                {props.t(scope === "current" ? "knowledge.currentProject" : "knowledge.allProjects")}
              </button>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(["all", "papers", "documents"] as const).map((filter) => (
              <button key={filter} type="button" className="rounded border px-2 py-1 text-[11px]" aria-pressed={props.sourceFilter === filter} onClick={() => props.onSourceFilterChange(filter)}>
                {props.t(`knowledge.filter.${filter}`)}
              </button>
            ))}
          </div>
          <select value={props.statusFilter} aria-label={props.t("knowledge.status")} className="h-8 rounded border border-[color:var(--editor-widget-border)] bg-transparent px-2 text-xs" onChange={(event) => props.onStatusFilterChange(event.target.value as KnowledgeStatusFilter)}>
            {(["all", "ready", "pending", "stale", "failed"] as const).map((status) => (
              <option key={status} value={status}>{props.t(status === "all" ? "knowledge.filter.allStatus" : `knowledge.status.${status}`)}</option>
            ))}
          </select>
          {props.advancedContent}
        </div>,
        document.body,
      )
    : null;

  return (
    <header className="relative flex min-h-11 items-center gap-2 border-b border-[color:var(--editor-widget-border)] px-2 py-1.5">
      <button type="button" className="shrink-0 text-sm font-semibold" onClick={props.onClearSelection}>{props.t("knowledge.title")}</button>
      <InfoHint content={props.t("knowledge.subtitle")} label={props.t("knowledge.title")} />
      <div className="relative min-w-32 max-w-3xl flex-1">
        <Search className="pointer-events-none absolute left-2.5 top-2 h-4 w-4 text-[color:var(--app-muted)]" />
        <input
          ref={inputRef}
          value={props.query}
          role="combobox"
          aria-label={props.t("knowledge.search")}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={resultsOpen && queryActive}
          aria-activedescendant={activeId}
          placeholder={props.t("knowledge.searchPlaceholder")}
          className="h-8 w-full rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] pl-8 pr-8 text-xs outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)]"
          onFocus={() => setResultsOpen(queryActive)}
          onChange={(event) => props.onQueryChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" && props.hits.length > 0) {
              event.preventDefault();
              setResultsOpen(true);
              setActiveIndex((current) => (current + 1) % props.hits.length);
            } else if (event.key === "ArrowUp" && props.hits.length > 0) {
              event.preventDefault();
              setResultsOpen(true);
              setActiveIndex((current) => (current - 1 + props.hits.length) % props.hits.length);
            } else if (event.key === "Enter" && resultsOpen && props.hits[activeIndex]) {
              event.preventDefault();
              props.onSelectHit(props.hits[activeIndex]);
              setResultsOpen(false);
            } else if (event.key === "Escape") {
              setResultsOpen(false);
            }
          }}
        />
        {queryActive ? (
          <button type="button" className="absolute right-1.5 top-1.5 inline-flex h-5 w-5 items-center justify-center rounded" aria-label={props.t("knowledge.clearSearch")} onClick={() => props.onQueryChange("")}>
            <X className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
      {props.errorMessage ? <InfoHint content={props.errorMessage} label={props.t("knowledge.error.failed")} tone="warning" /> : null}
      <button ref={filtersButtonRef} type="button" className="panel-topbar-btn h-8 w-8 rounded border" aria-label={props.t("knowledge.advancedFilters")} aria-controls={filtersId} aria-expanded={filtersOpen} onClick={() => setFiltersOpen((current) => !current)}>
        <SlidersHorizontal className="mx-auto h-4 w-4" />
      </button>
      <button type="button" className="panel-topbar-btn h-8 w-8 rounded border" disabled={props.busy} aria-label={props.t("knowledge.refresh")} onClick={props.onRefresh}>
        <RefreshCw className={cn("mx-auto h-4 w-4", props.busy && "animate-spin motion-reduce:animate-none")} />
      </button>
      <LibraryUploadMenu busy={props.busy} onImportPdf={props.onImportPdf} onImportLink={props.onImportLink} onSyncZotero={props.onSyncZotero} t={props.t} />
      <span className="sr-only" role="status" aria-live="polite">{props.searching ? props.t("common.loading") : props.errorMessage ?? ""}</span>
      {resultsPortal}
      {filtersPortal}
    </header>
  );
}
