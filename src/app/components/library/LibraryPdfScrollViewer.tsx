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
const PDF_VIRTUAL_PADDING_PAGES = 2;

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
  const scrollRafRef = useRef<number | null>(null);
  const [viewportWidth, setViewportWidth] = useState(920);
  const [documentPages, setDocumentPages] = useState(Math.max(1, pageCount));
  const [visiblePage, setVisiblePage] = useState(1);
  const lastVisiblePageRef = useRef<number>(1);

  const pages = useMemo(
    () => Array.from({ length: Math.max(1, documentPages) }, (_, index) => index + 1),
    [documentPages],
  );

  const frameWidth = useMemo(() => {
    const base = Math.max(360, Math.floor((viewportWidth - 42) * 0.92));
    return Math.floor(base * zoom);
  }, [viewportWidth, zoom]);
  const estimatedPageHeight = useMemo(() => Math.max(340, Math.floor(frameWidth * 1.42) + 16), [frameWidth]);

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      const normalized = Math.max(1, Math.min(documentPages || 1, Math.floor(page)));
      const target = pageRefs.current[normalized];
      if (!target) {
        pendingScrollPageRef.current = normalized;
        if (scrollRef.current) {
          scrollRef.current.scrollTo({
            top: Math.max(0, (normalized - 1) * estimatedPageHeight),
            behavior: "smooth",
          });
        }
        return;
      }
      pendingScrollPageRef.current = null;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
    },
  }), [documentPages, estimatedPageHeight]);

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
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const updateVisiblePage = () => {
      const next = Math.max(
        1,
        Math.min(documentPages, Math.floor(root.scrollTop / Math.max(1, estimatedPageHeight)) + 1),
      );
      setVisiblePage((prev) => (prev === next ? prev : next));
      if (next !== lastVisiblePageRef.current) {
        lastVisiblePageRef.current = next;
        onVisiblePageChange(next);
      }
    };
    updateVisiblePage();
    const onScroll = () => {
      if (scrollRafRef.current !== null) {
        return;
      }
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updateVisiblePage();
      });
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      root.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [documentPages, estimatedPageHeight, onVisiblePageChange]);

  useEffect(() => {
    const pending = pendingScrollPageRef.current;
    if (pending === null) {
      return;
    }
    const target = pageRefs.current[pending];
    if (!target) {
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "start" });
    pendingScrollPageRef.current = null;
  }, [pages, visiblePage]);

  return (
    <div ref={scrollRef} className="h-full overflow-auto rounded border border-slate-200 bg-slate-100 p-3 pr-7">
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
          setVisiblePage((prev) => Math.max(1, Math.min(next, prev)));
          onPageCountChange(next);
          const pending = pendingScrollPageRef.current;
          if (pending !== null) {
            window.setTimeout(() => {
              const target = pageRefs.current[Math.max(1, Math.min(next, pending))];
              if (target) {
                target.scrollIntoView({ behavior: "smooth", block: "start" });
                pendingScrollPageRef.current = null;
              }
            }, 20);
          }
          if (lastVisiblePageRef.current > next) {
            lastVisiblePageRef.current = 1;
            onVisiblePageChange(1);
          }
        }}
        onLoadError={() => {
          setDocumentPages(1);
          setVisiblePage(1);
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
              {page >= Math.max(1, visiblePage - PDF_VIRTUAL_PADDING_PAGES) &&
              page <= Math.min(documentPages, visiblePage + PDF_VIRTUAL_PADDING_PAGES) ? (
                <>
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
                </>
              ) : (
                <div style={{ height: `${estimatedPageHeight}px` }} />
              )}
            </div>
          ))}
        </div>
      </Document>
    </div>
  );
});
