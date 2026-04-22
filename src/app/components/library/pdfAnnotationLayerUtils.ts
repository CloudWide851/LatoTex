import {
  clampDimension,
  clampNormalized,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationTextBox,
} from "./annotationModel";

export type DragMode = "move" | "resize";

export type DragState = {
  inputKind: "mouse" | "pointer";
  pointerId: number;
  mode: DragMode;
  boxId: string;
  start: AnnotationPoint;
  startClientX: number;
  startClientY: number;
  initial: AnnotationTextBox;
};

export type DragPreview = {
  boxId: string;
  x: number;
  y: number;
  w: number;
  h: number;
};

export const HIGHLIGHT_CURSOR = `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'%3E%3Crect x='2' y='2' width='10' height='22' rx='3' fill='%23facc15' stroke='%23b45309' stroke-width='1.4'/%3E%3Crect x='12' y='17' width='12' height='7' rx='2' fill='%23fef3c7' stroke='%23b45309' stroke-width='1.2'/%3E%3C/svg%3E") 4 22, crosshair`;

export const ERASER_CURSOR = `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'%3E%3Crect x='4' y='11' width='16' height='10' rx='2.2' transform='rotate(-28 12 16)' fill='%23f8fafc' stroke='%23475569' stroke-width='1.4'/%3E%3Cpath d='M7 20h12' stroke='%23e2e8f0' stroke-width='1.6' stroke-linecap='round'/%3E%3C/svg%3E") 6 20, auto`;

export function toNormalizedPoint(
  event: { clientX: number; clientY: number },
  rect: DOMRect,
): AnnotationPoint {
  const x = ((event.clientX - rect.left) / rect.width) * 1000;
  const y = ((event.clientY - rect.top) / rect.height) * 1000;
  return {
    x: clampNormalized(x),
    y: clampNormalized(y),
  };
}

export function clampPoint(point: AnnotationPoint): AnnotationPoint {
  return {
    x: clampNormalized(point.x),
    y: clampNormalized(point.y),
  };
}

export function nextTextBoxZ(textBoxes: AnnotationTextBox[]): number {
  if (textBoxes.length === 0) {
    return 1;
  }
  return Math.max(...textBoxes.map((item) => item.z || 1)) + 1;
}

export function distanceToStroke(point: AnnotationPoint, stroke: AnnotationStroke): number {
  let min = Number.POSITIVE_INFINITY;
  for (const p of stroke.points) {
    const dx = point.x - p.x;
    const dy = point.y - p.y;
    const dist = Math.sqrt(dx * dx + dy * dy);
    if (dist < min) {
      min = dist;
    }
  }
  return min;
}

export function bringBoxToFront(textBoxes: AnnotationTextBox[], boxId: string): AnnotationTextBox[] {
  const nextZ = nextTextBoxZ(textBoxes);
  return textBoxes.map((item) => (item.id === boxId ? { ...item, z: nextZ } : item));
}

export function resolveDraggedBox(drag: DragState, point: AnnotationPoint): DragPreview {
  const dx = point.x - drag.start.x;
  const dy = point.y - drag.start.y;
  if (drag.mode === "move") {
    return {
      boxId: drag.boxId,
      x: clampNormalized(drag.initial.x + dx),
      y: clampNormalized(drag.initial.y + dy),
      w: drag.initial.w,
      h: drag.initial.h,
    };
  }
  return {
    boxId: drag.boxId,
    x: drag.initial.x,
    y: drag.initial.y,
    w: clampDimension(drag.initial.w + dx),
    h: clampDimension(drag.initial.h + dy),
  };
}

export function resolveMenuAnchor(input: {
  menuOpen: boolean;
  layerRect: DOMRect | null;
  layerSize: { width: number; height: number };
  menuBox: AnnotationTextBox | null;
  dragPreview: DragPreview | null;
}): { x: number; y: number } | null {
  const { menuOpen, layerRect, layerSize, menuBox, dragPreview } = input;
  if (!menuOpen || !menuBox || !layerRect || layerSize.width <= 0 || layerSize.height <= 0) {
    return null;
  }
  const menuWidth = 288;
  const menuHeight = 248;
  const padding = 8;
  const activeBox =
    dragPreview?.boxId === menuBox.id
      ? { ...menuBox, ...dragPreview }
      : menuBox;
  const boxLeft = (activeBox.x / 1000) * layerSize.width;
  const boxTop = (activeBox.y / 1000) * layerSize.height;
  const boxRight = ((activeBox.x + activeBox.w) / 1000) * layerSize.width;
  const boxBottom = ((activeBox.y + activeBox.h) / 1000) * layerSize.height;
  let x = Math.round(boxRight + 10);
  let y = Math.round(boxTop);
  if (x + menuWidth > layerSize.width - padding) {
    x = Math.round(boxLeft - menuWidth - 10);
  }
  if (x < padding) {
    x = Math.max(padding, layerSize.width - menuWidth - padding);
  }
  if (y + menuHeight > layerSize.height - padding) {
    y = Math.round(boxBottom - menuHeight);
  }
  if (y < padding) {
    y = padding;
  }
  y = Math.min(y, Math.max(padding, layerSize.height - menuHeight - padding));
  return {
    x: Math.round(layerRect.left + x),
    y: Math.round(layerRect.top + y),
  };
}
