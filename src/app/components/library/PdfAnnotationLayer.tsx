import { useCallback, useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { clampNormalized, createDefaultTextStyle, type AnnotationTextStylePreset, type AnnotationPoint, type AnnotationStroke, type AnnotationTextBox } from "./annotationModel";
import { PdfAnnotationStrokeLayer } from "./PdfAnnotationStrokeLayer";
import { PdfAnnotationTextBoxLayer } from "./PdfAnnotationTextBoxLayer";
import { bringBoxToFront, distanceToStroke, ERASER_CURSOR, HIGHLIGHT_CURSOR, nextTextBoxZ, resolveMenuAnchor, toNormalizedPoint } from "./pdfAnnotationLayerUtils";
import { buildAnnotationStroke, focusAnnotationEditingBox, getAnnotationEditingBox } from "./pdfAnnotationLayerInteraction";
import { resolveAnnotationDisplayScale, resolveTextBoxDisplayMetrics } from "./pdfAnnotationDisplayScale";
import { applyStyleToEntireRichTextHtml, applyStyleToRichTextSelection, normalizeStoredRichHtml, plainTextToRichHtml, restoreRichTextSelection, richHtmlToPlainText, sanitizeRichTextHtml } from "./textboxRichText";
import { usePdfTextBoxEditing } from "./usePdfTextBoxEditing";
import { usePdfTextBoxTransform } from "./usePdfTextBoxTransform";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";

export function PdfAnnotationLayer(props: {
  page: number;
  annotationScale?: number;
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
    annotationScale,
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
  const [menuPositionTick, setMenuPositionTick] = useState(0);
  const displayScale = resolveAnnotationDisplayScale({ layerWidth: layerSize.width, fallbackScale: annotationScale });
  const textBoxDisplayMetrics = resolveTextBoxDisplayMetrics(displayScale);
  const { updateTextBoxes, deleteTextBox, commitTextBoxEditing } = usePdfTextBoxEditing({ layerRef, textBoxesRef, recentlyCreatedTextBoxIdRef, onTextBoxesChange, setEditingTextBoxId, setSelectedTextBoxId, setMenuOpen });
  const { dragPreview, beginTextBoxTransform } = usePdfTextBoxTransform({
    layerRef,
    onCommit: (preview) => updateTextBoxes((current) => current.map((item) => item.id === preview.boxId ? { ...item, x: preview.x, y: preview.y, w: preview.w, h: preview.h } : item)),
  });
  const pageStrokes = useMemo(() => strokes.filter((item) => item.page === page), [page, strokes]);
  const pageTextBoxes = useMemo(() => textBoxes.filter((item) => item.page === page).sort((a, b) => a.z - b.z), [page, textBoxes]);
  const menuBox = useMemo(() => (selectedTextBoxId ? textBoxes.find((item) => item.id === selectedTextBoxId) ?? null : null), [selectedTextBoxId, textBoxes]);
  const canTransformTextBoxes = !readOnly && (mode === "select" || mode === "textbox");
  useEffect(() => { textBoxesRef.current = textBoxes; }, [textBoxes]);
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
    updateTextBoxes((current) =>
      current.map((item) =>
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
      deleteTextBox(selectedTextBoxId);
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [deleteTextBox, editingTextBoxId, menuOpen, selectedTextBoxId]);
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
    if (!menuOpen) {
      return;
    }
    const updateMenuPosition = () => setMenuPositionTick((current) => current + 1);
    window.addEventListener("resize", updateMenuPosition);
    window.addEventListener("scroll", updateMenuPosition, true);
    return () => { window.removeEventListener("resize", updateMenuPosition); window.removeEventListener("scroll", updateMenuPosition, true); };
  }, [menuOpen]);

  useEffect(() => {
    if (!editingTextBoxId || typeof document === "undefined") {
      return;
    }
    const handleSelectionChange = () => {
      const editor = getAnnotationEditingBox(layerRef.current, editingTextBoxId);
      const selection = window.getSelection?.();
      if (!editor || !selection) {
        return;
      }
      if (selection.rangeCount === 0) {
        const activeElement = document.activeElement as HTMLElement | null;
        if (activeElement === editor || (activeElement && editor.contains(activeElement))) {
          selectionRangeRef.current = null;
        }
        return;
      }
      const range = selection.getRangeAt(0);
      const container = range.commonAncestorContainer;
      const element = container.nodeType === Node.ELEMENT_NODE
        ? container as HTMLElement
        : container.parentElement;
      if (element && editor.contains(element)) {
        selectionRangeRef.current = selection.isCollapsed ? null : range.cloneRange();
        return;
      }
      const activeElement = document.activeElement as HTMLElement | null;
      if (activeElement === editor || (activeElement && editor.contains(activeElement))) {
        selectionRangeRef.current = null;
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

  const menuAnchor = useMemo(() => resolveMenuAnchor({ menuOpen, layerRect: layerRef.current?.getBoundingClientRect() ?? null, layerSize, menuBox, dragPreview }), [dragPreview, layerSize, menuBox, menuOpen, menuPositionTick]);

  const applyTextBoxStyle = useCallback((boxId: string, nextStyle: Partial<AnnotationTextBox["style"]>, options?: { preferInline?: boolean }) => {
    const preferInline = options?.preferInline !== false;
    const editor = editingTextBoxId === boxId
      ? getAnnotationEditingBox(layerRef.current, editingTextBoxId)
      : null;
    let inlineApplied = false;
    let nextEditorHtml: string | null = null;
    if (preferInline && editor) {
      restoreRichTextSelection(editor, selectionRangeRef.current);
      const nextRange = applyStyleToRichTextSelection(editor, nextStyle);
      if (nextRange) {
        selectionRangeRef.current = nextRange;
        inlineApplied = true;
      }
    }
    if (editor && !inlineApplied) {
      const fallbackHtml = normalizeStoredRichHtml(editor.innerHTML, editor.textContent ?? "");
      nextEditorHtml = applyStyleToEntireRichTextHtml(
        fallbackHtml,
        nextStyle,
        richHtmlToPlainText(fallbackHtml),
      );
      if (nextEditorHtml) {
        editor.innerHTML = nextEditorHtml;
      }
      if (nextStyle.fontFamily) {
        editor.style.fontFamily = nextStyle.fontFamily;
      }
      if (typeof nextStyle.fontSize === "number") {
        editor.style.fontSize = `${nextStyle.fontSize * displayScale}px`;
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
    updateTextBoxes((current) =>
      current.map((item) => {
        if (item.id !== boxId) {
          return item;
        }
        const baseHtml = nextEditorHtml
          ?? (inlineApplied && editor
            ? sanitizeRichTextHtml(editor.innerHTML)
            : applyStyleToEntireRichTextHtml(
              normalizeStoredRichHtml(item.html, item.content),
              nextStyle,
              item.content,
            ));
        const content = richHtmlToPlainText(baseHtml);
        return {
          ...item,
          content,
          html: baseHtml || plainTextToRichHtml(content),
          style: { ...item.style, ...nextStyle },
        };
      }),
    );
    return inlineApplied;
  }, [displayScale, editingTextBoxId, updateTextBoxes]);

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

  const startTextBoxTransform = useCallback((
    mode: "move" | "resize",
    event: ReactPointerEvent<HTMLElement>,
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
    updateTextBoxes((current) => bringBoxToFront(current, box.id));
  }, [beginTextBoxTransform, canTransformTextBoxes, updateTextBoxes]);

  return (
    <>
      <PdfAnnotationStrokeLayer
        pageStrokes={pageStrokes}
        draftStroke={draftStroke}
        highlightColor={highlightColor}
        highlightWidth={highlightWidth}
        highlightOpacity={highlightOpacity}
      />

      <div
        ref={layerRef}
        className="absolute inset-0 z-20"
        data-annotation-layer="true"
        style={{
          pointerEvents: readOnly ? "none" : "auto",
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
            if (editingTextBoxId) {
              recentlyCreatedTextBoxIdRef.current = null;
              commitTextBoxEditing(editingTextBoxId, { deleteIfEmpty: true });
              setEditingTextBoxId(null);
            }
            const id = `textbox-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
            const nextBox: AnnotationTextBox = {
              id,
              page,
              x: clampNormalized(point.x),
              y: clampNormalized(point.y),
              w: 220,
              h: 112,
              z: nextTextBoxZ(textBoxesRef.current),
              content: "",
              html: "",
              style: createDefaultTextStyle(textColor, textBoxStylePreset),
            };
            updateTextBoxes((current) => [...current, nextBox]);
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
        <PdfAnnotationTextBoxLayer
          boxes={pageTextBoxes}
          selectedTextBoxId={selectedTextBoxId}
          editingTextBoxId={editingTextBoxId}
          menuAnchor={menuAnchor}
          menuBox={menuBox}
          dragPreview={dragPreview}
          readOnly={readOnly}
          canTransformTextBoxes={canTransformTextBoxes}
          displayScale={displayScale}
          textBoxDisplayMetrics={textBoxDisplayMetrics}
          layerRef={layerRef}
          recentlyCreatedTextBoxIdRef={recentlyCreatedTextBoxIdRef}
          setMenuOpen={setMenuOpen}
          setSelectedTextBoxId={setSelectedTextBoxId}
          setEditingTextBoxId={setEditingTextBoxId}
          updateTextBoxes={updateTextBoxes}
          commitTextBoxEditing={commitTextBoxEditing}
          deleteTextBox={deleteTextBox}
          startTextBoxTransform={startTextBoxTransform}
          applyTextBoxStyle={applyTextBoxStyle}
          t={t}
        />
      </div>
    </>
  );
}
