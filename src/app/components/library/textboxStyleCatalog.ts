import { runtimeSystemFontProbe } from "../../../shared/api/runtimeFontProbe";

const FONT_CACHE_KEY = "latotex.textbox.fonts.v1";
const FONT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export const DEFAULT_TEXTBOX_FONT_FAMILIES = [
  "Segoe UI",
  "Arial",
  "Times New Roman",
  "Consolas",
  "Calibri",
  "Microsoft YaHei",
  "Noto Sans SC",
];

export const TEXTBOX_FONT_SIZES = [
  10, 11, 12, 13, 14, 16, 18, 20, 24, 28, 32, 36, 48, 60, 72,
];

export const TEXTBOX_COLOR_PALETTE = [
  "#0f172a", "#1e293b", "#334155", "#475569", "#64748b",
  "#111827", "#1d4ed8", "#2563eb", "#0f766e", "#059669",
  "#16a34a", "#65a30d", "#ca8a04", "#ea580c", "#dc2626",
  "#be123c", "#c026d3", "#7c3aed", "#4f46e5", "#0891b2",
];

type CachedFontPayload = {
  fonts: string[];
  savedAt: number;
};

function normalizeFonts(fonts: string[]): string[] {
  return Array.from(new Set(
    fonts
      .map((item) => item.trim())
      .filter((item) => item.length > 0),
  )).sort((left, right) => left.localeCompare(right));
}

function readCachedFonts(): string[] {
  if (typeof window === "undefined") {
    return [];
  }
  try {
    const raw = window.localStorage.getItem(FONT_CACHE_KEY);
    if (!raw) {
      return [];
    }
    const parsed = JSON.parse(raw) as Partial<CachedFontPayload>;
    if (!Array.isArray(parsed.fonts) || typeof parsed.savedAt !== "number") {
      return [];
    }
    if (Date.now() - parsed.savedAt > FONT_CACHE_TTL_MS) {
      return [];
    }
    return normalizeFonts(parsed.fonts);
  } catch {
    return [];
  }
}

function writeCachedFonts(fonts: string[]) {
  if (typeof window === "undefined") {
    return;
  }
  const payload: CachedFontPayload = {
    fonts: normalizeFonts(fonts),
    savedAt: Date.now(),
  };
  window.localStorage.setItem(FONT_CACHE_KEY, JSON.stringify(payload));
}

export async function resolveTextBoxFontFamilies(): Promise<string[]> {
  const cached = readCachedFonts();
  if (cached.length > 0) {
    return cached;
  }
  try {
    const probe = await runtimeSystemFontProbe([]);
    const resolved = normalizeFonts([
      ...DEFAULT_TEXTBOX_FONT_FAMILIES,
      ...(Array.isArray(probe.installedFonts) ? probe.installedFonts : []),
    ]);
    writeCachedFonts(resolved);
    return resolved;
  } catch {
    return DEFAULT_TEXTBOX_FONT_FAMILIES;
  }
}
