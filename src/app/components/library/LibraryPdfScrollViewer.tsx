import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type MutableRefObject,
} from "react";
import { Document, Page } from "react-pdf";
import { ensureReactPdfWorker } from "../pdf/reactPdfSetup";
import type {
  AnnotationStroke,
  AnnotationTextBox,
  AnnotationTextStylePreset,
} from "./annotationModel";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";

ensureReactPdfWorker();
const PDF_VIRTUAL_PADDING_PAGES = 3;

type ToolMode = "select" | "highlight" | "eraser" | "textbox";

type TranslationFn = (key: any) => string;

export type LibraryPdfScrollSyncGroup = {
  viewers: Map<string, (ratio: number) => void>;
  lastRatio: number;
};

type LibraryPdfScrollViewerProps = {
  pdfUrl: string;
  pageCount: number;
  zoom: number;
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
  onVisiblePageChange: (page: number) => void;
  onPageCountChange: (count: number) => void;
  onRequestToolConfig?: () => void;
  readOnly?: boolean;
  syncId?: string;
  syncGroupRef?: MutableRefObject<LibraryPdfScrollSyncGroup | null>;
  containerClassName?: string;
  t: TranslationFn;
};

export type LibraryPdfScrollViewerHandle = {
  scrollToPage: (page: number) => void;
};

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(0, Math.min(1, value));
}

function maxScrollTop(root: HTMLDivElement): number {
  return Math.max(0, root.scrollHeight - root.clientHeight);
}

function ensureSyncGroup(
  syncGroupRef?: MutableRefObject<LibraryPdfScrollSyncGroup | null>,
): LibraryPdfScrollSyncGroup | null {
  if (!syncGroupRef) {
    return null;
  }
  if (!syncGroupRef.current) {
    syncGroupRef.current = { viewers: new Map(), lastRatio: 0 };
  }
  return syncGroupRef.current;
}

export const LibraryPdfScrollViewer = forwardRef<
  LibraryPdfScrollViewerHandle,
  LibraryPdfScrollViewerProps
