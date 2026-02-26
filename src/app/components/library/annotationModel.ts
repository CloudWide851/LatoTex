export type AnnotationPoint = {
  x: number;
  y: number;
};

export type AnnotationStroke = {
  id: string;
  page: number;
  points: AnnotationPoint[];
};

export type AnnotationTextStyle = {
  fontSize: number;
  textColor: string;
  backgroundColor: string;
  borderColor: string;
};

export type AnnotationTextBox = {
  id: string;
  page: number;
  x: number;
  y: number;
  w: number;
  h: number;
  z: number;
  content: string;
  style: AnnotationTextStyle;
};

export type AnnotationPayload = {
  version: 2;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
};

const DEFAULT_TEXT_STYLE: AnnotationTextStyle = {
  fontSize: 14,
  textColor: "#1f2937",
  backgroundColor: "rgba(255,255,255,0.86)",
  borderColor: "#93c5fd",
};

export function createDefaultTextStyle(): AnnotationTextStyle {
  return { ...DEFAULT_TEXT_STYLE };
}

export function clampNormalized(value: number): number {
  return Math.max(0, Math.min(1000, Number(value.toFixed(2))));
}

export function clampDimension(value: number): number {
  return Math.max(48, Math.min(1000, Number(value.toFixed(2))));
}

export function toLibraryAnnotationPath(selectedPath: string): string {
  const normalized = selectedPath.trim().toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "library";
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  return `.latotex/papers/.annotations/${safe}-${digest}.json`;
}

function normalizePoint(input: any): AnnotationPoint | null {
  const x = Number(input?.x ?? 0);
  const y = Number(input?.y ?? 0);
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return null;
  }
  return { x: clampNormalized(x), y: clampNormalized(y) };
}

export function parseAnnotationPayload(content: string): AnnotationPayload {
  try {
    const parsed = JSON.parse(content) as any;
    const rawStrokes = Array.isArray(parsed?.strokes) ? parsed.strokes : [];
    const strokes: AnnotationStroke[] = rawStrokes
      .map((item: any, index: number) => {
        const points = Array.isArray(item?.points)
          ? item.points.map(normalizePoint).filter((point: AnnotationPoint | null): point is AnnotationPoint => Boolean(point))
          : [];
        if (points.length < 2) {
          return null;
        }
        const page = Number(item?.page ?? 1);
        return {
          id: typeof item?.id === "string" && item.id ? item.id : `stroke-${index}`,
          page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
          points,
        } as AnnotationStroke;
      })
      .filter((item: AnnotationStroke | null): item is AnnotationStroke => Boolean(item));

    const rawTextBoxes = Array.isArray(parsed?.textBoxes) ? parsed.textBoxes : [];
    const textBoxes: AnnotationTextBox[] = rawTextBoxes
      .map((item: any, index: number) => {
        const page = Number(item?.page ?? 1);
        const z = Number(item?.z ?? index + 1);
        return {
          id: typeof item?.id === "string" && item.id ? item.id : `textbox-${index}`,
          page: Number.isFinite(page) && page > 0 ? Math.floor(page) : 1,
          x: clampNormalized(Number(item?.x ?? 120)),
          y: clampNormalized(Number(item?.y ?? 120)),
          w: clampDimension(Number(item?.w ?? 260)),
          h: clampDimension(Number(item?.h ?? 160)),
          z: Number.isFinite(z) ? Math.floor(z) : index + 1,
          content: String(item?.content ?? ""),
          style: {
            fontSize: Number(item?.style?.fontSize ?? DEFAULT_TEXT_STYLE.fontSize),
            textColor: String(item?.style?.textColor ?? DEFAULT_TEXT_STYLE.textColor),
            backgroundColor: String(item?.style?.backgroundColor ?? DEFAULT_TEXT_STYLE.backgroundColor),
            borderColor: String(item?.style?.borderColor ?? DEFAULT_TEXT_STYLE.borderColor),
          },
        } as AnnotationTextBox;
      });

    return {
      version: 2,
      strokes,
      textBoxes,
    };
  } catch {
    return {
      version: 2,
      strokes: [],
      textBoxes: [],
    };
  }
}
