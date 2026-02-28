import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampDimension,
  clampNormalized,
  createDefaultStrokeStyle,
  createDefaultTextStyle,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationTextBox,
} from "./annotationModel";
import { hexToRgba } from "./annotationPalette";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type DragMode = "move" | "resize";

type DragState = {
  mode: DragMode;
  boxId: string;
  start: AnnotationPoint;
  initial: AnnotationTextBox;
};

function toNormalizedPoint(
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

function clampPoint(point: AnnotationPoint): AnnotationPoint {
  return {
    x: clampNormalized(point.x),
    y: clampNormalized(point.y),
  };
}

function nextTextBoxZ(textBoxes: AnnotationTextBox[]): number {
  if (textBoxes.length === 0) {
    return 1;
  }
  return Math.max(...textBoxes.map((item) => item.z || 1)) + 1;
}

function distanceToStroke(point: AnnotationPoint, stroke: AnnotationStroke): number {
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

function bringBoxToFront(textBoxes: AnnotationTextBox[], boxId: string): AnnotationTextBox[] {
  const nextZ = nextTextBoxZ(textBoxes);
  return textBoxes.map((item) => (item.id === boxId ? { ...item, z: nextZ } : item));
}

export function PdfAnnotationLayer(props: {
  page: number;
  mode: ToolMode;
  highlightColor: string;
  textColor: string;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
  onStrokesChange: (next: AnnotationStroke[]) => void;
  onTextBoxesChange: (next: AnnotationTextBox[]) => void;
  t: (key: any) => string;
}) {
  const {
    page,
    mode,
    highlightColor,
    textColor,
    strokes,
    textBoxes,
    onStrokesChange,
    onTextBoxesChange,
    t,
  } = props;
  const drawingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [draftStroke, setDraftStroke] = useState<AnnotationPoint[] | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);

  const pageStrokes = useMemo(
    () => strokes.filter((item) => item.page === page),
    [page, strokes],
  );
  const pageTextBoxes = useMemo(
    () =>
      textBoxes
        .filter((item) => item.page === page)
        .sort((a, b) => a.z - b.z),
    [page, textBoxes],
  );

  useEffect(() => {
    if (selectedTextBoxId && !textBoxes.some((item) => item.id === selectedTextBoxId)) {
      setSelectedTextBoxId(null);
    }
    if (editingTextBoxId && !textBoxes.some((item) => item.id === editingTextBoxId)) {
      setEditingTextBoxId(null);
    }
  }, [editingTextBoxId, selectedTextBoxId, textBoxes]);

  useEffect(() => {
    if (!selectedTextBoxId) {
      return;
    }
    onTextBoxesChange(
      textBoxes.map((item) =>
        item.id === selectedTextBoxId
          ? { ...item, style: { ...item.style, textColor } }
          : item,
      ),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [textColor]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragStateRef.current;
      const rect = layerRef.current?.getBoundingClientRect();
      if (!drag || !rect) {
        return;
      }
      const point = toNormalizedPoint(event, rect);
      const dx = point.x - drag.start.x;
      const dy = point.y - drag.start.y;
      onTextBoxesChange(
        textBoxes.map((item) => {
          if (item.id !== drag.boxId) {
            return item;
          }
          if (drag.mode === "move") {
            return {
              ...item,
              x: clampNormalized(drag.initial.x + dx),
              y: clampNormalized(drag.initial.y + dy),
            };
          }
          return {
            ...item,
            w: clampDimension(drag.initial.w + dx),
            h: clampDimension(drag.initial.h + dy),
          };
        }),
      );
    };
    const onUp = () => {
      dragStateRef.current = null;
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
  }, [onTextBoxesChange, textBoxes]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!selectedTextBoxId || editingTextBoxId) {
        return;
      }
      if (event.key !== "Delete" && event.key !== "Backspace") {
        return;
      }
      const activeTag = (document.activeElement as HTMLElement | null)?.tagName.toLowerCase();
      if (activeTag === "input" || activeTag === "textarea") {
        return;
      }
      event.preventDefault();
      onTextBoxesChange(textBoxes.filter((item) => item.id !== selectedTextBoxId));
      setSelectedTextBoxId(null);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [editingTextBoxId, onTextBoxesChange, selectedTextBoxId, textBoxes]);

  const finishDrawing = () => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    setDraftStroke((previous) => {
      if (!previous || previous.length < 2) {
        return null;
      }
      const stroke: AnnotationStroke = {
        id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
        page,
        points: previous.map(clampPoint),
        style: createDefaultStrokeStyle(highlightColor),
      };
      onStrokesChange([...strokes, stroke]);
      return null;
    });
  };

  return (
    <>
      <svg
        className="pointer-events-none absolute inset-0 z-10 h-full w-full"
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
      >
        {pageStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={hexToRgba(stroke.style?.color ?? "#facc15", stroke.style?.opacity ?? 0.65)}
            strokeWidth={stroke.style?.width ?? 16}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {draftStroke && draftStroke.length > 1 ? (
          <polyline
            points={draftStroke.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke={hexToRgba(highlightColor, 0.72)}
            strokeWidth="16"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>

      <div
        ref={layerRef}
        className="absolute inset-0 z-20"
        onMouseDown={(event) => {
          const rect = layerRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          const point = toNormalizedPoint(event, rect);

          if (mode === "textbox") {
            const id = `textbox-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const nextBox: AnnotationTextBox = {
              id,
              page,
              x: clampNormalized(point.x),
              y: clampNormalized(point.y),
              w: 260,
              h: 160,
              z: nextTextBoxZ(textBoxes),
              content: "",
              style: createDefaultTextStyle(textColor),
            };
            onTextBoxesChange([...textBoxes, nextBox]);
            setSelectedTextBoxId(id);
            setEditingTextBoxId(id);
            return;
          }

          if (mode === "eraser") {
            const candidates = pageStrokes.map((stroke) => ({
              id: stroke.id,
              dist: distanceToStroke(point, stroke),
            }));
            const nearest = candidates.sort((a, b) => a.dist - b.dist)[0];
            if (nearest && nearest.dist <= 26) {
              onStrokesChange(strokes.filter((item) => item.id !== nearest.id));
            }
            return;
          }

          if (mode === "highlight") {
            drawingRef.current = true;
            setDraftStroke([point]);
            return;
          }

          setSelectedTextBoxId(null);
          setEditingTextBoxId(null);
        }}
        onMouseMove={(event) => {
          if (mode !== "highlight" || !drawingRef.current) {
            return;
          }
          const rect = layerRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          const point = toNormalizedPoint(event, rect);
          setDraftStroke((previous) => (previous ? [...previous, point] : [point]));
        }}
        onMouseUp={finishDrawing}
        onMouseLeave={finishDrawing}
      >
        {pageTextBoxes.map((box) => {
          const selected = box.id === selectedTextBoxId;
          const editing = box.id === editingTextBoxId;
          return (
            <div
              key={box.id}
              className={`absolute rounded border shadow-sm ${selected ? "ring-2 ring-primary-300" : ""}`}
              style={{
                left: `${(box.x / 1000) * 100}%`,
                top: `${(box.y / 1000) * 100}%`,
                width: `${(box.w / 1000) * 100}%`,
                height: `${(box.h / 1000) * 100}%`,
                zIndex: box.z,
                borderColor: box.style.borderColor,
                backgroundColor: box.style.backgroundColor,
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
                setSelectedTextBoxId(box.id);
                onTextBoxesChange(bringBoxToFront(textBoxes, box.id));
                if (!editing) {
                  const rect = layerRef.current?.getBoundingClientRect();
                  if (!rect || mode !== "select") {
                    return;
                  }
                  dragStateRef.current = {
                    mode: "move",
                    boxId: box.id,
                    start: toNormalizedPoint(event, rect),
                    initial: box,
                  };
                }
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setSelectedTextBoxId(box.id);
                setEditingTextBoxId(box.id);
              }}
            >
              {editing ? (
                <textarea
                  autoFocus
                  className="h-full w-full resize-none rounded border-none bg-white/95 p-1.5 text-xs leading-5 outline-none"
                  style={{
                    color: box.style.textColor,
                    fontSize: `${box.style.fontSize}px`,
                  }}
                  value={box.content}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) =>
                    onTextBoxesChange(
                      textBoxes.map((item) =>
                        item.id === box.id ? { ...item, content: event.target.value } : item,
                      ),
                    )
                  }
                  onBlur={() => setEditingTextBoxId(null)}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setEditingTextBoxId(null);
                    }
                  }}
                />
              ) : (
                <div
                  className="h-full overflow-auto whitespace-pre-wrap break-words p-1.5 text-xs leading-5"
                  style={{
                    color: box.style.textColor,
                    fontSize: `${box.style.fontSize}px`,
                  }}
                >
                  {box.content.trim().length > 0
                    ? box.content
                    : t("library.viewer.textboxPlaceholder")}
                </div>
              )}
              {selected && mode === "select" && !editing ? (
                <button
                  className="absolute bottom-0.5 right-0.5 h-3.5 w-3.5 cursor-se-resize rounded-sm border border-slate-300 bg-white/90"
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    const rect = layerRef.current?.getBoundingClientRect();
                    if (!rect) {
                      return;
                    }
                    dragStateRef.current = {
                      mode: "resize",
                      boxId: box.id,
                      start: toNormalizedPoint(event, rect),
                      initial: box,
                    };
                  }}
                  title={t("library.viewer.textboxResize")}
                />
              ) : null}
            </div>
          );
        })}
      </div>
    </>
  );
}
