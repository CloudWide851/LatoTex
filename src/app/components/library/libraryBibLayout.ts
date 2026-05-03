export const DEFAULT_LIBRARY_BIB_LAYOUT = [54, 46] as const;
const LIBRARY_BIB_MIN = [24, 22] as const;

export function normalizeLibraryBibLayout(layout?: number[] | null): [number, number] {
  if (!Array.isArray(layout) || layout.length !== 2) {
    return [...DEFAULT_LIBRARY_BIB_LAYOUT];
  }
  const values = layout.map((value) => Number(value));
  if (values.some((value) => !Number.isFinite(value) || value <= 0)) {
    return [...DEFAULT_LIBRARY_BIB_LAYOUT];
  }
  const total = values[0] + values[1];
  if (!Number.isFinite(total) || total <= 0) {
    return [...DEFAULT_LIBRARY_BIB_LAYOUT];
  }
  const normalized: [number, number] = [
    (values[0] / total) * 100,
    (values[1] / total) * 100,
  ];
  if (normalized[0] < LIBRARY_BIB_MIN[0] || normalized[1] < LIBRARY_BIB_MIN[1]) {
    return [...DEFAULT_LIBRARY_BIB_LAYOUT];
  }
  return normalized;
}

export function isPersistableLibraryBibLayout(layout: number[]): boolean {
  if (!Array.isArray(layout) || layout.length !== 2) {
    return false;
  }
  const normalized = normalizeLibraryBibLayout(layout);
  return normalized.every((value, index) => Math.abs(value - layout[index]) < 0.01);
}
