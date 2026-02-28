export const HIGHLIGHT_COLORS = [
  "#facc15",
  "#22c55e",
  "#38bdf8",
  "#f97316",
  "#e879f9",
  "#fb7185",
] as const;

export const TEXT_COLORS = [
  "#111827",
  "#334155",
  "#1d4ed8",
  "#047857",
  "#b45309",
  "#be123c",
] as const;

function normalizeHex(hex: string): string {
  const value = hex.trim().replace("#", "");
  if (value.length === 3) {
    return value
      .split("")
      .map((part) => `${part}${part}`)
      .join("");
  }
  if (value.length === 6) {
    return value;
  }
  return "facc15";
}

export function hexToRgba(hex: string, alpha: number): string {
  const normalized = normalizeHex(hex);
  const r = parseInt(normalized.slice(0, 2), 16);
  const g = parseInt(normalized.slice(2, 4), 16);
  const b = parseInt(normalized.slice(4, 6), 16);
  const a = Math.max(0, Math.min(1, Number.isFinite(alpha) ? alpha : 1));
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}
