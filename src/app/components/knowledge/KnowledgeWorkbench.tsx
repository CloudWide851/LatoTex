import {
  BookOpen,
  FileText,
  MoreHorizontal,
  RefreshCw,
  Search,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { cn } from "../../../lib/utils";
import {
  expandKnowledgeGraph,
  fetchKnowledgeEvidence,
  listKnowledgeItems,
  reindexKnowledgeItem,
  unarchiveKnowledgeItem,
} from "../../../shared/api/knowledge";
import { listProjects } from "../../../shared/api/projects";
import type {
  KnowledgeFetchResponse,
  KnowledgeGraphResponse,
  KnowledgeItem,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
} from "../../../shared/types/app";
import { knowledgeFailureMessage } from "../../hooks/knowledgeMutationApproval";
import {
  KnowledgeEntryMenu,
  type KnowledgeEntryMenuState,
} from "./KnowledgeEntryMenu";
import { KnowledgeDetailsPanel } from "./KnowledgeDetailsPanel";
import { KnowledgeEmbeddingBanner } from "./KnowledgeEmbeddingBanner";
import {
  HighlightedText,
  itemFromHit,
} from "./knowledgeWorkbenchUtils";
import { useKnowledgeWorkbenchPrefs } from "./useKnowledgeWorkbenchPrefs";
import { useKnowledgeSearch } from "./useKnowledgeSearch";
import {
  recordKnowledgeRuntimeMetric,
} from "./knowledgeRuntimePerformance";
import { useKnowledgeRuntimePerformance } from "./useKnowledgeRuntimePerformance";

type TranslationFn = (key: any) => string;
type SourceFilter = "all" | "papers" | "documents";
type StatusFilter = "all" | "ready" | "pending" | "stale" | "failed";

export function KnowledgeWorkbench(props: {
  projectId: string;
  onOpenSource: (item: KnowledgeItem) => void;
  onOpenPlugins: () => void;
  t: TranslationFn;
}) {
  const { projectId, onOpenPlugins, onOpenSource, t } = props;
  const hostRef = useRef<HTMLDivElement | null>(null);
  const listRef = useRef<HTMLDivElement | null>(null);
  const {
    knowledgePrefs,
    searchScope,
    selectSearchScope,
  } = useKnowledgeWorkbenchPrefs();
  const [compact, setCompact] = useState(false);
  const [compactPane, setCompactPane] = useState<"results" | "details">("results");
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false);
  const [globalProjectIds, setGlobalProjectIds] = useState<string[] | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [loading, setLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
  const [selectedEvidenceId, setSelectedEvidenceId] = useState<string | null>(null);
  const [evidence, setEvidence] = useState<KnowledgeFetchResponse | null>(null);
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null);
  const [topicRevision, setTopicRevision] = useState(0);
  const [menu, setMenu] = useState<KnowledgeEntryMenuState>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(500);
  const handleAcceptedSearchResponse = useCallback((
    response: KnowledgeSearchResponse,
    phase: "lexical" | "hybrid",
  ) => {
    const first = response.hits[0];
    if (phase === "lexical") {
      setSelectedItemId(first?.itemId ?? null);
      setSelectedEvidenceId(first?.evidenceId ?? null);
      setScrollTop(0);
      return;
    }
    setSelectedItemId((current) => (
      current && response.hits.some((hit) => hit.itemId === current)
        ? current
        : first?.itemId ?? null
    ));
    setSelectedEvidenceId((current) => (
      current && response.hits.some((hit) => hit.evidenceId === current)
        ? current
        : first?.evidenceId ?? null
    ));
  }, []);
  const {
    embedding,
    errorMessage: searchErrorMessage,
    hits,
    searching,
    setEmbeddingStatus,
  } = useKnowledgeSearch({
    projectId,
    projectIds: globalProjectIds,
    scope: searchScope,
    query,
    deep,
    onAcceptedResponse: handleAcceptedSearchResponse,
    onStart: () => setMessage(null),
    t,
  });
  const performanceBusy = loading || searching || busyItemId !== null;
  useKnowledgeRuntimePerformance(performanceBusy);

  const refreshItems = useCallback(async () => {
    setLoading(true);
    try {
      const nextItems = await listKnowledgeItems(projectId);
      setItems(nextItems);
      setSelectedItemId((current) => (
        current && nextItems.some((item) => item.itemId === current)
          ? current
          : nextItems[0]?.itemId ?? null
      ));
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, t));
    } finally {
      setLoading(false);
    }
  }, [projectId, t]);

  useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  useEffect(() => {
    if (!query.trim()) {
      setSelectedEvidenceId(null);
    }
  }, [query]);

  useEffect(() => {
    const host = hostRef.current;
    const list = listRef.current;
    if (!host || !list) {
      return;
    }
    const hostObserver = new ResizeObserver(([entry]) => {
      setCompact(Boolean(entry && entry.contentRect.width < 720));
    });
    const listObserver = new ResizeObserver(([entry]) => {
      if (entry) {
        setViewportHeight(entry.contentRect.height);
      }
    });
    hostObserver.observe(host);
    listObserver.observe(list);
    return () => {
      hostObserver.disconnect();
      listObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    if (searchScope !== "all" || globalProjectIds) {
      return;
    }
    let disposed = false;
    setScopeLoading(true);
    listProjects()
      .then((projects) => {
        if (!disposed) {
          setGlobalProjectIds(projects.map((project) => project.id).slice(0, 64));
        }
      })
      .catch((error) => {
        if (!disposed) {
          setMessage(knowledgeFailureMessage(error, t));
          selectSearchScope("current");
        }
      })
      .finally(() => {
        if (!disposed) {
          setScopeLoading(false);
        }
      });
    return () => {
      disposed = true;
    };
  }, [globalProjectIds, searchScope, selectSearchScope, t]);

  useEffect(() => {
    let disposed = false;
    const selectedHit = hits.find((hit) => hit.evidenceId === selectedEvidenceId);
    const selectedProjectId = selectedHit?.projectId ?? projectId;
    if (selectedEvidenceId) {
      const previewStartedAt = performance.now();
      fetchKnowledgeEvidence(selectedProjectId, selectedEvidenceId, 8_000)
        .then((result) => {
          if (!disposed) {
            setEvidence(result);
            recordKnowledgeRuntimeMetric(
              "preview_interactive",
              performance.now() - previewStartedAt,
              result.text.length,
            );
          }
        })
        .catch(() => {
          if (!disposed) {
            setEvidence(null);
          }
        });
    } else {
      setEvidence(null);
    }
    if (selectedItemId) {
      expandKnowledgeGraph({
        projectId: selectedProjectId,
        itemId: selectedItemId,
        limit: knowledgePrefs.graph.maxVisibleNodes,
      })
        .then((result) => {
          if (!disposed) {
            setGraph(result);
          }
        })
        .catch(() => {
          if (!disposed) {
            setGraph(null);
          }
        });
    } else {
      setGraph(null);
    }
    return () => {
      disposed = true;
    };
  }, [
    hits,
    knowledgePrefs.graph.maxVisibleNodes,
    projectId,
    selectedEvidenceId,
    selectedItemId,
    topicRevision,
  ]);

  const filteredItems = useMemo(() => items.filter((item) => {
    const sourceMatches = sourceFilter === "all"
      || (sourceFilter === "papers" && item.sourceKind === "pdf")
      || (sourceFilter === "documents" && item.sourceKind !== "pdf");
    const statusMatches = statusFilter === "all" || item.indexState === statusFilter;
    return sourceMatches && statusMatches;
  }), [items, sourceFilter, statusFilter]);
  const queryActive = Boolean(query.trim());
  const rows = queryActive ? hits : filteredItems;
  const selectedHit = hits.find((hit) => hit.evidenceId === selectedEvidenceId) ?? null;
  const selectedItem = items.find((item) => item.itemId === selectedItemId)
    ?? (selectedHit ? itemFromHit(selectedHit) : null);
  const rowHeight = queryActive ? 102 : 78;
  const start = Math.max(0, Math.floor(scrollTop / rowHeight) - 4);
  const end = Math.min(rows.length, Math.ceil((scrollTop + viewportHeight) / rowHeight) + 4);
  const visibleRows = rows.slice(start, end);

  const runReindex = async (item: KnowledgeItem) => {
    setBusyItemId(item.itemId);
    setMessage(null);
    try {
      await reindexKnowledgeItem(item.projectId, item.itemId);
      setMessage(t("knowledge.archived"));
      await refreshItems();
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, t));
    } finally {
      setBusyItemId(null);
    }
  };
  const runUnarchive = async (item: KnowledgeItem) => {
    if (!window.confirm(t("knowledge.confirmUnarchive"))) {
      return;
    }
    setBusyItemId(item.itemId);
    setMessage(null);
    try {
      await unarchiveKnowledgeItem(item.projectId, item.itemId);
      setMessage(t("knowledge.unarchived"));
      setSelectedItemId(null);
      setSelectedEvidenceId(null);
      await refreshItems();
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, t));
    } finally {
      setBusyItemId(null);
    }
  };

  const resultsPanel = (
    <section className="grid min-h-0 grid-rows-[auto_auto_minmax(0,1fr)] border-r border-[color:var(--editor-widget-border)]">
      <div className="border-b border-[color:var(--editor-widget-border)] p-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-2.5 h-4 w-4 text-slate-400" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t("knowledge.searchPlaceholder")}
            aria-label={t("knowledge.search")}
            className="h-9 w-full rounded-md border border-[color:var(--editor-widget-border)] bg-[color:var(--editor-paper-bg)] pl-8 pr-9 text-sm outline-none focus-visible:ring-2 focus-visible:ring-[color:var(--app-accent)]"
          />
          {searching ? (
            <RefreshCw className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-slate-400 motion-reduce:animate-none" />
          ) : null}
        </div>
        <label className="mt-2 inline-flex items-center gap-2 text-xs text-slate-600">
          <input type="checkbox" checked={deep} onChange={(event) => setDeep(event.target.checked)} />
          {t("knowledge.deepSearch")}
        </label>
        <div className="mt-2 flex items-center gap-1" aria-label={t("knowledge.scope")}>
          {(["current", "all"] as const).map((scope) => (
            <button
              key={scope}
              type="button"
              aria-pressed={searchScope === scope}
              disabled={scopeLoading}
              className={cn(
                "rounded-full border px-2 py-1 text-[11px]",
                searchScope === scope
                  ? "border-[color:var(--app-accent)] text-[color:var(--app-accent)]"
                  : "border-slate-200 text-slate-500",
              )}
              onClick={() => {
                selectSearchScope(scope);
              }}
            >
              {t(scope === "current" ? "knowledge.currentProject" : "knowledge.allProjects")}
            </button>
          ))}
          {scopeLoading ? (
            <span className="text-[10px] text-slate-500">{t("knowledge.scopeLoading")}</span>
          ) : null}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-1.5 border-b border-[color:var(--editor-widget-border)] px-3 py-2">
        {(["all", "papers", "documents"] as SourceFilter[]).map((filter) => (
          <button
            key={filter}
            type="button"
            aria-pressed={sourceFilter === filter}
            className={cn("rounded-full border px-2 py-1 text-[11px]", sourceFilter === filter ? "border-[color:var(--app-accent)] text-[color:var(--app-accent)]" : "border-slate-200 text-slate-500")}
            onClick={() => setSourceFilter(filter)}
          >
            {t(`knowledge.filter.${filter}`)}
          </button>
        ))}
        <select
          value={statusFilter}
          onChange={(event) => setStatusFilter(event.target.value as StatusFilter)}
          aria-label={t("knowledge.status")}
          className="ml-auto h-7 rounded border border-[color:var(--editor-widget-border)] bg-transparent px-2 text-[11px]"
        >
          {(["all", "ready", "pending", "stale", "failed"] as StatusFilter[]).map((status) => (
            <option key={status} value={status}>
              {t(status === "all" ? "knowledge.filter.allStatus" : `knowledge.status.${status}`)}
            </option>
          ))}
        </select>
      </div>
      <div
        ref={listRef}
        className="library-scrollbar relative min-h-0 overflow-auto"
        onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      >
        {loading ? (
          <div className="p-4 text-xs text-slate-500">{t("common.loading")}</div>
        ) : rows.length === 0 ? (
          <div className="flex h-full items-center justify-center px-6 text-center text-xs text-slate-500">
            {queryActive ? t("knowledge.noResults") : t("knowledge.empty")}
          </div>
        ) : (
          <div className="relative" style={{ height: rows.length * rowHeight }}>
            {visibleRows.map((row, visibleIndex) => {
              const index = start + visibleIndex;
              const hit = queryActive ? row as KnowledgeSearchHit : null;
              const item = queryActive
                ? items.find((candidate) => candidate.itemId === hit?.itemId)
                  ?? (hit ? itemFromHit(hit) : null)
                : row as KnowledgeItem;
              if (!item) {
                return null;
              }
              const selected = item.itemId === selectedItemId
                && (!hit || hit.evidenceId === selectedEvidenceId);
              return (
                <button
                  key={hit?.evidenceId ?? item.itemId}
                  type="button"
                  className={cn(
                    "absolute left-0 grid w-full gap-1 border-b border-slate-100 px-3 py-2 text-left transition-colors focus-visible:z-10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[color:var(--app-accent)]",
                    selected ? "bg-sky-50/80" : "hover:bg-slate-50",
                  )}
                  style={{ top: index * rowHeight, height: rowHeight }}
                  onClick={() => {
                    setSelectedItemId(item.itemId);
                    setSelectedEvidenceId(hit?.evidenceId ?? null);
                    if (compact) {
                      setCompactPane("details");
                    }
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault();
                    setMenu({ x: event.clientX, y: event.clientY, item });
                  }}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {item.sourceKind === "pdf" ? <BookOpen className="h-3.5 w-3.5 shrink-0" /> : <FileText className="h-3.5 w-3.5 shrink-0" />}
                    <strong className="truncate text-xs font-semibold text-slate-800">
                      <HighlightedText text={item.title} query={query} />
                    </strong>
                    {hit ? <span className="ml-auto text-[10px] text-sky-700">[{index + 1}]</span> : null}
                    <MoreHorizontal
                      className="h-3.5 w-3.5 shrink-0 text-slate-400"
                      aria-hidden="true"
                    />
                  </span>
                  <span className="truncate text-[10px] text-slate-500">{item.relativePath}</span>
                  {hit ? (
                    <span className="line-clamp-2 text-[11px] leading-4 text-slate-600">
                      <HighlightedText text={hit.snippet} query={query} />
                    </span>
                  ) : (
                    <span className="text-[10px] text-slate-500">
                      {t(`knowledge.status.${item.indexState}`)} · {item.chunkCount}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
        )}
      </div>
    </section>
  );

  return (
    <div
      ref={hostRef}
      className="knowledge-workbench app-material-panel grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border"
      data-performance-mode={performanceBusy ? "busy" : "idle"}
    >
      <header className="flex min-h-11 items-center gap-3 border-b border-[color:var(--editor-widget-border)] px-3 py-2">
        <div className="min-w-0 flex-1">
          <h1 className="truncate text-sm font-semibold text-slate-900">{t("knowledge.title")}</h1>
          <p className="truncate text-[11px] text-slate-500">{t("knowledge.subtitle")}</p>
        </div>
        <button type="button" className="panel-topbar-btn h-7 w-7 rounded border" onClick={() => void refreshItems()} title={t("knowledge.refresh")} aria-label={t("knowledge.refresh")}>
          <RefreshCw className="mx-auto h-3.5 w-3.5" />
        </button>
      </header>
      <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
        <KnowledgeEmbeddingBanner
          projectId={projectId}
          message={searchErrorMessage ?? message}
          status={embedding}
          reminderEnabled={knowledgePrefs.semanticModelReminderEnabled}
          onStatusChange={setEmbeddingStatus}
          onOpenPlugins={onOpenPlugins}
          t={t}
        />
        <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)]">
          {compact ? (
            <div className="flex border-b border-[color:var(--editor-widget-border)] p-1">
              {(["results", "details"] as const).map((pane) => (
                <button key={pane} type="button" aria-pressed={compactPane === pane} className={cn("flex-1 rounded px-2 py-1 text-xs", compactPane === pane && "bg-slate-100 font-semibold")} onClick={() => setCompactPane(pane)}>
                  {t(`knowledge.pane.${pane}`)}
                </button>
              ))}
            </div>
          ) : null}
          <div className={cn("min-h-0", compact ? "grid" : "grid grid-cols-[minmax(280px,1fr)_minmax(300px,0.9fr)]")}>
            {!compact || compactPane === "results" ? resultsPanel : null}
            {!compact || compactPane === "details" ? (
              <KnowledgeDetailsPanel
                projectId={projectId}
                selectedItem={selectedItem}
                selectedHit={selectedHit}
                evidence={evidence}
                hits={hits}
                graph={graph}
                graphPrefs={knowledgePrefs.graph}
                topicRevision={topicRevision}
                busyItemId={busyItemId}
                onOpenSource={onOpenSource}
                onReindex={(item) => void runReindex(item)}
                onUnarchive={(item) => void runUnarchive(item)}
                onTopicsChanged={() => setTopicRevision((current) => current + 1)}
                t={t}
              />
            ) : null}
          </div>
        </div>
      </div>
      <KnowledgeEntryMenu
        menu={menu}
        busy={Boolean(busyItemId)}
        onClose={() => setMenu(null)}
        onOpenSource={onOpenSource}
        onReindex={runReindex}
        onUnarchive={runUnarchive}
        t={t}
      />
    </div>
  );
}
