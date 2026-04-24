import { useCallback, useEffect, useRef, useState, type MutableRefObject, type PointerEvent as ReactPointerEvent } from "react";
import type { AnnotationPoint, AnnotationTextBox } from "./annotationModel";
import { resolveDraggedBox, toNormalizedPoint, type DragPreview, type DragState } from "./pdfAnnotationLayerUtils";

const TEXTBOX_TRANSFORM_DRAG_THRESHOLD = 10;

type TransformStartEvent = ReactPointerEvent<HTMLButtonElement>;

function isPointerLikeEvent(event: Event | MouseEvent | PointerEvent): event is PointerEvent {
  return event.type.startsWith("pointer") && typeof (event as PointerEvent).pointerId === "number";
}

export function usePdfTextBoxTransform(params: {
  layerRef: MutableRefObject<HTMLDivElement | null>;
  onCommit: (preview: DragPreview) => void;
}) {
  const { layerRef, onCommit } = params;
  const dragStateRef = useRef<DragState | null>(null);
  const dragPointRef = useRef<AnnotationPoint | null>(null);
  const dragActivatedRef = useRef(false);
  const dragFrameRef = useRef<number | null>(null);
  const pointerCaptureTargetRef = useRef<HTMLElement | null>(null);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

  const clearBodyDragStyles = useCallback(() => {
    if (typeof document === "undefined") {
      return;
    }
    document.body.style.removeProperty("user-select");
    document.body.style.removeProperty("cursor");
  }, []);

  const clearPointerCapture = useCallback(() => {
    const target = pointerCaptureTargetRef.current;
    const drag = dragStateRef.current;
    if (target && drag?.inputKind === "pointer") {
      try {
        target.releasePointerCapture(drag.pointerId);
      } catch {
        // ignore stale capture cleanup
      }
    }
    pointerCaptureTargetRef.current = null;
  }, []);

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent | MouseEvent) => {
      const drag = dragStateRef.current;
      const rect = layerRef.current?.getBoundingClientRect();
      if (!drag || !rect) {
        return;
      }
      if (drag.inputKind === "pointer") {
        if (!isPointerLikeEvent(event) || event.pointerId !== drag.pointerId) {
          return;
        }
      } else if (isPointerLikeEvent(event)) {
        return;
      }
      const nextPoint = toNormalizedPoint(event, rect);
      if (!dragActivatedRef.current) {
        const dx = event.clientX - drag.startClientX;
        const dy = event.clientY - drag.startClientY;
        if (Math.hypot(dx, dy) < TEXTBOX_TRANSFORM_DRAG_THRESHOLD) {
          dragPointRef.current = null;
          return;
        }
        dragActivatedRef.current = true;
      }
      dragPointRef.current = nextPoint;
      if (dragFrameRef.current !== null) {
        return;
      }
      dragFrameRef.current = window.requestAnimationFrame(() => {
        dragFrameRef.current = null;
        const activeDrag = dragStateRef.current;
        const point = dragPointRef.current;
        if (!activeDrag || !point) {
          return;
        }
        setDragPreview(resolveDraggedBox(activeDrag, point));
      });
    };

    const handlePointerEnd = (event: PointerEvent | MouseEvent) => {
      const drag = dragStateRef.current;
      if (!drag) {
        return;
      }
      if (drag.inputKind === "pointer") {
        if (!isPointerLikeEvent(event) || event.pointerId !== drag.pointerId) {
          return;
        }
      } else if (isPointerLikeEvent(event)) {
        return;
      }
      const point = dragPointRef.current;
      if (dragActivatedRef.current && point) {
        onCommit(resolveDraggedBox(drag, point));
      }
      dragStateRef.current = null;
      dragPointRef.current = null;
      dragActivatedRef.current = false;
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      setDragPreview(null);
      clearPointerCapture();
      clearBodyDragStyles();
    };

    const handleWindowBlur = () => {
      const drag = dragStateRef.current;
      if (!drag) {
        return;
      }
      if (dragActivatedRef.current && dragPointRef.current) {
        onCommit(resolveDraggedBox(drag, dragPointRef.current));
      }
      dragStateRef.current = null;
      dragPointRef.current = null;
      dragActivatedRef.current = false;
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      setDragPreview(null);
      clearPointerCapture();
      clearBodyDragStyles();
    };

    window.addEventListener("pointermove", handlePointerMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("mousemove", handlePointerMove);
    window.addEventListener("mouseup", handlePointerEnd);
    window.addEventListener("blur", handleWindowBlur);
    return () => {
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("pointerup", handlePointerEnd);
      window.removeEventListener("pointercancel", handlePointerEnd);
      window.removeEventListener("mousemove", handlePointerMove);
      window.removeEventListener("mouseup", handlePointerEnd);
      window.removeEventListener("blur", handleWindowBlur);
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      dragStateRef.current = null;
      dragPointRef.current = null;
      dragActivatedRef.current = false;
      setDragPreview(null);
      clearPointerCapture();
      clearBodyDragStyles();
    };
  }, [clearBodyDragStyles, clearPointerCapture, layerRef, onCommit]);

  const beginTextBoxTransform = useCallback((mode: "move" | "resize", event: TransformStartEvent, box: AnnotationTextBox) => {
    const rect = layerRef.current?.getBoundingClientRect();
    if (!rect) {
      return false;
    }
    dragStateRef.current = {
      inputKind: "pointer",
      pointerId: event.nativeEvent.pointerId,
      mode,
      boxId: box.id,
      start: toNormalizedPoint(event, rect),
      startClientX: event.clientX,
      startClientY: event.clientY,
      initial: box,
    };
    dragActivatedRef.current = false;
    dragPointRef.current = null;
    setDragPreview(null);
    pointerCaptureTargetRef.current = event.currentTarget instanceof HTMLElement ? event.currentTarget : null;
    if (event.currentTarget instanceof HTMLElement) {
      try {
        event.currentTarget.setPointerCapture(event.nativeEvent.pointerId);
      } catch {
        pointerCaptureTargetRef.current = null;
      }
    }
    if (typeof document !== "undefined") {
      document.body.style.setProperty("user-select", "none");
      document.body.style.setProperty("cursor", mode === "move" ? "move" : "nwse-resize");
    }
    return true;
  }, [layerRef]);

  return {
    dragPreview,
    beginTextBoxTransform,
  };
}
