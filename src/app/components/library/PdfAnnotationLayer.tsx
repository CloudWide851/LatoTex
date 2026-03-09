import { useEffect, useMemo, useRef, useState } from "react";
import {
  clampDimension,
  clampNormalized,
  createDefaultStrokeStyle,
  createDefaultTextStyle,
  type AnnotationTextStylePreset,
  type AnnotationPoint,
  type AnnotationStroke,
  type AnnotationTextBox,
} from "./annotationModel";
import { hexToRgba } from "./annotationPalette";
import { PdfTextBoxContextMenu } from "./PdfTextBoxContextMenu";
import {
  isRichTextEmpty,
  normalizeStoredRichHtml,
  plainTextToRichHtml,
  richHtmlToPlainText,
  sanitizeRichTextHtml,
} from "./textboxRichText";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type DragMode = "move" | "resize";
type ContextMenuState = {
  boxId: string;
  x: number;
  y: number;
};
const HIGHLIGHT_CURSOR = `url("data:image/svg+xml;utf8,%3Csvg xmlns='http://www.w3.org/2000/svg' width='26' height='26' viewBox='0 0 26 26'%3E%3Crect x='2' y='2' width='10' height='22' rx='3' fill='%23facc15' stroke='%23b45309' stroke-width='1.4'/%3E%3Crect x='12' y='17' width='12' height='7' rx='2' fill='%23fef3c7' stroke='%23b45309' stroke-width='1.2'/%3E%3C/svg%3E") 4 22, crosshair`;

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

function positionContextMenu(x: number, y: number): { x: number; y: number } {
  if (typeof window === "undefined") {
    return { x, y };
  }
  const width = 288;
  const height = 248;
  const padding = 10;
  const nextX = Math.max(padding, Math.min(window.innerWidth - width - padding, x));
  const nextY = Math.max(padding, Math.min(window.innerHeight - height - padding, y));
  return { x: nextX, y: nextY };
}

