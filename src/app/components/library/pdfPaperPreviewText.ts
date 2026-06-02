export type PaperPreview = {
  title?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  pageCount?: number | null;
  excerpt?: string | null;
};

export function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

export function extractExcerpt(text: string, fallbackTitle?: string | null): string {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }
  const withoutTitle = fallbackTitle
    ? normalized.replace(new RegExp(`^${fallbackTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    : normalized;
  const abstractMatch = withoutTitle.match(/(?:^|\b)(abstract|摘要)\s*[:.\-]?\s*([\s\S]{80,800})/i);
  if (abstractMatch?.[2]) {
    return normalizeText(
      abstractMatch[2].split(/\b(?:keywords?|index terms|introduction|1\s+[A-Z])/i, 1)[0] ?? "",
    ).slice(0, 520);
  }
  return withoutTitle.slice(0, 520);
}
