import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import type { AnnotationStroke, AnnotationTextBox } from "./annotationModel";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";
import { buildPdfSrc } from "./viewerUtils";

type ToolMode = "select" | "highlight" | "eraser" | "textbox";

export type LibraryPdfScrollViewerHandle = {
  scrollToPage: (page: number) => void;
};

type TranslationFn = (key: any) => string;

export const LibraryPdfScrollViewer = forwardRef<
  LibraryPdfScrollViewerHandle,
  {
    pdfUrl: string;
    pageCount: number;
    zoom: number;
    mode: ToolMode;
    highlightColor: string;
    textColor: string;
    strokes: AnnotationStroke[];
    textBoxes: AnnotationTextBox[];
    onStrokesChange: (next: AnnotationStroke[]) => void;
    onTextBoxesChange: (next: AnnotationTextBox[]) => void;
    onVisiblePageChange: (page: number) => void;
    onPageCountChange: (count: number) => void;
    t: TranslationFn;
  }
>(function LibraryPdfScrollViewer(props, ref) {
  const {
    pdfUrl,
    pageCount,
    zoom,
    mode,
    highlightColor,
    textColor,
    strokes,
    textBoxes,
    onStrokesChange,
    onTextBoxesChange,
    onVisiblePageChange,
    onPageCountChange,
    t,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const [viewportWidth, setViewportWidth] = useState(920);
  const lastVisiblePageRef = useRef<number>(1);

  const pages = useMemo(
    () => Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1),
    [pageCount],
  );

  const frameWidth = useMemo(() => {
    const base = Math.max(360, Math.floor((viewportWidth - 42) * 0.92));
    return Math.floor(base * zoom);
  }, [viewportWidth, zoom]);
  const frameHeight = Math.max(520, Math.floor(frameWidth * 1.4142));
  const renderQualityScale = 1.22;

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      const normalized = Math.max(1, Math.min(pageCount || 1, Math.floor(page)));
      const target = pageRefs.current[normalized];
      if (!target) {
        return;
      }
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }), [pageCount]);

  useEffect(() => {
    onPageCountChange(Math.max(1, pageCount));
  }, [onPageCountChange, pageCount]);

  useEffect(() => {
    if (!scrollRef.current || pages.length === 0) {
      return;
    }
    if (typeof ResizeObserver === "undefined") {
      setViewportWidth(scrollRef.current.clientWidth || 920);
      return;
    }
    const observer = new ResizeObserver(() => {
      if (scrollRef.current) {
        setViewportWidth(scrollRef.current.clientWidth || 920);
      }
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [pages.length]);

  useEffect(() => {
    if (!scrollRef.current || pages.length === 0) {
      return;
    }
    const root = scrollRef.current;
    const observer = new IntersectionObserver(
      (entries) => {
        let next = lastVisiblePageRef.current;
        let bestRatio = 0;
        for (const entry of entries) {
          if (!entry.isIntersecting) {
            continue;
          }
          const pageAttr = Number((entry.target as HTMLElement).dataset.page ?? "0");
          if (!Number.isFinite(pageAttr) || pageAttr <= 0) {
            continue;
          }
          if (entry.intersectionRatio > bestRatio) {
            bestRatio = entry.intersectionRatio;
            next = pageAttr;
          }
        }
        if (next !== lastVisiblePageRef.current) {
          lastVisiblePageRef.current = next;
          onVisiblePageChange(next);
        }
      },
      {
        root,
        threshold: [0.25, 0.5, 0.75, 0.9],
      },
    );
    for (const page of pages) {
      const el = pageRefs.current[page];
      if (el) {
        observer.observe(el);
      }
    }
    return () => observer.disconnect();
  }, [onVisiblePageChange, pages]);

  return (
    <div ref={scrollRef} className="h-full overflow-auto rounded border border-slate-200 bg-slate-100 p-3">
      <div className="space-y-3">
        {pages.map((page) => (
          <div
            key={page}
            ref={(el) => {
              pageRefs.current[page] = el;
            }}
            data-page={page}
            className="relative mx-auto rounded bg-white shadow-sm"
            style={{ width: `${frameWidth}px`, height: `${frameHeight}px` }}
          >
            <iframe
              title={`${t("library.viewer.showPdf")} ${page}`}
              src={buildPdfSrc(pdfUrl, page, zoom, renderQualityScale)}
              className="h-full w-full border-0"
              style={{
                pointerEvents: "none",
                width: `${renderQualityScale * 100}%`,
                height: `${renderQualityScale * 100}%`,
                transformOrigin: "top left",
                transform: `scale(${1 / renderQualityScale})`,
                willChange: "transform",
              }}
            />
            <PdfAnnotationLayer
              page={page}
              mode={mode}
              highlightColor={highlightColor}
              textColor={textColor}
              strokes={strokes}
              textBoxes={textBoxes}
              onStrokesChange={onStrokesChange}
              onTextBoxesChange={onTextBoxesChange}
              t={t}
            />
          </div>
        ))}
      </div>
    </div>
  );
});
