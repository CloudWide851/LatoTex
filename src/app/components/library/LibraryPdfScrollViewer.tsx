import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
} from "react";
import { Document, Page } from "react-pdf";
import { ensureReactPdfWorker } from "../pdf/reactPdfSetup";
import type { AnnotationStroke, AnnotationTextBox } from "./annotationModel";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";

ensureReactPdfWorker();

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
  const pendingScrollPageRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(920);
  const [documentPages, setDocumentPages] = useState(Math.max(1, pageCount));
  const lastVisiblePageRef = useRef<number>(1);

  const pages = useMemo(
    () => Array.from({ length: Math.max(1, documentPages) }, (_, index) => index + 1),
    [documentPages],
  );

  const frameWidth = useMemo(() => {
    const base = Math.max(360, Math.floor((viewportWidth - 42) * 0.92));
    return Math.floor(base * zoom);
  }, [viewportWidth, zoom]);

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      const normalized = Math.max(1, Math.min(documentPages || 1, Math.floor(page)));
      const target = pageRefs.current[normalized];
      if (!target) {
        pendingScrollPageRef.current = normalized;
        return;
      }
      pendingScrollPageRef.current = null;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }), [documentPages]);

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
      <Document
        file={pdfUrl}
        loading={
          <div className="py-6 text-center text-xs text-slate-500">
            {t("library.viewer.loading")}
          </div>
        }
        onLoadSuccess={({ numPages }) => {
          const next = Math.max(1, numPages || 1);
          setDocumentPages(next);
          onPageCountChange(next);
          const pending = pendingScrollPageRef.current;
          if (pending !== null) {
            window.setTimeout(() => {
              const target = pageRefs.current[Math.max(1, Math.min(next, pending))];
              if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
              }
              pendingScrollPageRef.current = null;
            }, 20);
          }
          if (lastVisiblePageRef.current > next) {
            lastVisiblePageRef.current = 1;
            onVisiblePageChange(1);
          }
        }}
        onLoadError={() => {
          setDocumentPages(1);
          onPageCountChange(1);
          lastVisiblePageRef.current = 1;
          onVisiblePageChange(1);
        }}
      >
        <div className="space-y-3">
          {pages.map((page) => (
            <div
              key={page}
              ref={(el) => {
                pageRefs.current[page] = el;
              }}
              data-page={page}
              className="relative mx-auto overflow-hidden rounded bg-white shadow-sm"
              style={{ width: `${frameWidth}px` }}
            >
              <Page
                pageNumber={page}
                width={frameWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={null}
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
      </Document>
    </div>
  );
});
