export function filenameFromPath(path: string | null): string {
  if (!path) {
    return "";
  }
  const parts = path.split("/");
  return parts[parts.length - 1] ?? path;
}

export function buildPdfSrc(pdfUrl: string, page: number, zoom: number, qualityScale = 1): string {
  const normalizedPage = Math.max(1, Math.floor(page));
  const normalizedZoom = Math.max(40, Math.min(400, Math.round(zoom * qualityScale * 100)));
  return `${pdfUrl}#page=${normalizedPage}&zoom=${normalizedZoom}`;
}
