export type AnnotationPoint = {
  x: number;
  y: number;
};

export type AnnotationStrokeStyle = {
  color: string;
  width: number;
  opacity: number;
};

export type AnnotationStroke = {
  id: string;
  page: number;
  points: AnnotationPoint[];
  style: AnnotationStrokeStyle;
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
  version: 3;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
};

const DEFAULT_STROKE_STYLE: AnnotationStrokeStyle = {
  color: "#facc15",
  width: 16,
  opacity: 0.65,
};

const DEFAULT_TEXT_STYLE: AnnotationTextStyle = {
  fontSize: 14,
  textColor: "#1f2937",
  backgroundColor: "rgba(255,255,255,0.86)",
  borderColor: "#93c5fd",
};

export function createDefaultStrokeStyle(color?: string): AnnotationStrokeStyle {
  return {
    color: typeof color === "string" && color.trim().length > 0 ? color : DEFAULT_STROKE_STYLE.color,
    width: DEFAULT_STROKE_STYLE.width,
    opacity: DEFAULT_STROKE_STYLE.opacity,
  };
}

export function createDefaultTextStyle(textColor?: string): AnnotationTextStyle {
  return {
    ...DEFAULT_TEXT_STYLE,
    textColor:
      typeof textColor === "string" && textColor.trim().length > 0
        ? textColor
        : DEFAULT_TEXT_STYLE.textColor,
  };
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

function normalizeStrokeStyle(input: any): AnnotationStrokeStyle {
  const color =
    typeof input?.color === "string" && input.color.trim().length > 0
      ? input.color
      : DEFAULT_STROKE_STYLE.color;
  const width = Number(input?.width ?? DEFAULT_STROKE_STYLE.width);
  const opacity = Number(input?.opacity ?? DEFAULT_STROKE_STYLE.opacity);
  return {
    color,
    width: Number.isFinite(width) ? Math.max(6, Math.min(42, width)) : DEFAULT_STROKE_STYLE.width,
    opacity: Number.isFinite(opacity)
      ? Math.max(0.2, Math.min(1, opacity))
      : DEFAULT_STROKE_STYLE.opacity,
  };
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
          style: normalizeStrokeStyle(item?.style),
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
      version: 3,
      strokes,
      textBoxes,
    };
  } catch {
    return {
      version: 3,
      strokes: [],
      textBoxes: [],
    };
  }
}