export function PdfAnnotationLayer(props: {
  page: number;
  mode: ToolMode;
  highlightColor: string;
  highlightWidth: number;
  highlightOpacity: number;
  textColor: string;
  textBoxStylePreset: AnnotationTextStylePreset;
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
    highlightWidth,
    highlightOpacity,
    textColor,
    textBoxStylePreset,
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
  const [menuState, setMenuState] = useState<ContextMenuState | null>(null);

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
  const menuBox = useMemo(
    () => (menuState ? textBoxes.find((item) => item.id === menuState.boxId) ?? null : null),
    [menuState, textBoxes],
  );

  useEffect(() => {
    if (selectedTextBoxId && !textBoxes.some((item) => item.id === selectedTextBoxId)) {
      setSelectedTextBoxId(null);
    }
    if (editingTextBoxId && !textBoxes.some((item) => item.id === editingTextBoxId)) {
      setEditingTextBoxId(null);
    }
    if (menuState && !textBoxes.some((item) => item.id === menuState.boxId)) {
      setMenuState(null);
    }
  }, [editingTextBoxId, menuState, selectedTextBoxId, textBoxes]);

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
      if (event.key === "Escape" && menuState) {
        setMenuState(null);
      }
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
  }, [editingTextBoxId, menuState, onTextBoxesChange, selectedTextBoxId, textBoxes]);

  useEffect(() => {
    if (!menuState) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-textbox-menu='true']")) {
        return;
      }
      setMenuState(null);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuState]);

  useEffect(() => {
    if (!editingTextBoxId || typeof window === "undefined") {
      return;
    }
    const selector = `[data-editing-box='${editingTextBoxId}']`;
    const target = layerRef.current?.querySelector<HTMLElement>(selector);
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
  }, [editingTextBoxId, pageTextBoxes]);

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
        style: createDefaultStrokeStyle(highlightColor, {
          width: highlightWidth,
          opacity: highlightOpacity,
        }),
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
            stroke={hexToRgba(highlightColor, Math.min(1, highlightOpacity + 0.07))}
            strokeWidth={highlightWidth}
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        ) : null}
      </svg>

      <div
        ref={layerRef}
        className="absolute inset-0 z-20"
        style={{
          cursor:
            mode === "highlight"
              ? HIGHLIGHT_CURSOR
              : mode === "eraser"
                ? "cell"
                : mode === "textbox"
                  ? "text"
                  : "default",
        }}
        onMouseDown={(event) => {
          setMenuState(null);
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
              w: 220,
              h: 112,
              z: nextTextBoxZ(textBoxes),
              content: "",
              html: "",
              style: createDefaultTextStyle(textColor, textBoxStylePreset),
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
          const boxHtml = normalizeStoredRichHtml(box.html, box.content);
          const hasContent = !isRichTextEmpty(boxHtml);
          if (!editing && !hasContent) {
            return null;
          }
          return (
            <div
              key={box.id}
              className={`absolute rounded ${selected ? "ring-1 ring-primary-300" : ""}`}
              style={{
                left: `${(box.x / 1000) * 100}%`,
                top: `${(box.y / 1000) * 100}%`,
                width: `${(box.w / 1000) * 100}%`,
                height: `${(box.h / 1000) * 100}%`,
                zIndex: box.z,
                borderColor: box.style.borderColor,
                borderStyle: box.style.borderWidth > 0 ? "solid" : "none",
                borderWidth: `${box.style.borderWidth}px`,
                backgroundColor: box.style.backgroundColor,
              }}
              onMouseDown={(event) => {
                event.stopPropagation();
                setMenuState(null);
                setSelectedTextBoxId(box.id);
                onTextBoxesChange(bringBoxToFront(textBoxes, box.id));
                if (!editing) {
                  const rect = layerRef.current?.getBoundingClientRect();
                  if (!rect || mode !== "select") {
                    return;
                  }
                  const boxRect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                  const nearResizeCorner =
                    boxRect.right - event.clientX <= 14 && boxRect.bottom - event.clientY <= 14;
                  dragStateRef.current = {
                    mode: nearResizeCorner ? "resize" : "move",
                    boxId: box.id,
                    start: toNormalizedPoint(event, rect),
                    initial: box,
                  };
                }
              }}
              onContextMenu={(event) => {
                event.preventDefault();
                event.stopPropagation();
                setSelectedTextBoxId(box.id);
                const next = positionContextMenu(event.clientX + 6, event.clientY + 6);
                setMenuState({
                  boxId: box.id,
                  x: next.x,
                  y: next.y,
                });
              }}
              onDoubleClick={(event) => {
                event.stopPropagation();
                setSelectedTextBoxId(box.id);
                setEditingTextBoxId(box.id);
                setMenuState(null);
              }}
            >
              {editing ? (
                <div
                  autoFocus
                  contentEditable
                  suppressContentEditableWarning
                  data-editing-box={box.id}
                  className="h-full w-full overflow-auto rounded border-none bg-transparent p-1.5 text-xs leading-5 outline-none"
                  style={{
                    color: box.style.textColor,
                    fontSize: `${box.style.fontSize}px`,
                    fontFamily: box.style.fontFamily,
                    textAlign: box.style.textAlign,
                    fontWeight: box.style.fontWeight,
                    fontStyle: box.style.fontStyle,
                    textDecoration: box.style.textDecoration,
                  }}
                  dangerouslySetInnerHTML={{ __html: boxHtml }}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const html = sanitizeRichTextHtml((event.currentTarget as HTMLDivElement).innerHTML);
                    const target = textBoxes.find((item) => item.id === box.id);
                    const targetContent = richHtmlToPlainText(html || target?.html || target?.content || "");
                    if (!target || targetContent.trim().length === 0) {
                      onTextBoxesChange(textBoxes.filter((item) => item.id !== box.id));
                      setSelectedTextBoxId((current) => (current === box.id ? null : current));
                      setEditingTextBoxId(null);
                      return;
                    }
                    onTextBoxesChange(
                      textBoxes.map((item) =>
                        item.id === box.id ? { ...item, content: targetContent, html: html || plainTextToRichHtml(targetContent) } : item,
                      ),
                    );
                    setEditingTextBoxId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      (event.currentTarget as HTMLDivElement).blur();
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
                    fontFamily: box.style.fontFamily,
                    textAlign: box.style.textAlign,
                    fontWeight: box.style.fontWeight,
                    fontStyle: box.style.fontStyle,
                    textDecoration: box.style.textDecoration,
                  }}
                  dangerouslySetInnerHTML={{ __html: boxHtml }}
                />
              )}
            </div>
          );
        })}
        {menuState && menuBox ? (
          <PdfTextBoxContextMenu
            x={menuState.x}
            y={menuState.y}
            style={menuBox.style}
            onChangeStyle={(nextStyle) => {
              onTextBoxesChange(
                textBoxes.map((item) =>
                  item.id === menuBox.id ? { ...item, style: { ...item.style, ...nextStyle } } : item,
                ),
              );
            }}
            onDelete={() => {
              onTextBoxesChange(textBoxes.filter((item) => item.id !== menuBox.id));
              setEditingTextBoxId((current) => (current === menuBox.id ? null : current));
              setSelectedTextBoxId((current) => (current === menuBox.id ? null : current));
              setMenuState(null);
            }}
            onClose={() => setMenuState(null)}
            t={t}
          />
        ) : null}
      </div>
    </>
  );
}
