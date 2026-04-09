export type PdfPageMetrics = {
  page: number;
  top: number;
  height: number;
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
