import { useRef } from "react";
import type { MutableRefObject, MouseEvent as ReactMouseEvent } from "react";
import { Page } from "react-pdf";
import type {
  AnnotationStroke,
  AnnotationTextBox,
  AnnotationTextStylePreset,
} from "./annotationModel";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type TranslationFn = (key: any) => string;

type LensPendingPoint = {
  visible: boolean;
  viewportX: number;
  viewportY: number;
  pageX: number;
  pageY: number;
  pageNumber: number;
};

export function LibraryPdfScrollViewerPage(props: {
  page: number;
  frameWidth: number;
  lensEnabled: boolean;
  lensActive: boolean;
  readOnly: boolean;
  mode: ToolMode;
  highlightColor: string;
  highlightWidth: number;
  highlightOpacity: number;
  textColor: string;
  textBoxStylePreset: AnnotationTextStylePreset;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
  pageRefs: MutableRefObject<Record<number, HTMLDivElement | null>>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  pendingLensPointRef: MutableRefObject<LensPendingPoint>;
  onToggleLens: (point: LensPendingPoint) => void;
  onMoveLens: (point: LensPendingPoint) => void;
  onHideLens: () => void;
  onRenderSuccess: () => void;
  onStrokesChange: (next: AnnotationStroke[]) => void;
  onTextBoxesChange: (next: AnnotationTextBox[]) => void;
  t: TranslationFn;
}) {
  const {
    page,
    frameWidth,
    lensEnabled,
    lensActive,
    readOnly,
    mode,
    highlightColor,
    highlightWidth,
    highlightOpacity,
    textColor,
    textBoxStylePreset,
    strokes,
    textBoxes,
    pageRefs,
    scrollRef,
    pendingLensPointRef,
    onToggleLens,
    onMoveLens,
    onHideLens,
    onRenderSuccess,
    onStrokesChange,
    onTextBoxesChange,
    t,
  } = props;
  const pointerDownRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  const resolveLensPoint = (event: ReactMouseEvent<HTMLDivElement>, visible: boolean): LensPendingPoint | null => {
    const viewportRect = scrollRef.current?.getBoundingClientRect();
    const pageRect = event.currentTarget.getBoundingClientRect();
    if (!viewportRect) {
      return null;
    }
    const pageX = Math.max(0, Math.min(pageRect.width, event.clientX - pageRect.left));
    const pageY = Math.max(0, Math.min(pageRect.height, event.clientY - pageRect.top));
    const viewportX = event.clientX - viewportRect.left + (scrollRef.current?.scrollLeft || 0);
    const viewportY = event.clientY - viewportRect.top + (scrollRef.current?.scrollTop || 0);
    return {
      visible,
      pageNumber: page,
      pageX,
      pageY,
      viewportX,
      viewportY,
    };
  };

  const hasActiveSelectionInside = (target: HTMLDivElement): boolean => {
    const selection = window.getSelection?.();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0) {
      return false;
    }
    const anchorNode = selection.anchorNode;
    const focusNode = selection.focusNode;
    return Boolean(anchorNode && focusNode && target.contains(anchorNode) && target.contains(focusNode));
  };

  const isAnnotationInteractionTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return Boolean(
      target.closest("[data-annotation-ignore-lens='true']")
      || target.closest("[data-textbox-content='true']")
      || target.closest("[data-annotation-layer='true']")
      || target.closest("[data-annotation-box='true']")
      || target.closest("[data-textbox-resize-handle='true']")
      || target.closest("[data-textbox-menu='true']"),
    );
  };

  return (
    <div
      ref={(element) => {
        pageRefs.current[page] = element;
      }}
      data-page={page}
      className="relative mx-auto overflow-hidden rounded border border-slate-200 bg-white shadow-sm"
      style={{ width: `${frameWidth}px` }}
      onMouseDown={
        lensEnabled
          ? (event) => {
            if (event.button !== 0) {
              return;
            }
            if (isAnnotationInteractionTarget(event.target)) {
              pointerDownRef.current = null;
              return;
            }
            pointerDownRef.current = {
              x: event.clientX,
              y: event.clientY,
              moved: false,
            };
          }
          : undefined
      }
      onMouseMove={
        lensEnabled
          ? (event) => {
            if (isAnnotationInteractionTarget(event.target)) {
              return;
            }
            const pointer = pointerDownRef.current;
            if (pointer) {
              const moved =
                Math.abs(event.clientX - pointer.x) > 6
                || Math.abs(event.clientY - pointer.y) > 6;
              if (moved) {
                pointer.moved = true;
              }
            }
            if (!lensActive) {
              return;
            }
            const point = resolveLensPoint(event, true);
            if (!point) {
              return;
            }
            onMoveLens(point);
          }
          : undefined
      }
      onClick={
        lensEnabled
          ? (event) => {
            const pointer = pointerDownRef.current;
            pointerDownRef.current = null;
            if (isAnnotationInteractionTarget(event.target)) {
              return;
            }
            if (pointer?.moved || hasActiveSelectionInside(event.currentTarget)) {
              return;
            }
            const point = resolveLensPoint(event, !lensActive);
            if (!point) {
              return;
            }
            onToggleLens(point);
          }
          : undefined
      }
      onMouseLeave={
        lensEnabled
          ? () => {
            pointerDownRef.current = null;
            if (!lensActive) {
              return;
            }
            onHideLens();
          }
          : undefined
      }
    >
      <Page
        pageNumber={page}
        width={frameWidth}
        renderTextLayer
        renderAnnotationLayer={false}
        loading={null}
        onRenderSuccess={onRenderSuccess}
      />
      <PdfAnnotationLayer
        page={page}
        mode={mode}
        readOnly={readOnly}
        highlightColor={highlightColor}
        highlightWidth={highlightWidth}
        highlightOpacity={highlightOpacity}
        textColor={textColor}
        textBoxStylePreset={textBoxStylePreset}
        strokes={strokes}
        textBoxes={textBoxes}
        onStrokesChange={onStrokesChange}
        onTextBoxesChange={onTextBoxesChange}
        t={t}
      />
    </div>
  );
}
