import {
  Suspense,
  lazy,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Panel, PanelGroup, PanelResizeHandle } from "react-resizable-panels";
import type {
  FsAction,
  FsScope,
  KnowledgeDocumentFocusRequest,
  KnowledgeGraphResponse,
  KnowledgeItem,
  KnowledgeSearchHit,
  KnowledgeSearchResponse,
  ResourceNode,
} from "../../../shared/types/app";
import {
  expandKnowledgeGraph,
  listKnowledgeItems,
  reindexKnowledgeItem,
  unarchiveKnowledgeItem,
} from "../../../shared/api/knowledge";
import { listProjects } from "../../../shared/api/projects";
import {
  fromLibraryWorkspacePath,
  isSameLibraryPath,
} from "../../../shared/utils/libraryPath";
import { cn } from "../../../lib/utils";
import { InfoHint } from "../../../components/ui/info-hint";
import { requestAppConfirm } from "../../dialog/appDialogBridge";
import { knowledgeFailureMessage } from "../../hooks/knowledgeMutationApproval";
import { LibraryExplorerPanel } from "../workspace/LibraryExplorerPanel";
import { WorkspacePanelFallback } from "../workspace/workspaceShellLazy";
import { KnowledgeEmbeddingBanner } from "./KnowledgeEmbeddingBanner";
import { KnowledgeEntryMenu, type KnowledgeEntryMenuState } from "./KnowledgeEntryMenu";
import { KnowledgeFileGraphPanel } from "./KnowledgeFileGraphPanel";
import {
  KnowledgeSearchTopbar,
  type KnowledgeSearchScope,
  type KnowledgeSourceFilter,
  type KnowledgeStatusFilter,
} from "./KnowledgeSearchTopbar";
import { createKnowledgeFocusRequest } from "./knowledgeDocumentFocus";
import { itemFromHit } from "./knowledgeWorkbenchUtils";
import { useKnowledgeRuntimePerformance } from "./useKnowledgeRuntimePerformance";
import { useKnowledgeSearch } from "./useKnowledgeSearch";
import { useKnowledgeWorkbenchPrefs } from "./useKnowledgeWorkbenchPrefs";

const LazyLibraryDocumentViewer = lazy(async () => {
  const module = await import("../LibraryDocumentViewer");
  return { default: module.LibraryDocumentViewer };
});

type TranslationFn = (key: any) => string;
type KnowledgeView = "document" | "graph";

type PendingCrossProjectOpen = {
  item: KnowledgeItem;
  request: KnowledgeDocumentFocusRequest;
  libraryPath: string | null;
};

