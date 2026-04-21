import { useEffect, useRef } from "react";
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
  onMoveLens: (point: LensPendingPoint) => void;
  onHideLens: () => void;
  onLayoutChange: () => void;
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
    onMoveLens,
    onHideLens,
    onLayoutChange,
    onRenderSuccess,
    onStrokesChange,
    onTextBoxesChange,
    t,
  } = props;
  const pageContainerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!pageContainerRef.current) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      onLayoutChange();
      return;
    }
    const observer = new ResizeObserver(() => {
      onLayoutChange();
    });
    observer.observe(pageContainerRef.current);
    return () => observer.disconnect();
  }, [onLayoutChange]);

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

  const isAnnotationInteractionTarget = (target: EventTarget | null): boolean => {
    if (!(target instanceof HTMLElement)) {
      return false;
    }
    return Boolean(
      target.closest("[data-annotation-ignore-lens='true']")
      || target.closest("[data-textbox-content='true']")
      || target.closest("[data-annotation-layer='true']")
      || target.closest("[data-annotation-box='true']")
      || target.closest("[data-textbox-move-handle='true']")
      || target.closest("[data-textbox-resize-handle='true']")
      || target.closest("[data-textbox-menu='true']"),
    );
  };

  return (
    <div
      ref={(element) => {
        pageContainerRef.current = element;
        pageRefs.current[page] = element;
      }}
      data-page={page}
      className="relative mx-auto bg-white"
      style={{ width: `${frameWidth}px` }}
      onMouseMove={
        lensEnabled
          ? (event) => {
            if (isAnnotationInteractionTarget(event.target)) {
              return;
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
      onMouseLeave={
        lensEnabled
          ? () => {
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
