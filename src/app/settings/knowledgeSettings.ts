import type {
  AppSettings,
  KnowledgeGraphPrefs,
  KnowledgeSearchScope,
} from "../../shared/types/app";

export const DEFAULT_KNOWLEDGE_SEARCH_SCOPE: KnowledgeSearchScope = "current";
export const KNOWLEDGE_GRAPH_NODE_OPTIONS = [250, 500, 1_000, 2_000] as const;
export const DEFAULT_KNOWLEDGE_GRAPH_PREFS: Required<KnowledgeGraphPrefs> = {
  maxVisibleNodes: 2_000,
  showLabels: true,
};

export type NormalizedKnowledgePrefs = {
  semanticModelReminderEnabled: boolean;
  defaultScope: KnowledgeSearchScope;
  backgroundIndexEnabled: boolean;
  graph: Required<KnowledgeGraphPrefs>;
};

export function normalizeKnowledgePrefs(
  uiPrefs: AppSettings["uiPrefs"] | null | undefined,
): NormalizedKnowledgePrefs {
  const rawScope = uiPrefs?.knowledgeDefaultScope;
  const rawMaxVisibleNodes = Number(
    uiPrefs?.knowledgeGraphPrefs?.maxVisibleNodes
      ?? DEFAULT_KNOWLEDGE_GRAPH_PREFS.maxVisibleNodes,
  );
  const maxVisibleNodes = Number.isFinite(rawMaxVisibleNodes)
    ? KNOWLEDGE_GRAPH_NODE_OPTIONS.reduce((closest, candidate) => (
        Math.abs(candidate - rawMaxVisibleNodes) < Math.abs(closest - rawMaxVisibleNodes)
          ? candidate
          : closest
      ), DEFAULT_KNOWLEDGE_GRAPH_PREFS.maxVisibleNodes)
    : DEFAULT_KNOWLEDGE_GRAPH_PREFS.maxVisibleNodes;
  return {
    semanticModelReminderEnabled:
      uiPrefs?.knowledgeSemanticModelReminderEnabled ?? true,
    defaultScope: rawScope === "all" ? "all" : DEFAULT_KNOWLEDGE_SEARCH_SCOPE,
    backgroundIndexEnabled: uiPrefs?.knowledgeBackgroundIndexEnabled ?? true,
    graph: {
      maxVisibleNodes,
      showLabels:
        uiPrefs?.knowledgeGraphPrefs?.showLabels
        ?? DEFAULT_KNOWLEDGE_GRAPH_PREFS.showLabels,
    },
  };
}