export function KnowledgePageLayout(props: {
  projectId: string;
  busy: boolean;
  layout: number[];
  libraryTree: ResourceNode[];
  selectedLibraryPath: string | null;
  analysisRunning: boolean;
  libraryViewMode: "bib" | "pdf" | "compare" | null;
  translationModelId: string | null;
  paperBriefEngine: "auto" | "pdfjs" | "python";
  libraryBibLayout: number[];
  libraryExplorerDefaultExpanded: boolean;
  libraryExplorerScrollbarVisible: boolean;
  libraryExplorerExpandedPaths?: string[];
  onLibraryExplorerExpandedPathsChange: (paths: string[]) => void;
  onLayout: (layout: number[]) => void;
  onBibLayoutChange: (layout: number[]) => void;
  onSelectLibraryPath: (path: string | null) => void;
  onOpenWorkspaceSource: (item: KnowledgeItem, request: KnowledgeDocumentFocusRequest) => void;
  onProjectChange: (projectId: string | null) => void;
  onOpenPlugins: () => void;
  onFsAction: (scope: FsScope, action: FsAction, path: string, targetPath?: string, content?: string) => Promise<boolean | void>;
  onLibraryRescan: () => void;
  onLibraryImportPdf: () => void;
  onLibraryImportLink: (input: { link: string; scope?: "users" | "groups"; ownerId?: string; apiKey?: string }) => void;
  onLibrarySyncZotero: (input: { ownerId: string; apiKey: string; scope?: "users" | "groups" }) => void;
  onLibraryAnalyzePaper: (path: string) => void;
  onLibraryViewModeChange: (mode: "bib" | "pdf" | "compare") => void;
  t: TranslationFn;
}) {
  const { knowledgePrefs, searchScope, selectSearchScope } = useKnowledgeWorkbenchPrefs();
  const selectionKey = `${props.projectId}:${props.selectedLibraryPath ?? ""}`;
  const [items, setItems] = useState<KnowledgeItem[]>([]);
  const [query, setQuery] = useState("");
  const [deep, setDeep] = useState(false);
  const [globalProjectIds, setGlobalProjectIds] = useState<string[] | null>(null);
  const [scopeLoading, setScopeLoading] = useState(false);
  const [sourceFilter, setSourceFilter] = useState<KnowledgeSourceFilter>("all");
  const [statusFilter, setStatusFilter] = useState<KnowledgeStatusFilter>("all");
  const [itemsLoading, setItemsLoading] = useState(true);
  const [busyItemId, setBusyItemId] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [selectedSearchItem, setSelectedSearchItem] = useState<KnowledgeItem | null>(null);
  const [focusRequest, setFocusRequest] = useState<KnowledgeDocumentFocusRequest | null>(null);
  const [viewState, setViewState] = useState<{ selectionKey: string; view: KnowledgeView }>({
    selectionKey,
    view: "document",
  });
  const view = viewState.selectionKey === selectionKey ? viewState.view : "document";
  const selectView = (next: KnowledgeView) => setViewState({ selectionKey, view: next });
  const [graph, setGraph] = useState<KnowledgeGraphResponse | null>(null);
  const [graphLoading, setGraphLoading] = useState(false);
  const [graphError, setGraphError] = useState<string | null>(null);
  const [topicRevision, setTopicRevision] = useState(0);
  const [menu, setMenu] = useState<KnowledgeEntryMenuState>(null);
  const [pendingCrossProject, setPendingCrossProject] = useState<PendingCrossProjectOpen | null>(null);
  const focusSequenceRef = useRef(0);

  const refreshItems = useCallback(async () => {
    setItemsLoading(true);
    setMessage(null);
    try {
      setItems(await listKnowledgeItems(props.projectId));
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, props.t));
    } finally {
      setItemsLoading(false);
    }
  }, [props.projectId, props.t]);

  useEffect(() => {
    void refreshItems();
  }, [refreshItems]);

  useEffect(() => {
    if (searchScope !== "all" || globalProjectIds) return;
    let disposed = false;
    setScopeLoading(true);
    listProjects()
      .then((projects) => {
        if (!disposed) setGlobalProjectIds(projects.map((project) => project.id).slice(0, 64));
      })
      .catch((error) => {
        if (!disposed) {
          setMessage(knowledgeFailureMessage(error, props.t));
          selectSearchScope("current");
        }
      })
      .finally(() => {
        if (!disposed) setScopeLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [globalProjectIds, props.t, searchScope, selectSearchScope]);

  const handleAcceptedSearchResponse = useCallback((_response: KnowledgeSearchResponse) => {
    setMessage(null);
  }, []);
  const { embedding, errorMessage: searchError, hits, searching, setEmbeddingStatus } = useKnowledgeSearch({
    projectId: props.projectId,
    projectIds: globalProjectIds,
    scope: searchScope,
    query,
    deep,
    onAcceptedResponse: handleAcceptedSearchResponse,
    onStart: () => setMessage(null),
    t: props.t,
  });

  const filteredHits = useMemo(() => hits.filter((hit) => {
    const sourceMatches = sourceFilter === "all"
      || (sourceFilter === "papers" && hit.sourceKind === "pdf")
      || (sourceFilter === "documents" && hit.sourceKind !== "pdf");
    const state = items.find((item) => item.projectId === hit.projectId && item.itemId === hit.itemId)?.indexState ?? "ready";
    return sourceMatches && (statusFilter === "all" || state === statusFilter);
  }), [hits, items, sourceFilter, statusFilter]);

  const selectedItem = useMemo(() => {
    const selectedLibraryPath = props.selectedLibraryPath;
    if (!selectedLibraryPath) return null;
    return items.find((item) => isSameLibraryPath(item.relativePath, selectedLibraryPath))
      ?? (selectedSearchItem && isSameLibraryPath(selectedSearchItem.relativePath, selectedLibraryPath)
        ? selectedSearchItem
        : null);
  }, [items, props.selectedLibraryPath, selectedSearchItem]);

  useEffect(() => {
    setGraph(null);
    setGraphError(null);
  }, [selectionKey]);

  useEffect(() => {
    if (view !== "graph" || !selectedItem) {
      setGraphLoading(false);
      if (view !== "graph") setGraph(null);
      return;
    }
    let disposed = false;
    setGraphLoading(true);
    setGraphError(null);
    expandKnowledgeGraph({
      projectId: selectedItem.projectId,
      itemId: selectedItem.itemId,
      limit: knowledgePrefs.graph.maxVisibleNodes,
    })
      .then((result) => {
        if (!disposed) setGraph(result);
      })
      .catch((error) => {
        if (!disposed) {
          setGraph(null);
          setGraphError(knowledgeFailureMessage(error, props.t));
        }
      })
      .finally(() => {
        if (!disposed) setGraphLoading(false);
      });
    return () => {
      disposed = true;
    };
  }, [knowledgePrefs.graph.maxVisibleNodes, props.t, selectedItem, topicRevision, view]);

  useEffect(() => {
    if (!pendingCrossProject || pendingCrossProject.item.projectId !== props.projectId) return;
    setPendingCrossProject(null);
    setMessage(null);
    setSelectedSearchItem(pendingCrossProject.item);
    setFocusRequest(pendingCrossProject.request);
    if (pendingCrossProject.libraryPath !== null) {
      props.onSelectLibraryPath(pendingCrossProject.libraryPath);
    } else {
      props.onOpenWorkspaceSource(pendingCrossProject.item, pendingCrossProject.request);
    }
  }, [
    pendingCrossProject,
    props.onOpenWorkspaceSource,
    props.onSelectLibraryPath,
    props.projectId,
  ]);

  useEffect(() => {
    if (!pendingCrossProject) return;
    const timer = window.setTimeout(() => {
      setMessage(props.t("knowledge.crossProjectFailed"));
    }, 10_000);
    return () => window.clearTimeout(timer);
  }, [pendingCrossProject, props.t]);

  useKnowledgeRuntimePerformance(itemsLoading || searching || graphLoading || busyItemId !== null);

  const selectHit = (hit: KnowledgeSearchHit) => {
    focusSequenceRef.current += 1;
    const request = createKnowledgeFocusRequest(hit, focusSequenceRef.current);
    const item = itemFromHit(hit);
    const libraryPath = fromLibraryWorkspacePath(item.relativePath);
    setSelectedSearchItem(item);
    setFocusRequest(request);
    selectView("document");
    if (item.projectId !== props.projectId) {
      setPendingCrossProject({ item, request, libraryPath });
      setMessage(props.t("knowledge.crossProjectOpening"));
      props.onProjectChange(item.projectId);
      return;
    }
    if (libraryPath !== null) {
      props.onSelectLibraryPath(libraryPath);
    } else {
      props.onOpenWorkspaceSource(item, request);
    }
  };

  const clearSelection = () => {
    setSelectedSearchItem(null);
    setFocusRequest(null);
    setPendingCrossProject(null);
    selectView("document");
    props.onSelectLibraryPath(null);
  };

  const runReindex = async (item: KnowledgeItem) => {
    setBusyItemId(item.itemId);
    try {
      await reindexKnowledgeItem(item.projectId, item.itemId);
      await refreshItems();
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, props.t));
    } finally {
      setBusyItemId(null);
    }
  };

  const runUnarchive = async (item: KnowledgeItem) => {
    if (!await requestAppConfirm({ title: props.t("knowledge.confirmUnarchive"), tone: "danger" })) return;
    setBusyItemId(item.itemId);
    try {
      await unarchiveKnowledgeItem(item.projectId, item.itemId);
      clearSelection();
      await refreshItems();
    } catch (error) {
      setMessage(knowledgeFailureMessage(error, props.t));
    } finally {
      setBusyItemId(null);
    }
  };

  const documentFocus = focusRequest
    && focusRequest.projectId === props.projectId
    && props.selectedLibraryPath
    && isSameLibraryPath(focusRequest.path, props.selectedLibraryPath)
      ? focusRequest
      : null;
  const pageBusy = props.busy || itemsLoading || busyItemId !== null;

  return (
    <section className="app-material-panel grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border">
      <KnowledgeSearchTopbar
        query={query}
        hits={filteredHits}
        searching={searching}
        errorMessage={searchError ?? message}
        deep={deep}
        scope={searchScope as KnowledgeSearchScope}
        scopeLoading={scopeLoading}
        sourceFilter={sourceFilter}
        statusFilter={statusFilter}
        busy={pageBusy}
        onQueryChange={setQuery}
        onDeepChange={setDeep}
        onScopeChange={selectSearchScope}
        onSourceFilterChange={setSourceFilter}
        onStatusFilterChange={setStatusFilter}
        onSelectHit={selectHit}
        onClearSelection={clearSelection}
        onRefresh={() => {
          props.onLibraryRescan();
          void refreshItems();
        }}
        onImportPdf={props.onLibraryImportPdf}
        onImportLink={props.onLibraryImportLink}
        onSyncZotero={props.onLibrarySyncZotero}
        advancedContent={(
          <KnowledgeEmbeddingBanner projectId={props.projectId} message={null} status={embedding} reminderEnabled={knowledgePrefs.semanticModelReminderEnabled} onStatusChange={setEmbeddingStatus} onOpenPlugins={props.onOpenPlugins} t={props.t} />
        )}
        t={props.t}
      />
      <PanelGroup direction="horizontal" className="min-h-0 gap-px" onLayout={props.onLayout}>
        <Panel className="min-w-0" id={`library-explorer-${props.projectId}`} order={1} defaultSize={props.layout[0]} minSize={20}>
          <LibraryExplorerPanel
            libraryTree={props.libraryTree}
            selectedLibraryPath={props.selectedLibraryPath}
            busy={pageBusy}
            onSelectLibraryPath={(path) => {
              setSelectedSearchItem(null);
              setFocusRequest(null);
              props.onSelectLibraryPath(path);
            }}
            onFsAction={props.onFsAction}
            defaultExpanded={props.libraryExplorerDefaultExpanded}
            scrollbarVisible={props.libraryExplorerScrollbarVisible}
            expandedPaths={props.libraryExplorerExpandedPaths}
            onExpandedPathsChange={props.onLibraryExplorerExpandedPathsChange}
            t={props.t}
          />
        </Panel>
        <PanelResizeHandle className="resizable-handle" />
        <Panel className="min-w-0" id={`library-viewer-${props.projectId}`} order={2} defaultSize={props.layout[1]} minSize={28}>
          {props.selectedLibraryPath ? (
            <div className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)]">
              <div className="flex items-center gap-1 border-b border-[color:var(--editor-widget-border)] p-1">
                {(["document", "graph"] as const).map((target) => {
                  const graphUnavailable = target === "graph" && !selectedItem;
                  return (
                    <span key={target} className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        aria-pressed={view === target}
                        disabled={graphUnavailable}
                        className={cn("rounded px-3 py-1 text-xs disabled:opacity-40", view === target && "bg-[color:var(--editor-selection-bg)] font-medium")}
                        onClick={() => selectView(target)}
                      >
                        {props.t(target === "document" ? "knowledge.document" : "knowledge.graph")}
                      </button>
                      {graphUnavailable ? <InfoHint content={props.t("knowledge.graphUnavailable")} label={props.t("knowledge.graph")} /> : null}
                    </span>
                  );
                })}
              </div>
              <div className="min-h-0">
                {view === "graph" && selectedItem ? (
                  <KnowledgeFileGraphPanel item={selectedItem} graph={graph} loading={graphLoading} errorMessage={graphError} maxVisibleNodes={knowledgePrefs.graph.maxVisibleNodes} showLabels={knowledgePrefs.graph.showLabels} topicRevision={topicRevision} onTopicsChanged={() => setTopicRevision((current) => current + 1)} onOpenMenu={(event, item) => setMenu({ x: event.clientX, y: event.clientY, item })} t={props.t} />
                ) : (
                  <Suspense fallback={<WorkspacePanelFallback label={props.t("common.loading")} />}>
                    <LazyLibraryDocumentViewer projectId={props.projectId} selectedPath={props.selectedLibraryPath} active focusRequest={documentFocus} onAnalyzePaper={props.onLibraryAnalyzePaper} analysisRunning={props.analysisRunning} persistedViewMode={props.libraryViewMode} onPersistViewMode={props.onLibraryViewModeChange} translationModelId={props.translationModelId} paperBriefEngine={props.paperBriefEngine} bibLayout={props.libraryBibLayout} onBibLayoutChange={props.onBibLayoutChange} t={props.t} />
                  </Suspense>
                )}
              </div>
            </div>
          ) : (
            <div className="flex h-full items-center justify-center">
              <button type="button" className="rounded-md border border-[color:var(--app-accent)] px-3 py-2 text-xs font-medium text-[color:var(--app-accent)]" onClick={props.onLibraryImportPdf}>{props.t("knowledge.importFirst")}</button>
            </div>
          )}
        </Panel>
      </PanelGroup>
      <KnowledgeEntryMenu menu={menu} busy={Boolean(busyItemId)} onClose={() => setMenu(null)} onOpenSource={(item) => {
        selectView("document");
        const libraryPath = fromLibraryWorkspacePath(item.relativePath);
        if (libraryPath !== null) props.onSelectLibraryPath(libraryPath);
      }} onReindex={runReindex} onUnarchive={runUnarchive} t={props.t} />
    </section>
  );
}
