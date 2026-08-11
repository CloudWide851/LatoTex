import type {
  KnowledgeAnchor,
  KnowledgeDocumentFocusRequest,
  KnowledgeSearchHit,
} from "../../../shared/types/app";

export function formatKnowledgeAnchor(anchor?: KnowledgeAnchor | null): string {
  if (!anchor) {
    return "";
  }
  if (anchor.page) {
    return `p.${anchor.page}`;
  }
  if (anchor.lineStart) {
    return anchor.lineEnd && anchor.lineEnd !== anchor.lineStart
      ? `L${anchor.lineStart}–${anchor.lineEnd}`
      : `L${anchor.lineStart}`;
  }
  return anchor.heading || anchor.value;
}

export function createKnowledgeFocusRequest(
  hit: KnowledgeSearchHit,
  token: number,
): KnowledgeDocumentFocusRequest {
  return {
    token,
    projectId: hit.projectId,
    path: hit.relativePath,
    evidenceId: hit.evidenceId,
    anchor: hit.anchor,
    snippet: hit.snippet,
  };
}

export function knowledgeFocusLine(
  request?: KnowledgeDocumentFocusRequest | null,
): number | null {
  const line = request?.anchor?.lineStart;
  return typeof line === "number" && Number.isFinite(line) && line > 0
    ? Math.floor(line)
    : null;
}

export function knowledgeFocusPage(
  request?: KnowledgeDocumentFocusRequest | null,
): number | null {
  const page = request?.anchor?.page;
  return typeof page === "number" && Number.isFinite(page) && page > 0
    ? Math.floor(page)
    : null;
}
