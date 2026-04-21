import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from "react";
import { clampNormalized, createDefaultTextStyle, type AnnotationTextStylePreset, type AnnotationPoint, type AnnotationStroke, type AnnotationTextBox } from "./annotationModel";
import { hexToRgba } from "./annotationPalette";
import { PdfTextBoxContextMenu } from "./PdfTextBoxContextMenu";
import { PdfTextBoxTransformHandles } from "./PdfTextBoxTransformHandles";
import { bringBoxToFront, distanceToStroke, ERASER_CURSOR, HIGHLIGHT_CURSOR, nextTextBoxZ, resolveMenuAnchor, toNormalizedPoint } from "./pdfAnnotationLayerUtils";
import { buildAnnotationStroke, focusAnnotationEditingBox, getAnnotationEditingBox } from "./pdfAnnotationLayerInteraction";
import { applyStyleToRichTextSelection, captureRichTextSelection, isRichTextEmpty, normalizeStoredRichHtml, plainTextToRichHtml, restoreRichTextSelection, richHtmlToPlainText, sanitizeRichTextHtml } from "./textboxRichText";
import { usePdfTextBoxTransform } from "./usePdfTextBoxTransform";

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
  const textBoxesRef = useRef(textBoxes);
  const recentlyCreatedTextBoxIdRef = useRef<string | null>(null);
  const selectionRangeRef = useRef<Range | null>(null);
  const layerRef = useRef<HTMLDivElement | null>(null);
  const [layerSize, setLayerSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });
  const [draftStroke, setDraftStroke] = useState<AnnotationPoint[] | null>(null);
  const [editingTextBoxId, setEditingTextBoxId] = useState<string | null>(null);
  const [selectedTextBoxId, setSelectedTextBoxId] = useState<string | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const { dragPreview, beginTextBoxTransform } = usePdfTextBoxTransform({
    layerRef,
    onCommit: (preview) => {
      onTextBoxesChange(
        textBoxesRef.current.map((item) =>
          item.id === preview.boxId
            ? { ...item, x: preview.x, y: preview.y, w: preview.w, h: preview.h }
            : item,
        ),
      );
    },
  });

  const pageStrokes = useMemo(() => strokes.filter((item) => item.page === page), [page, strokes]);
  const pageTextBoxes = useMemo(() => textBoxes.filter((item) => item.page === page).sort((a, b) => a.z - b.z), [page, textBoxes]);
  const menuBox = useMemo(() => (selectedTextBoxId ? textBoxes.find((item) => item.id === selectedTextBoxId) ?? null : null), [selectedTextBoxId, textBoxes]);
  const canTransformTextBoxes = !readOnly && (mode === "select" || mode === "textbox");

  useEffect(() => {
    textBoxesRef.current = textBoxes;
  }, [textBoxes]);

  useEffect(() => { selectionRangeRef.current = null; }, [editingTextBoxId]);

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
    focusAnnotationEditingBox(layerRef.current, editingTextBoxId);
  }, [editingTextBoxId]);

  useEffect(() => {
    if (!editingTextBoxId || typeof document === "undefined") {
      return;
    }
    const handleSelectionChange = () => {
      const editor = getAnnotationEditingBox(layerRef.current, editingTextBoxId);
      if (editor) {
        selectionRangeRef.current = captureRichTextSelection(editor);
      }
    };
    document.addEventListener("selectionchange", handleSelectionChange);
    return () => document.removeEventListener("selectionchange", handleSelectionChange);
  }, [editingTextBoxId]);

  useEffect(() => {
    const node = layerRef.current;
    if (!node) {
      return;
    }
    const applySize = () => setLayerSize({ width: node.clientWidth, height: node.clientHeight });
    applySize();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => applySize());
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const menuAnchor = useMemo(() => resolveMenuAnchor({ menuOpen, layerSize, menuBox, dragPreview }), [dragPreview, layerSize, menuBox, menuOpen]);

  const applyTextBoxStyle = useCallback((boxId: string, nextStyle: Partial<AnnotationTextBox["style"]>, options?: { preferInline?: boolean }) => {
    const preferInline = options?.preferInline !== false;
    const editor = editingTextBoxId === boxId
      ? getAnnotationEditingBox(layerRef.current, editingTextBoxId)
      : null;
    let inlineApplied = false;
    if (preferInline && editor) {
      restoreRichTextSelection(editor, selectionRangeRef.current);
      const nextRange = applyStyleToRichTextSelection(editor, nextStyle);
      if (nextRange) {
        selectionRangeRef.current = nextRange;
        inlineApplied = true;
      } else {
        selectionRangeRef.current = captureRichTextSelection(editor);
      }
    }
    if (editor && !inlineApplied) {
      if (nextStyle.fontFamily) {
        editor.style.fontFamily = nextStyle.fontFamily;
      }
      if (typeof nextStyle.fontSize === "number") {
        editor.style.fontSize = `${nextStyle.fontSize}px`;
      }
      if (nextStyle.textAlign) {
        editor.style.textAlign = nextStyle.textAlign;
      }
      if (nextStyle.textColor) {
        editor.style.color = nextStyle.textColor;
      }
      if (nextStyle.fontWeight) {
        editor.style.fontWeight = nextStyle.fontWeight;
      }
      if (nextStyle.fontStyle) {
        editor.style.fontStyle = nextStyle.fontStyle;
      }
      if (nextStyle.textDecoration) {
        editor.style.textDecoration = nextStyle.textDecoration;
      }
    }
    if (inlineApplied && editor) {
      const html = sanitizeRichTextHtml(editor.innerHTML);
      const content = richHtmlToPlainText(html);
      onTextBoxesChange(textBoxesRef.current.map((item) => (
        item.id === boxId ? { ...item, content, html: html || plainTextToRichHtml(content) } : item
      )));
      return true;
    }
    onTextBoxesChange(
      textBoxesRef.current.map((item) =>
        item.id === boxId ? { ...item, style: { ...item.style, ...nextStyle } } : item,
      ),
    );
    return false;
  }, [editingTextBoxId, onTextBoxesChange]);

  const finishDrawing = () => {
    if (!drawingRef.current) {
      return;
    }
    drawingRef.current = false;
    setDraftStroke((previous) => {
      if (!previous || previous.length < 2) {
        return null;
      }
      const stroke: AnnotationStroke = buildAnnotationStroke({
        points: previous,
        page,
        highlightColor,
        highlightWidth,
        highlightOpacity,
      });
      onStrokesChange([...strokes, stroke]);
      return null;
    });
  };

  const startTextBoxTransform = (
    mode: "move" | "resize",
    event: ReactMouseEvent<HTMLButtonElement>,
    box: AnnotationTextBox,
  ) => {
    if (!canTransformTextBoxes) {
      return;
    }
    if (!beginTextBoxTransform(mode, event, box)) {
      return;
    }
    setMenuOpen(true);
    setSelectedTextBoxId(box.id);
    onTextBoxesChange(bringBoxToFront(textBoxes, box.id));
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
              data-annotation-ignore-lens="true"
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
                cursor: editing ? "text" : "default",
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
                if (
                  target?.closest("[data-textbox-resize-handle='true']")
                  || target?.closest("[data-textbox-move-handle='true']")
                ) {
                  return;
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
              onMouseUp={(event) => {
                event.stopPropagation();
              }}
            >
              {editing ? (
                <div
                  autoFocus
                  contentEditable
                  suppressContentEditableWarning
                  data-editing-box={box.id}
                  data-textbox-content="true"
                  data-textbox-editing="true"
                  data-annotation-ignore-lens="true"
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
                  onMouseDown={(event) => event.stopPropagation()}
                  onMouseUp={(event) => event.stopPropagation()}
                  onBlur={(event) => {
                    const html = sanitizeRichTextHtml((event.currentTarget as HTMLDivElement).innerHTML);
                    const currentTextBoxes = textBoxesRef.current;
                    const target = currentTextBoxes.find((item) => item.id === box.id);
                    const targetContent = richHtmlToPlainText(html || target?.html || target?.content || "");
                    if (recentlyCreatedTextBoxIdRef.current === box.id && targetContent.trim().length === 0) {
                      recentlyCreatedTextBoxIdRef.current = null;
                      window.requestAnimationFrame(() => {
                        focusAnnotationEditingBox(layerRef.current, box.id);
                      });
                      return;
                    }
                    if (!target || targetContent.trim().length === 0) {
                      onTextBoxesChange(currentTextBoxes.filter((item) => item.id !== box.id));
                      setSelectedTextBoxId((current) => (current === box.id ? null : current));
                      setEditingTextBoxId(null);
                      return;
                    }
                    recentlyCreatedTextBoxIdRef.current = null;
                    onTextBoxesChange(
                      currentTextBoxes.map((item) =>
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
                  data-textbox-content="true"
                  data-textbox-static="true"
                  data-annotation-ignore-lens="true"
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
                <PdfTextBoxTransformHandles
                  box={box}
                  t={t}
                  onStartTransform={startTextBoxTransform}
                />
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
            onApplyStyle={(nextStyle, options) => {
              applyTextBoxStyle(menuBox.id, nextStyle, options);
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