>(function LibraryPdfScrollViewer(props, ref) {
  const {
    pdfUrl,
    pageCount,
    zoom,
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
    onVisiblePageChange,
    onPageCountChange,
    onRequestToolConfig,
    readOnly = false,
    syncId = "viewer",
    syncGroupRef,
    containerClassName = "h-full overflow-auto rounded border border-slate-200 bg-slate-100 p-3 pr-7",
    t,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pendingScrollPageRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const syncResetRafRef = useRef<number | null>(null);
  const syncingScrollRef = useRef(false);
  const [viewportWidth, setViewportWidth] = useState(920);
  const [documentPages, setDocumentPages] = useState(Math.max(1, pageCount));
  const [visiblePage, setVisiblePage] = useState(1);
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(null);
  const lastVisiblePageRef = useRef<number>(1);

  const pages = useMemo(
    () => Array.from({ length: Math.max(1, documentPages) }, (_, index) => index + 1),
    [documentPages],
  );

  const frameWidth = useMemo(() => {
    const base = Math.max(360, Math.floor((viewportWidth - 42) * 0.92));
    return Math.floor(base * zoom);
  }, [viewportWidth, zoom]);
  const estimatedPageHeight = useMemo(
    () => Math.max(340, Math.floor(frameWidth * 1.42) + 16),
    [frameWidth],
  );

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
    setDocumentLoadError(null);
  }, [pdfUrl]);

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
    const group = ensureSyncGroup(syncGroupRef);
    if (!group) {
      return;
    }
    const applyRatio = (ratio: number) => {
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const limit = maxScrollTop(root);
      const targetTop = clampRatio(ratio) * limit;
      if (Math.abs(root.scrollTop - targetTop) < 2) {
        return;
      }
      syncingScrollRef.current = true;
      root.scrollTop = targetTop;
      if (syncResetRafRef.current !== null) {
        window.cancelAnimationFrame(syncResetRafRef.current);
      }
      syncResetRafRef.current = window.requestAnimationFrame(() => {
        syncingScrollRef.current = false;
        syncResetRafRef.current = null;
      });
    };
    group.viewers.set(syncId, applyRatio);
    applyRatio(group.lastRatio);
    return () => {
      group.viewers.delete(syncId);
      if (syncGroupRef?.current === group && group.viewers.size === 0) {
        syncGroupRef.current = null;
      }
      if (syncResetRafRef.current !== null) {
        window.cancelAnimationFrame(syncResetRafRef.current);
        syncResetRafRef.current = null;
      }
    };
  }, [syncGroupRef, syncId]);

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
        if (syncingScrollRef.current) {
          return;
        }
        const group = syncGroupRef?.current;
        if (!group) {
          return;
        }
        const limit = maxScrollTop(root);
        const ratio = limit > 0 ? root.scrollTop / limit : 0;
        group.lastRatio = clampRatio(ratio);
        for (const [viewerId, applyRatio] of group.viewers.entries()) {
          if (viewerId === syncId) {
            continue;
          }
          applyRatio(ratio);
        }
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
  }, [documentPages, estimatedPageHeight, onVisiblePageChange, syncGroupRef, syncId]);

  useEffect(() => {
    pendingScrollPageRef.current = null;
    pageRefs.current = {};
    setDocumentPages(Math.max(1, pageCount || 1));
    setVisiblePage(1);
    lastVisiblePageRef.current = 1;
    onVisiblePageChange(1);
    onPageCountChange(Math.max(1, pageCount || 1));
    if (scrollRef.current) {
      scrollRef.current.scrollTop = 0;
    }
  }, [onPageCountChange, onVisiblePageChange, pageCount, pdfUrl]);

  useEffect(() => {
    const group = syncGroupRef?.current;
    if (!group) {
      return;
    }
    const viewer = group.viewers.get(syncId);
    if (!viewer) {
      return;
    }
    const timer = window.setTimeout(() => viewer(group.lastRatio), 40);
    return () => window.clearTimeout(timer);
  }, [documentPages, pdfUrl, syncGroupRef, syncId, viewportWidth]);

  useEffect(() => {
    setDocumentLoadError(null);
  }, [pdfUrl]);

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

  const rootProps = {
    ref: scrollRef,
    className: containerClassName,
    onContextMenu: readOnly || !onRequestToolConfig
      ? undefined
      : (event: ReactMouseEvent<HTMLDivElement>) => {
          event.preventDefault();
          onRequestToolConfig();
        },
  };

  if (documentLoadError) {
    return (
      <div {...rootProps}>
        <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {t("library.viewer.error")} {documentLoadError}
        </div>
      </div>
    );
  }

  return (
    <div {...rootProps}>
      <Document
        key={pdfUrl}
        file={pdfUrl}
        loading={
          <div className="py-6 text-center text-xs text-slate-500">
            {t("library.viewer.loading")}
          </div>
        }
        onLoadSuccess={({ numPages }) => {
          setDocumentLoadError(null);
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
        onLoadError={(error) => {
          setDocumentLoadError(String(error || "pdf_load_failed"));
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
              className="relative mx-auto rounded bg-white shadow-sm"
              style={{ width: `${frameWidth}px` }}
            >
              {page >= Math.max(1, visiblePage - PDF_VIRTUAL_PADDING_PAGES)
              && page <= Math.min(documentPages, visiblePage + PDF_VIRTUAL_PADDING_PAGES) ? (
                <>
                  <Page
                    pageNumber={page}
                    width={frameWidth}
                    renderTextLayer={false}
                    renderAnnotationLayer={false}
                    loading={null}
                  />
                  {readOnly ? null : (
                    <PdfAnnotationLayer
                      page={page}
                      mode={mode}
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
                  )}
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
