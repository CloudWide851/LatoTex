import { useEffect, useMemo, useRef, useState } from "react";
import {
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
  bringBoxToFront,
  clampPoint,
  distanceToStroke,
  ERASER_CURSOR,
  HIGHLIGHT_CURSOR,
  nextTextBoxZ,
  resolveDraggedBox,
  resolveMenuAnchor,
  toNormalizedPoint,
  type DragPreview,
  type DragState,
} from "./pdfAnnotationLayerUtils";
import {
  isRichTextEmpty,
  normalizeStoredRichHtml,
  plainTextToRichHtml,
  richHtmlToPlainText,
  sanitizeRichTextHtml,
} from "./textboxRichText";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";

export function PdfAnnotationLayer(props: {
  page: number;
  mode: ToolMode;
  readOnly?: boolean;
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
    readOnly = false,
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
  const dragPointRef = useRef<AnnotationPoint | null>(null);
  const dragFrameRef = useRef<number | null>(null);
  const textBoxesRef = useRef(textBoxes);
  const recentlyCreatedTextBoxIdRef = useRef<string | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [layerSize, setLayerSize] = useState<{ width: number; height: number }>({
    width: 0,
    height: 0,
  });
  const [draftStroke, setDraftStroke] = useState<AnnotationPoint[] | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [dragPreview, setDragPreview] = useState<DragPreview | null>(null);

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
    () => (selectedTextBoxId ? textBoxes.find((item) => item.id === selectedTextBoxId) ?? null : null),
    [selectedTextBoxId, textBoxes],
  );
  const canTransformTextBoxes = !readOnly && (mode === "select" || mode === "textbox");

  useEffect(() => {
    textBoxesRef.current = textBoxes;
  }, [textBoxes]);

  useEffect(() => {
    if (selectedTextBoxId && !textBoxes.some((item) => item.id === selectedTextBoxId)) {
      setSelectedTextBoxId(null);
    }
    if (editingTextBoxId && !textBoxes.some((item) => item.id === editingTextBoxId)) {
      setEditingTextBoxId(null);
    }
    if (menuBox === null) {
      setMenuOpen(false);
    }
  }, [editingTextBoxId, menuBox, selectedTextBoxId, textBoxes]);

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
      dragPointRef.current = toNormalizedPoint(event, rect);
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
    const onUp = () => {
      const drag = dragStateRef.current;
      const point = dragPointRef.current;
      if (drag && point) {
        const preview = resolveDraggedBox(drag, point);
        onTextBoxesChange(
          textBoxesRef.current.map((item) =>
            item.id === preview.boxId
              ? { ...item, x: preview.x, y: preview.y, w: preview.w, h: preview.h }
              : item,
          ),
        );
      }
      dragStateRef.current = null;
      dragPointRef.current = null;
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
      setDragPreview(null);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    return () => {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      if (dragFrameRef.current !== null) {
        window.cancelAnimationFrame(dragFrameRef.current);
        dragFrameRef.current = null;
      }
    };
  }, [onTextBoxesChange]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menuOpen) {
        setMenuOpen(false);
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
  }, [editingTextBoxId, menuOpen, onTextBoxesChange, selectedTextBoxId, textBoxes]);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }
    const onPointerDown = (event: MouseEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest("[data-textbox-menu='true']")) {
        return;
      }
      if (target?.closest("[data-annotation-box='true']")) {
        return;
      }
      setMenuOpen(false);
    };
    window.addEventListener("mousedown", onPointerDown);
    return () => window.removeEventListener("mousedown", onPointerDown);
  }, [menuOpen]);

  useEffect(() => {
    if (!editingTextBoxId || typeof window === "undefined") {
      return;
    }
    focusEditingTextBox(editingTextBoxId);
  }, [editingTextBoxId, pageTextBoxes]);

  useEffect(() => {
    const node = layerRef.current;
    if (!node) {
      return;
    }
    const applySize = () => {
      setLayerSize({
        width: node.clientWidth,
        height: node.clientHeight,
      });
    };
    applySize();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => applySize());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const menuAnchor = useMemo(
    () => resolveMenuAnchor({ menuOpen, layerSize, menuBox, dragPreview }),
    [dragPreview, layerSize, menuBox, menuOpen],
  );

  const focusEditingTextBox = (boxId: string) => {
    if (typeof window === "undefined") {
      return;
    }
    const selector = `[data-editing-box='${boxId}']`;
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
  };

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
        data-annotation-layer="true"
        style={{
          pointerEvents: readOnly || mode === "select" ? "none" : "auto",
          cursor:
            mode === "highlight"
              ? HIGHLIGHT_CURSOR
              : mode === "eraser"
                ? ERASER_CURSOR
                : mode === "textbox"
                  ? "text"
                  : "default",
        }}
        onMouseDown={(event) => {
          if (event.button !== 0) {
            return;
          }
          setMenuOpen(false);
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
            recentlyCreatedTextBoxIdRef.current = id;
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
              className={`absolute overflow-visible rounded ${selected ? "ring-1 ring-primary-300" : ""}`}
              data-annotation-box="true"
              style={{
                left: `${((dragPreview?.boxId === box.id ? dragPreview.x : box.x) / 1000) * 100}%`,
                top: `${((dragPreview?.boxId === box.id ? dragPreview.y : box.y) / 1000) * 100}%`,
                width: `${((dragPreview?.boxId === box.id ? dragPreview.w : box.w) / 1000) * 100}%`,
                height: `${((dragPreview?.boxId === box.id ? dragPreview.h : box.h) / 1000) * 100}%`,
                zIndex: box.z,
                pointerEvents: readOnly ? "none" : "auto",
                borderColor: box.style.borderColor,
                borderStyle: box.style.borderWidth > 0 ? "solid" : "none",
                borderWidth: `${box.style.borderWidth}px`,
                backgroundColor: box.style.backgroundColor,
                cursor: editing ? "text" : canTransformTextBoxes ? "move" : "default",
              }}
              onMouseDown={(event) => {
                if (readOnly) {
                  return;
                }
                if (event.button !== 0) {
                  event.stopPropagation();
                  return;
                }
                event.stopPropagation();
                setMenuOpen(true);
                setSelectedTextBoxId(box.id);
                onTextBoxesChange(bringBoxToFront(textBoxes, box.id));
                const target = event.target as HTMLElement | null;
                if (target?.closest("[data-textbox-resize-handle='true']")) {
                  return;
                }
                if (!editing && canTransformTextBoxes) {
                  const rect = layerRef.current?.getBoundingClientRect();
                  if (!rect) {
                    return;
                  }
                  dragStateRef.current = {
                    mode: "move",
                    boxId: box.id,
                    start: toNormalizedPoint(event, rect),
                    initial: box,
                  };
                  dragPointRef.current = null;
                  setDragPreview({
                    boxId: box.id,
                    x: box.x,
                    y: box.y,
                    w: box.w,
                    h: box.h,
                  });
                }
              }}
              onContextMenu={(event) => {
                if (readOnly) {
                  return;
                }
                event.preventDefault();
                event.stopPropagation();
                setSelectedTextBoxId(box.id);
                setMenuOpen(true);
              }}
              onDoubleClick={(event) => {
                if (readOnly) {
                  return;
                }
                event.stopPropagation();
                setSelectedTextBoxId(box.id);
                setEditingTextBoxId(box.id);
                setMenuOpen(true);
              }}
              onClick={(event) => {
                event.stopPropagation();
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
                    boxShadow:
                      box.style.backgroundColor === "transparent" && box.style.borderWidth === 0
                        ? "inset 0 0 0 1px rgba(34, 197, 94, 0.45)"
                        : undefined,
                  }}
                  dangerouslySetInnerHTML={{ __html: boxHtml }}
                  onClick={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const html = sanitizeRichTextHtml((event.currentTarget as HTMLDivElement).innerHTML);
                    const target = textBoxes.find((item) => item.id === box.id);
                    const targetContent = richHtmlToPlainText(html || target?.html || target?.content || "");
                    if (recentlyCreatedTextBoxIdRef.current === box.id && targetContent.trim().length === 0) {
                      recentlyCreatedTextBoxIdRef.current = null;
                      window.requestAnimationFrame(() => {
                        focusEditingTextBox(box.id);
                      });
                      return;
                    }
                    if (!target || targetContent.trim().length === 0) {
                      onTextBoxesChange(textBoxes.filter((item) => item.id !== box.id));
                      setSelectedTextBoxId((current) => (current === box.id ? null : current));
                      setEditingTextBoxId(null);
                      return;
                    }
                    recentlyCreatedTextBoxIdRef.current = null;
                    onTextBoxesChange(
                      textBoxes.map((item) =>
                        item.id === box.id ? { ...item, content: targetContent, html: html || plainTextToRichHtml(targetContent) } : item,
                      ),
                    );
                    setEditingTextBoxId(null);
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      recentlyCreatedTextBoxIdRef.current = null;
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
              {selected && !editing && canTransformTextBoxes ? (
                <button
                  type="button"
                  data-textbox-resize-handle="true"
                  className="absolute -bottom-1.5 -right-1.5 flex h-4 w-4 items-center justify-center rounded-full border border-emerald-400 bg-white shadow-sm"
                  style={{ cursor: "nwse-resize" }}
                  aria-label={t("library.viewer.textboxResize")}
                  title={t("library.viewer.textboxResize")}
                  onClick={(event) => {
                    event.stopPropagation();
                  }}
                  onMouseDown={(event) => {
                    event.stopPropagation();
                    if (!canTransformTextBoxes) {
                      return;
                    }
                    const rect = layerRef.current?.getBoundingClientRect();
                    if (!rect) {
                      return;
                    }
                    setMenuOpen(true);
                    setSelectedTextBoxId(box.id);
                    onTextBoxesChange(bringBoxToFront(textBoxes, box.id));
                    dragStateRef.current = {
                      mode: "resize",
                      boxId: box.id,
                      start: toNormalizedPoint(event, rect),
                      initial: box,
                    };
                    dragPointRef.current = null;
                    setDragPreview({
                      boxId: box.id,
                      x: box.x,
                      y: box.y,
                      w: box.w,
                      h: box.h,
                    });
                  }}
                >
                  <span className="h-2 w-2 rounded-full bg-emerald-500" aria-hidden />
                </button>
              ) : null}
            </div>
          );
        })}
        {menuAnchor && menuBox ? (
          <PdfTextBoxContextMenu
            x={menuAnchor.x}
            y={menuAnchor.y}
            positioning="absolute"
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
              setMenuOpen(false);
            }}
            onClose={() => setMenuOpen(false)}
            t={t}
          />
        ) : null}
      </div>
    </>
  );
}
