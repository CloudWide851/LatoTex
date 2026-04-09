import hljs from "highlight.js";
import type { CodeLanguageInfo } from "../../shared/utils/codeLanguage";

type HighlightCacheEntry = {
  html: string;
};

const MAX_HIGHLIGHT_CACHE_ENTRIES = 48;
const MAX_HIGHLIGHT_CHARS = 120_000;
const MAX_HIGHLIGHT_LINE_LENGTH = 4_000;
const highlightCache = new Map<string, HighlightCacheEntry>();

export function escapePreviewHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function buildSourceStamp(source: string): string {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${source.length}:${hash >>> 0}`;
}

function shouldSkipHighlight(source: string): boolean {
  if (source.length > MAX_HIGHLIGHT_CHARS) {
    return true;
  }
  const lines = source.split("\n");
  return lines.some((line) => line.length > MAX_HIGHLIGHT_LINE_LENGTH);
}

function readCached(cacheKey: string): string | null {
  const cached = highlightCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  highlightCache.delete(cacheKey);
  highlightCache.set(cacheKey, cached);
  return cached.html;
}

function writeCached(cacheKey: string, html: string): string {
  highlightCache.set(cacheKey, { html });
  while (highlightCache.size > MAX_HIGHLIGHT_CACHE_ENTRIES) {
    const oldestKey = highlightCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    highlightCache.delete(oldestKey);
  }
  return html;
}

export function clearCodePreviewHighlightCache() {
  highlightCache.clear();
}

export function renderCodePreviewHtml(
  source: string,
  language: CodeLanguageInfo,
  languageTag: string,
  filePath?: string | null,
): string {
  if (!source.trim()) {
    return "";
  }
  const cacheKey = [
    normalizeCachePart(filePath),
    languageTag,
    language.highlight,
    buildSourceStamp(source),
  ].join(":");
  if (shouldSkipHighlight(source) || !language.highlight || !hljs.getLanguage(language.highlight)) {
    const cached = readCached(cacheKey);
    if (cached !== null) {
      return cached;
    }
    return writeCached(cacheKey, escapePreviewHtml(source));
  }
  const cached = readCached(cacheKey);
  if (cached !== null) {
    return cached;
  }
  const highlighted = hljs.highlight(source, {
    language: language.highlight,
    ignoreIllegals: true,
  }).value;
  return writeCached(cacheKey, highlighted);
}

function normalizeCachePart(value: string | null | undefined): string {
  return String(value ?? "").trim().replace(/\\/g, "/");
}
