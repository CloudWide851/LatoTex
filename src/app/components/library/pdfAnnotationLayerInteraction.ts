import { createDefaultStrokeStyle, type AnnotationPoint, type AnnotationStroke } from "./annotationModel";
import { clampPoint } from "./pdfAnnotationLayerUtils";

export function getAnnotationEditingBox(layer: HTMLDivElement | null, boxId: string) {
  return layer?.querySelector<HTMLDivElement>(`[data-editing-box='${boxId}']`) ?? null;
}

export function focusAnnotationEditingBox(layer: HTMLDivElement | null, boxId: string) {
  if (typeof window === "undefined") {
    return;
  }
  const target = getAnnotationEditingBox(layer, boxId);
  if (!target) {
    return;
  }
  target.focus();
  const range = document.createRange();
  range.selectNodeContents(target);
  range.collapse(false);
  const selection = window.getSelection();
  selection?.removeAllRanges();
  selection?.addRange(range);
}

export function buildAnnotationStroke(args: {
  points: AnnotationPoint[];
  page: number;
  highlightColor: string;
  highlightWidth: number;
  highlightOpacity: number;
}): AnnotationStroke {
  const { points, page, highlightColor, highlightWidth, highlightOpacity } = args;
  return {
    id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
    page,
    points: points.map(clampPoint),
    style: createDefaultStrokeStyle(highlightColor, {
      width: highlightWidth,
      opacity: highlightOpacity,
    }),
  };
}
