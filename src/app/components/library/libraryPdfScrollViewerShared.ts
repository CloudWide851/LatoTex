import type { MutableRefObject } from "react";
import type { PdfPageMetrics, PdfScrollAnchor } from "./libraryPdfScrollState";

export type LibraryPdfScrollSyncMessage = {
  revision: number;
  sourceId: string;
  anchor: PdfScrollAnchor;
};

export type LibraryPdfScrollSyncGroup = {
  viewers: Map<string, (message: LibraryPdfScrollSyncMessage) => void>;
  lastMessage: LibraryPdfScrollSyncMessage | null;
  nextRevision: number;
};

export function clampPdfScrollRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

export function maxPdfScrollTop(root: HTMLDivElement): number {
  return Math.max(0, root.scrollHeight - root.clientHeight);
}

export function ensurePdfScrollSyncGroup(
  syncGroupRef?: MutableRefObject<LibraryPdfScrollSyncGroup | null>,
): LibraryPdfScrollSyncGroup | null {
  if (!syncGroupRef) {
    return null;
  }
  if (!syncGroupRef.current) {
    syncGroupRef.current = {
      viewers: new Map(),
      lastMessage: null,
      nextRevision: 1,
    };
  }
  return syncGroupRef.current;
}

export function collectPdfPageMetrics(
  pageRefs: Record<number, HTMLDivElement | null>,
  pageCount: number,
): PdfPageMetrics[] {
  const metrics: PdfPageMetrics[] = [];
  for (let page = 1; page <= Math.max(1, pageCount); page += 1) {
    const node = pageRefs[page];
    if (!node) {
      continue;
    }
    metrics.push({
      page,
      top: node.offsetTop,
      height: node.offsetHeight,
    });
  }
  return metrics;
}
