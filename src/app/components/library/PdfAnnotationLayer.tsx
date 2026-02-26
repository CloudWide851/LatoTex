import { Check, Edit3, Trash2 } from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampDimension,
  clampNormalized,
  createDefaultTextStyle,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationTextBox,
} from "./annotationModel";

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

export function PdfAnnotationLayer(props: {
  page: number;
  viewportRef: React.RefObject<HTMLDivElement | null>;
  drawEnabled: boolean;
  textBoxMode: boolean;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
  onStrokesChange: (next: AnnotationStroke[]) => void;
  onTextBoxesChange: (next: AnnotationTextBox[]) => void;
  t: (key: any) => string;
}) {
  const {
    page,
    viewportRef,
    drawEnabled,
    textBoxMode,
    strokes,
    textBoxes,
    onStrokesChange,
    onTextBoxesChange,
    t,
  } = props;
  const drawingRef = useRef(false);
  const dragStateRef = useRef<DragState | null>(null);
  const [draftStroke, setDraftStroke] = useState<AnnotationPoint[] | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const interactiveCanvas = drawEnabled || textBoxMode;

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
    if (!drawEnabled && !textBoxMode) {
      drawingRef.current = false;
      setDraftStroke(null);
    }
  }, [drawEnabled, textBoxMode]);

  useEffect(() => {
    const onMove = (event: MouseEvent) => {
      const drag = dragStateRef.current;
      const rect = viewportRef.current?.getBoundingClientRect();
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
  }, [onTextBoxesChange, textBoxes, viewportRef]);

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
      };
      onStrokesChange([...strokes, stroke]);
      return null;
    });
  };

  return (
    <>
      <svg
        className={`absolute inset-0 z-10 h-full w-full ${interactiveCanvas ? "pointer-events-auto" : "pointer-events-none"}`}
        viewBox="0 0 1000 1000"
        preserveAspectRatio="none"
        onMouseDown={(event) => {
          if (!interactiveCanvas) {
            return;
          }
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          const point = toNormalizedPoint(event, rect);
          if (textBoxMode) {
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
              style: createDefaultTextStyle(),
            };
            onTextBoxesChange([...textBoxes, nextBox]);
            setSelectedTextBoxId(id);
            setEditingTextBoxId(id);
            return;
          }
          if (!drawEnabled) {
            setSelectedTextBoxId(null);
            setEditingTextBoxId(null);
            return;
          }
          drawingRef.current = true;
          setDraftStroke([point]);
        }}
        onMouseMove={(event) => {
          if (!interactiveCanvas || !drawEnabled || !drawingRef.current) {
            return;
          }
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          const point = toNormalizedPoint(event, rect);
          setDraftStroke((previous) => (previous ? [...previous, point] : [point]));
        }}
        onMouseUp={finishDrawing}
        onMouseLeave={finishDrawing}
      >
        {pageStrokes.map((stroke) => (
          <polyline
            key={stroke.id}
            points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="rgba(250, 204, 21, 0.6)"
            strokeWidth="15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ))}
        {draftStroke && draftStroke.length > 1 ? (
          <polyline
            points={draftStroke.map((point) => `${point.x},${point.y}`).join(" ")}
            fill="none"
            stroke="rgba(250, 204, 21, 0.72)"
            strokeWidth="15"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>

      <div className="pointer-events-none absolute inset-0 z-20">
        {pageTextBoxes.map((box) => {
          const selected = box.id === selectedTextBoxId;
          const editing = box.id === editingTextBoxId;
          return (
            <div
              key={box.id}
              className={`pointer-events-auto absolute rounded border shadow-sm ${selected ? "ring-2 ring-primary-300" : ""}`}
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
                onTextBoxesChange(
                  textBoxes.map((item) =>
                    item.id === box.id ? { ...item, z: nextTextBoxZ(textBoxes) } : item,
                  ),
                );
              }}
            >
              <div
                className="flex items-center justify-end gap-1 border-b border-slate-200 bg-white/90 px-1 py-0.5"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  const rect = viewportRef.current?.getBoundingClientRect();
                  if (!rect) {
                    return;
                  }
                  dragStateRef.current = {
                    mode: "move",
                    boxId: box.id,
                    start: toNormalizedPoint(event, rect),
                    initial: box,
                  };
                }}
              >
                {editing ? (
                  <button
                    className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingTextBoxId(null);
                    }}
                    title={t("library.viewer.textboxSave")}
                  >
                    <Check className="h-3 w-3" />
                  </button>
                ) : (
                  <button
                    className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
                    onClick={(event) => {
                      event.stopPropagation();
                      setEditingTextBoxId(box.id);
                    }}
                    title={t("library.viewer.textboxEdit")}
                  >
                    <Edit3 className="h-3 w-3" />
                  </button>
                )}
                <button
                  className="rounded border border-slate-300 bg-white p-1 text-slate-600 hover:bg-slate-100"
                  onClick={(event) => {
                    event.stopPropagation();
                    onTextBoxesChange(textBoxes.filter((item) => item.id !== box.id));
                    if (editingTextBoxId === box.id) {
                      setEditingTextBoxId(null);
                    }
                    if (selectedTextBoxId === box.id) {
                      setSelectedTextBoxId(null);
                    }
                  }}
                  title={t("library.viewer.textboxDelete")}
                >
                  <Trash2 className="h-3 w-3" />
                </button>
              </div>
              <div className="h-[calc(100%-26px)] p-1.5">
                {editing ? (
                  <textarea
                    className="h-full w-full resize-none rounded border border-slate-300 bg-white/95 p-1 text-xs leading-5 text-slate-700 outline-none"
                    value={box.content}
                    onChange={(event) =>
                      onTextBoxesChange(
                        textBoxes.map((item) =>
                          item.id === box.id ? { ...item, content: event.target.value } : item,
                        ),
                      )
                    }
                  />
                ) : (
                  <div
                    className="h-full overflow-auto whitespace-pre-wrap break-words rounded bg-white/50 p-1 text-xs leading-5"
                    style={{
                      color: box.style.textColor,
                      fontSize: `${box.style.fontSize}px`,
                    }}
                  >
                    {box.content}
                  </div>
                )}
              </div>
              <button
                className="absolute bottom-0.5 right-0.5 h-3 w-3 cursor-se-resize rounded-sm border border-slate-300 bg-white/90"
                onMouseDown={(event) => {
                  event.stopPropagation();
                  const rect = viewportRef.current?.getBoundingClientRect();
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
            </div>
          );
        })}
      </div>
    </>
  );
}
