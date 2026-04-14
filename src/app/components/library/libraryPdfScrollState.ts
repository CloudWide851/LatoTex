export type PdfPageMetrics = {
  page: number;
  top: number;
  height: number;
};

export type PdfScrollAnchor = {
  page: number;
  pageFocusRatio: number;
  absoluteRatio: number;
};

function normalizedHeight(height: number): number {
  return Number.isFinite(height) && height > 0 ? height : 0;
}

export function resolveVisiblePdfPage(
  metrics: PdfPageMetrics[],
  scrollTop: number,
  clientHeight: number,
): number {
  if (metrics.length === 0) {
    return 1;
  }
  const focusY = Math.max(0, scrollTop) + Math.max(0, clientHeight) * 0.35;
  let fallbackPage = metrics[0]?.page ?? 1;
  let smallestDistance = Number.POSITIVE_INFINITY;

  for (const metric of metrics) {
    const height = normalizedHeight(metric.height);
    const top = Math.max(0, metric.top);
    const bottom = top + height;
    if (height > 0 && focusY >= top && focusY < bottom) {
      return metric.page;
    }
    const distance = focusY < top ? top - focusY : Math.max(0, focusY - bottom);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      fallbackPage = metric.page;
    }
  }

  return fallbackPage;
}

export function resolvePdfScrollAnchor(
  metrics: PdfPageMetrics[],
  scrollTop: number,
  clientHeight: number,
  absoluteRatio: number,
): PdfScrollAnchor {
  if (metrics.length === 0) {
    return {
      page: 1,
      pageFocusRatio: 0,
      absoluteRatio: Number.isFinite(absoluteRatio) ? Math.max(0, Math.min(1, absoluteRatio)) : 0,
    };
  }

  const focusY = Math.max(0, scrollTop) + Math.max(0, clientHeight) * 0.35;
  let fallback = metrics[0] ?? { page: 1, top: 0, height: 0 };
  let smallestDistance = Number.POSITIVE_INFINITY;

  for (const metric of metrics) {
    const height = normalizedHeight(metric.height);
    const top = Math.max(0, metric.top);
    const bottom = top + height;
    if (height > 0 && focusY >= top && focusY < bottom) {
      return {
        page: metric.page,
        pageFocusRatio: Math.max(0, Math.min(1, (focusY - top) / height)),
        absoluteRatio: Number.isFinite(absoluteRatio) ? Math.max(0, Math.min(1, absoluteRatio)) : 0,
      };
    }
    const distance = focusY < top ? top - focusY : Math.max(0, focusY - bottom);
    if (distance < smallestDistance) {
      smallestDistance = distance;
      fallback = metric;
    }
  }

  const fallbackHeight = normalizedHeight(fallback.height);
  return {
    page: fallback.page,
    pageFocusRatio: fallbackHeight > 0 ? Math.max(0, Math.min(1, (focusY - fallback.top) / fallbackHeight)) : 0,
    absoluteRatio: Number.isFinite(absoluteRatio) ? Math.max(0, Math.min(1, absoluteRatio)) : 0,
  };
}

export function resolveScrollTopForPdfAnchor(
  metrics: PdfPageMetrics[],
  anchor: PdfScrollAnchor,
  clientHeight: number,
  maxScrollTop: number,
): number {
  const normalizedAbsoluteRatio = Number.isFinite(anchor.absoluteRatio)
    ? Math.max(0, Math.min(1, anchor.absoluteRatio))
    : 0;
  const metric = metrics.find((entry) => entry.page === anchor.page);
  const height = normalizedHeight(metric?.height ?? 0);
  if (!metric || height <= 0) {
    return normalizedAbsoluteRatio * Math.max(0, maxScrollTop);
  }
  const focusRatio = Number.isFinite(anchor.pageFocusRatio)
    ? Math.max(0, Math.min(1, anchor.pageFocusRatio))
    : 0;
  const focusY = metric.top + height * focusRatio;
  return Math.max(0, Math.min(Math.max(0, maxScrollTop), focusY - Math.max(0, clientHeight) * 0.35));
}
