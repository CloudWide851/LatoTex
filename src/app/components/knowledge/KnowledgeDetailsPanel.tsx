import { Database, ExternalLink, Network } from "lucide-react";
import { workspaceRevealInSystem } from "../../../shared/api/workspace";
import type {
  KnowledgeFetchResponse,
  KnowledgeGraphResponse,
  KnowledgeItem,
  KnowledgeSearchHit,
} from "../../../shared/types/app";
import { KnowledgeGraphCanvas } from "./KnowledgeGraphCanvas";
import { KnowledgeTopicPanel } from "./KnowledgeTopicPanel";
import { anchorLabel } from "./knowledgeWorkbenchUtils";

type TranslationFn = (key: any) => string;

export function KnowledgeDetailsPanel(props: {
  projectId: string;
  selectedItem: KnowledgeItem | null;
  selectedHit: KnowledgeSearchHit | null;
  evidence: KnowledgeFetchResponse | null;
  hits: KnowledgeSearchHit[];
  graph: KnowledgeGraphResponse | null;
  graphPrefs: {
    maxVisibleNodes: number;
    showLabels: boolean;
  };
  topicRevision: number;
  busyItemId: string | null;
  onOpenSource: (item: KnowledgeItem) => void;
  onReindex: (item: KnowledgeItem) => void;
  onUnarchive: (item: KnowledgeItem) => void;
  onTopicsChanged: () => void;
  t: TranslationFn;
}) {
  const {
    busyItemId,
    evidence,
    graph,
    graphPrefs,
    hits,
    onOpenSource,
    onReindex,
    onTopicsChanged,
    onUnarchive,
    projectId,
    selectedHit,
    selectedItem,
    t,
    topicRevision,
  } = props;

  return (
    <section className="library-scrollbar min-h-0 overflow-auto bg-[color:var(--editor-paper-bg)]">
      {selectedItem ? (
        <div className="grid gap-4 p-4">
          <header className="grid gap-1">
            <div className="flex items-start gap-2">
              <h2 className="min-w-0 flex-1 text-base font-semibold text-slate-900">
                {selectedItem.title}
              </h2>
              <button
                type="button"
                className="panel-topbar-btn h-7 w-7 rounded border"
                onClick={() => {
                  if (selectedItem.projectId === projectId) {
                    onOpenSource(selectedItem);
                  } else {
                    void workspaceRevealInSystem(
                      selectedItem.projectId,
                      selectedItem.relativePath,
                    );
                  }
                }}
                title={t("knowledge.revealSource")}
                aria-label={t("knowledge.revealSource")}
              >
                <ExternalLink className="mx-auto h-3.5 w-3.5" />
              </button>
            </div>
            <p className="break-all text-[11px] text-slate-500">
              {selectedItem.relativePath}
            </p>
            <div className="flex flex-wrap gap-2 text-[10px] text-slate-500">
              <span>{t(`knowledge.status.${selectedItem.indexState}`)}</span>
              <span>·</span>
              <span>
                {selectedItem.chunkCount} {t("knowledge.chunks")}
              </span>
              {anchorLabel(selectedHit || evidence) ? (
                <>
                  <span>·</span>
                  <span>{anchorLabel(selectedHit || evidence)}</span>
                </>
              ) : null}
            </div>
          </header>
          {evidence ? (
            <article className="grid gap-2 rounded-md border border-[color:var(--editor-widget-border)] bg-white/60 p-3">
              <div className="flex items-center gap-2 text-xs font-semibold text-slate-700">
                <Database className="h-3.5 w-3.5" />
                {t("knowledge.citation")} [
                {Math.max(
                  1,
                  hits.findIndex((hit) => hit.evidenceId === evidence.evidenceId) + 1,
                )}
                ]
              </div>
              <p className="whitespace-pre-wrap text-xs leading-5 text-slate-700">
                {evidence.text}
              </p>
            </article>
          ) : (
            <div className="rounded-md border border-dashed border-slate-200 p-3 text-xs text-slate-500">
              {selectedItem.indexState === "ready"
                ? t("knowledge.selectEvidence")
                : t("knowledge.reindexHint")}
            </div>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className="rounded border px-2.5 py-1.5 text-xs"
              disabled={busyItemId === selectedItem.itemId}
              onClick={() => onReindex(selectedItem)}
            >
              {t("knowledge.reindex")}
            </button>
            <button
              type="button"
              className="rounded border border-rose-200 px-2.5 py-1.5 text-xs text-rose-700"
              disabled={busyItemId === selectedItem.itemId}
              onClick={() => onUnarchive(selectedItem)}
            >
              {t("knowledge.unarchive")}
            </button>
          </div>
          <KnowledgeTopicPanel
            projectId={selectedItem.projectId}
            refreshToken={`${selectedItem.projectId}:${topicRevision}`}
            onChanged={onTopicsChanged}
            t={t}
          />
          <div className="grid gap-2">
            <h3 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
              <Network className="h-3.5 w-3.5" />
              {t("knowledge.graph")}
            </h3>
            <KnowledgeGraphCanvas
              graph={graph}
              maxVisibleNodes={graphPrefs.maxVisibleNodes}
              showLabels={graphPrefs.showLabels}
              t={t}
            />
          </div>
        </div>
      ) : (
        <div className="flex h-full items-center justify-center p-6 text-center text-xs text-slate-500">
          {t("knowledge.selectEvidence")}
        </div>
      )}
    </section>
  );
}
