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

export function estimatePdfPageCountFromBytes(bytes: Uint8Array): number {
  if (!bytes || bytes.length === 0) {
    return 1;
  }
  try {
    const text = new TextDecoder("latin1").decode(bytes);
    const matches = text.match(/\/Type\s*\/Page\b/g);
    const estimated = matches?.length ?? 0;
    return Math.max(1, Math.min(estimated || 1, 300));
  } catch {
    return 1;
  }
}
