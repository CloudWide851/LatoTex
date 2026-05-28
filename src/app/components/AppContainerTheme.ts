export const ACCENT_COLORS: Record<string, string> = {
  emerald: "#22c55e",
  blue: "#3b82f6",
  violet: "#8b5cf6",
  rose: "#f43f5e",
  amber: "#f59e0b",
};

export const THEME_PRESETS: Record<string, {
  accent: string;
  background: string;
  surface: string;
  scrollbarTrack: string;
}> = {
  default: { accent: ACCENT_COLORS.emerald, background: "#f1f5f9", surface: "#ffffff", scrollbarTrack: "#e2e8f0" },
  graphite: { accent: "#475569", background: "#e5e7eb", surface: "#f8fafc", scrollbarTrack: "#cbd5e1" },
  paper: { accent: "#b45309", background: "#f5f1e8", surface: "#fffaf0", scrollbarTrack: "#e7dcc6" },
  forest: { accent: "#15803d", background: "#edf7ef", surface: "#fbfff9", scrollbarTrack: "#cfe8d3" },
  ocean: { accent: "#0284c7", background: "#edf7fb", surface: "#f8fdff", scrollbarTrack: "#cfe7f3" },
  rose: { accent: "#e11d48", background: "#fff1f5", surface: "#fffafb", scrollbarTrack: "#f8cddd" },
  amber: { accent: "#d97706", background: "#fff7ed", surface: "#fffdf7", scrollbarTrack: "#f5d8aa" },
  highContrast: { accent: "#0f172a", background: "#f8fafc", surface: "#ffffff", scrollbarTrack: "#94a3b8" },
};

function clampCropRect(value: unknown) {
  const rect = value && typeof value === "object" ? value as { x?: unknown; y?: unknown; width?: unknown; height?: unknown } : {};
  const x = Math.max(0, Math.min(0.95, Number(rect.x ?? 0)));
  const y = Math.max(0, Math.min(0.95, Number(rect.y ?? 0)));
  const width = Math.max(0.05, Math.min(1 - x, Number(rect.width ?? 1)));
  const height = Math.max(0.05, Math.min(1 - y, Number(rect.height ?? 1)));
  return { x, y, width, height };
}

export function cropBackgroundStyle(path: string, cropByPath: unknown) {
  const map = cropByPath && typeof cropByPath === "object" ? cropByPath as Record<string, unknown> : {};
  const crop = clampCropRect(map[path]);
  const xDenominator = Math.max(0.0001, 1 - crop.width);
  const yDenominator = Math.max(0.0001, 1 - crop.height);
  return {
    backgroundSize: `${(100 / crop.width).toFixed(3)}% ${(100 / crop.height).toFixed(3)}%`,
    backgroundPosition: `${((crop.x / xDenominator) * 100).toFixed(3)}% ${((crop.y / yDenominator) * 100).toFixed(3)}%`,
  };
}
