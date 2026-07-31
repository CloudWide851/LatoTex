export type KnowledgeSourceKind = "markdown" | "text" | "docx" | "pdf";
export type KnowledgeIndexState = "pending" | "indexing" | "ready" | "stale" | "failed";

export type KnowledgeAnchor = {
  kind: "lines" | "page" | "paragraph" | "table" | string;
  value: string;
  page?: number | null;
  lineStart?: number | null;
  lineEnd?: number | null;
  heading?: string | null;
};

export type KnowledgeItem = {
  itemId: string;
  projectId: string;
  relativePath: string;
  title: string;
  sourceKind: KnowledgeSourceKind;
  contentHash: string;
  indexState: KnowledgeIndexState;
  chunkCount: number;
  locked: boolean;
  updatedAt: string;
  failureCode?: string | null;
};

export type KnowledgeArchiveResponse = {
  item: KnowledgeItem;
  semanticAvailable: boolean;
  semanticReminder: boolean;
};

export type KnowledgeCitation = {
  citationId: string;
  projectId: string;
  itemId: string;
  title: string;
  relativePath: string;
  sourceKind: KnowledgeSourceKind;
  anchor: KnowledgeAnchor;
  snippet: string;
  url?: string | null;
};

export type KnowledgeSearchHit = {
  evidenceId: string;
  projectId: string;
  itemId: string;
  title: string;
  relativePath: string;
  sourceKind: KnowledgeSourceKind;
  anchor: KnowledgeAnchor;
  snippet: string;
  score: number;
  matchKinds: Array<"exact" | "bm25" | "semantic" | "graph" | "adjacent" | string>;
  citation: KnowledgeCitation;
};

export type EmbeddingRuntimeStatus = {
  pluginId: string;
  installed: boolean;
  available: boolean;
  modelFingerprint?: string | null;
  indexFingerprint?: string | null;
  rebuildRequired: boolean;
  mode: "lexical" | "hybrid";
};

export type KnowledgeEmbeddingJobStatus = {
  state: "idle" | "queued" | "indexing" | "paused" | "ready" | "failed" | string;
  processed: number;
  total: number;
  generation?: string | null;
  failureCode?: string | null;
};

export type KnowledgeSearchResponse = {
  runId: string;
  hits: KnowledgeSearchHit[];
  strategy: string;
  embedding: EmbeddingRuntimeStatus;
  lexicalElapsedMs: number;
  semanticElapsedMs: number;
  elapsedMs: number;
};

export type KnowledgeFetchResponse = {
  evidenceId: string;
  text: string;
  citation: KnowledgeCitation;
};

export type KnowledgeGraphNode = {
  id: string;
  kind: "document" | "topic" | "citation" | string;
  label: string;
  confidence: number;
  itemId?: string | null;
};

export type KnowledgeGraphEdge = {
  id: string;
  source: string;
  target: string;
  kind: string;
  confidence: number;
};

export type KnowledgeGraphResponse = {
  nodes: KnowledgeGraphNode[];
  edges: KnowledgeGraphEdge[];
  aggregated: boolean;
  totalNodes: number;
};

export type KnowledgeTopic = {
  topicId: string;
  label: string;
  source: "auto" | "manual" | string;
  confidence: number;
  hidden: boolean;
  manual: boolean;
  linkCount: number;
};

export type KnowledgeMutationApproval = {
  token: string;
  expiresAtUnixMs: number;
  contentVersion: string;
};

export type KnowledgeMutationPreview = {
  required: boolean;
  affectedItems: KnowledgeItem[];
  approval?: KnowledgeMutationApproval | null;
};

export type ResearchAnswerEnvelope = {
  projectId: string;
  claims: Array<{
    text: string;
    kind: "fact" | "inference" | "uncertainty";
    citationIds: string[];
  }>;
};

export type ResearchAnswerValidation = {
  valid: boolean;
  unsupportedClaims: number[];
  invalidCitationIds: string[];
};
