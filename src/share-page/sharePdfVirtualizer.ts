export const SHARE_PDF_PAGE_GAP = 18;
export const SHARE_PDF_RENDER_BUFFER = 2;

export type SharePdfPageRange = {
  start: number;
  end: number;
};

export function clampSharePdfPage(page: number, pageCount: number): number {
  if (!Number.isFinite(page) || pageCount <= 0) {
    return 1;
  }
  return Math.max(1, Math.min(pageCount, Math.round(page)));
}

export function computeSharePdfPageTop(page: number, pageSlotHeight: number): number {
  return Math.max(0, page - 1) * Math.max(1, pageSlotHeight);
}

export function computeSharePdfTotalHeight(pageCount: number, pageSlotHeight: number): number {
  if (pageCount <= 0) {
    return 0;
  }
  return (pageCount - 1) * Math.max(1, pageSlotHeight) + Math.max(1, pageSlotHeight - SHARE_PDF_PAGE_GAP);
}

export function resolveVisibleSharePdfRange(params: {
  scrollTop: number;
  clientHeight: number;
  pageCount: number;
  pageSlotHeight: number;
  buffer?: number;
}): SharePdfPageRange {
  const { scrollTop, clientHeight, pageCount, pageSlotHeight } = params;
  if (pageCount <= 0) {
    return { start: 1, end: 0 };
  }
  const safeSlot = Math.max(1, pageSlotHeight);
  const buffer = Math.max(0, params.buffer ?? SHARE_PDF_RENDER_BUFFER);
  const start = Math.max(1, Math.floor(Math.max(0, scrollTop) / safeSlot) + 1 - buffer);
  const end = Math.min(
    pageCount,
    Math.ceil((Math.max(0, scrollTop) + Math.max(1, clientHeight)) / safeSlot) + buffer,
  );
  return { start, end: Math.max(start, end) };
}

export function resolveSharePdfPageFromScroll(params: {
  scrollTop: number;
  clientHeight: number;
  pageCount: number;
  pageSlotHeight: number;
}): number {
  const middle = Math.max(0, params.scrollTop) + Math.max(1, params.clientHeight) / 2;
  return clampSharePdfPage(Math.floor(middle / Math.max(1, params.pageSlotHeight)) + 1, params.pageCount);
}
