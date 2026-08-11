import { MoreHorizontal, Network } from "lucide-react";
import type { KnowledgeGraphResponse, KnowledgeItem } from "../../../shared/types/app";
import { InfoHint } from "../../../components/ui/info-hint";
import { KnowledgeGraphCanvas } from "./KnowledgeGraphCanvas";
import { KnowledgeTopicPanel } from "./KnowledgeTopicPanel";

type TranslationFn = (key: any) => string;

export function KnowledgeFileGraphPanel(props: {
  item: KnowledgeItem;
  graph: KnowledgeGraphResponse | null;
  loading: boolean;
  errorMessage: string | null;
  maxVisibleNodes: number;
  showLabels: boolean;
  topicRevision: number;
  onTopicsChanged: () => void;
  onOpenMenu: (event: React.MouseEvent<HTMLButtonElement>, item: KnowledgeItem) => void;
  t: TranslationFn;
}) {
  const { item, graph, loading, errorMessage, t } = props;
  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)_auto] bg-[color:var(--editor-paper-bg)]">
      <header className="flex min-w-0 items-center gap-2 border-b border-[color:var(--editor-widget-border)] px-3 py-2">
        <Network className="h-4 w-4 shrink-0 text-[color:var(--app-accent)]" />
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{item.title}</span>
        <span className="hidden max-w-48 truncate text-[10px] text-[color:var(--app-muted)] sm:block">{item.relativePath}</span>
        {errorMessage ? <InfoHint content={errorMessage} label={t("knowledge.error.failed")} tone="warning" /> : null}
        <button type="button" className="panel-topbar-btn h-7 w-7 rounded border" aria-label={t("knowledge.more")} onClick={(event) => props.onOpenMenu(event, item)}>
          <MoreHorizontal className="mx-auto h-4 w-4" />
        </button>
      </header>
      <div className="min-h-0 overflow-hidden p-2" aria-busy={loading || undefined}>
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-[color:var(--app-muted)]" role="status">{t("knowledge.graphLoading")}</div>
        ) : (
          <KnowledgeGraphCanvas graph={graph} maxVisibleNodes={props.maxVisibleNodes} showLabels={props.showLabels} t={t} />
        )}
      </div>
      <details className="border-t border-[color:var(--editor-widget-border)] px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">{t("knowledge.topics")}</summary>
        <div className="mt-2 max-h-48 overflow-auto">
          <KnowledgeTopicPanel projectId={item.projectId} refreshToken={`${item.itemId}:${props.topicRevision}`} onChanged={props.onTopicsChanged} t={t} />
        </div>
      </details>
    </section>
  );
}
