import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type WheelEvent as ReactWheelEvent,
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
import { resolveVisiblePdfPage, type PdfPageMetrics } from "./libraryPdfScrollState";

ensureReactPdfWorker();

type ToolMode = "select" | "highlight" | "eraser" | "textbox";

type TranslationFn = (key: any) => string;

export type LibraryPdfScrollSyncGroup = {
  viewers: Map<string, (ratio: number) => void>;
  lastRatio: number;
};

type LensPendingPoint = {
  visible: boolean;
  viewportX: number;
  viewportY: number;
  pageX: number;
  pageY: number;
  pageNumber: number;
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
  documentClassName?: string;
  onZoomChange?: (next: number) => void;
  enableLens?: boolean;
  t: TranslationFn;
};

export type LibraryPdfScrollViewerHandle = {
  scrollToPage: (page: number) => void;
};

const MIN_LIBRARY_PDF_ZOOM = 0.7;
const MAX_LIBRARY_PDF_ZOOM = 2.4;
const LENS_SCALE = 1.6;
const LENS_SIZE = 220;

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

function collectPageMetrics(
  pageRefs: Record<number, HTMLDivElement | null>,
  pageCount: number,
): PdfPageMetrics[] {
  const metrics: PdfPageMetrics[] = [];
  for (let page = 1; page <= Math.max(1, pageCount); page += 1) {
    const node = pageRefs[page];
    if (!node) {
      continue;
    }
    metrics.push({
      page,
      top: node.offsetTop,
      height: node.offsetHeight,
    });
  }
  return metrics;
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
    containerClassName = "relative min-h-0 min-w-0 h-full overflow-auto rounded border border-slate-200 bg-slate-100",
    documentClassName = "space-y-3 p-3 pr-7",
    onZoomChange,
    enableLens = true,
    t,
  } = props;
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pendingScrollPageRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const syncResetRafRef = useRef<number | null>(null);
  const syncingScrollRef = useRef(false);
  const lensViewportRef = useRef<HTMLDivElement | null>(null);
  const lensContentRef = useRef<HTMLDivElement | null>(null);
  const lensRafRef = useRef<number | null>(null);
  const pendingLensPointRef = useRef<LensPendingPoint>({
    visible: false,
    viewportX: 0,
    viewportY: 0,
    pageX: 0,
    pageY: 0,
    pageNumber: 1,
  });
  const lensVisibleRef = useRef(false);
  const lensPageRef = useRef(1);
  const [viewportWidth, setViewportWidth] = useState(920);
  const [documentPages, setDocumentPages] = useState(Math.max(1, pageCount));
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(null);
  const [lensActive, setLensActive] = useState(false);
  const [lensVisible, setLensVisible] = useState(false);
  const [lensPage, setLensPage] = useState(1);
  const lastVisiblePageRef = useRef<number>(1);
  const lensEnabled = enableLens && (readOnly || mode === "select");

  const pages = useMemo(
    () => Array.from({ length: Math.max(1, documentPages) }, (_, index) => index + 1),
    [documentPages],
  );

  const frameWidth = useMemo(() => {
    const base = Math.max(360, Math.floor((viewportWidth - 42) * 0.92));
    return Math.floor(base * zoom);
  }, [viewportWidth, zoom]);
  const lensPageWidth = useMemo(
    () => Math.max(280, Math.floor(frameWidth * LENS_SCALE)),
    [frameWidth],
  );

  const updateVisiblePage = useCallback(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const next = resolveVisiblePdfPage(
      collectPageMetrics(pageRefs.current, documentPages),
      root.scrollTop,
      root.clientHeight,
    );
    if (next !== lastVisiblePageRef.current) {
      lastVisiblePageRef.current = next;
      onVisiblePageChange(next);
    }
  }, [documentPages, onVisiblePageChange]);

  const applyLensPoint = useCallback(() => {
    const lensViewport = lensViewportRef.current;
    const lensContent = lensContentRef.current;
    const pending = pendingLensPointRef.current;
    if (!lensViewport || !lensContent) {
      return;
    }

    if (pending.visible) {
      const left = pending.viewportX - LENS_SIZE / 2;
      const top = pending.viewportY - LENS_SIZE / 2;
      lensViewport.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      const tx = LENS_SIZE / 2 - pending.pageX * LENS_SCALE;
      const ty = LENS_SIZE / 2 - pending.pageY * LENS_SCALE;
      lensContent.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    } else {
      lensViewport.style.transform = "translate3d(-9999px, -9999px, 0)";
    }

    if (pending.pageNumber !== lensPageRef.current) {
      lensPageRef.current = pending.pageNumber;
      setLensPage(pending.pageNumber);
    }
    if (pending.visible !== lensVisibleRef.current) {
      lensVisibleRef.current = pending.visible;
      setLensVisible(pending.visible);
    }
  }, []);

  const queueLensPoint = useCallback((next: LensPendingPoint) => {
    pendingLensPointRef.current = next;
    if (lensRafRef.current !== null) {
      return;
    }
    lensRafRef.current = window.requestAnimationFrame(() => {
      lensRafRef.current = null;
      applyLensPoint();
    });
  }, [applyLensPoint]);

  useImperativeHandle(ref, () => ({
    scrollToPage: (page: number) => {
      const normalized = Math.max(1, Math.min(documentPages || 1, Math.floor(page)));
      const target = pageRefs.current[normalized];
      if (!target) {
        pendingScrollPageRef.current = normalized;
        return;
      }
      pendingScrollPageRef.current = null;
      const root = scrollRef.current;
      if (!root) {
        target.scrollIntoView({ behavior: "smooth", block: "start" });
        return;
      }
      root.scrollTo({
        top: Math.max(0, target.offsetTop - 8),
        behavior: "smooth",
      });
    },
  }), [documentPages]);

  useEffect(() => {
    setDocumentLoadError(null);
  }, [pdfUrl]);

  useEffect(() => {
    return () => {
      if (lensRafRef.current !== null) {
        window.cancelAnimationFrame(lensRafRef.current);
      }
    };
  }, []);

  useEffect(() => {
    setLensActive(false);
    queueLensPoint({
      ...pendingLensPointRef.current,
      visible: false,
      pageNumber: 1,
    });
  }, [pdfUrl, queueLensPoint]);

  useEffect(() => {
    if (lensEnabled) {
      return;
    }
    setLensActive(false);
    queueLensPoint({
      ...pendingLensPointRef.current,
      visible: false,
    });
  }, [lensEnabled, queueLensPoint]);

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
        updateVisiblePage();
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
  }, [syncGroupRef, syncId, updateVisiblePage]);

  useEffect(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
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
  }, [syncGroupRef, syncId, updateVisiblePage]);

  useEffect(() => {
    pendingScrollPageRef.current = null;
    pageRefs.current = {};
    setDocumentPages(Math.max(1, pageCount || 1));
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
    const pending = pendingScrollPageRef.current;
    if (pending === null) {
      return;
    }
    const target = pageRefs.current[pending];
    if (!target || !scrollRef.current) {
      return;
    }
    scrollRef.current.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "smooth",
    });
    pendingScrollPageRef.current = null;
  }, [documentPages, pages, viewportWidth]);

  const rootProps = {
    ref: scrollRef,
    className: `${containerClassName}${lensEnabled ? (lensActive ? " cursor-zoom-out" : " cursor-zoom-in") : ""}`,
    tabIndex: 0,
    style: { touchAction: "pan-y" as const },
    onWheel: (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || !onZoomChange) {
        return;
      }
      event.preventDefault();
      const step = event.deltaY < 0 ? 0.1 : -0.1;
      const nextZoom = Math.max(
        MIN_LIBRARY_PDF_ZOOM,
        Math.min(MAX_LIBRARY_PDF_ZOOM, Number((zoom + step).toFixed(2))),
      );
      if (nextZoom !== zoom) {
        onZoomChange(nextZoom);
      }
    },
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
          onPageCountChange(next);
          if (lastVisiblePageRef.current > next) {
            lastVisiblePageRef.current = 1;
            onVisiblePageChange(1);
          }
          window.requestAnimationFrame(() => {
            updateVisiblePage();
            const pending = pendingScrollPageRef.current;
            const root = scrollRef.current;
            const target = pending === null ? null : pageRefs.current[Math.max(1, Math.min(next, pending))];
            if (pending !== null && root && target) {
              root.scrollTo({
                top: Math.max(0, target.offsetTop - 8),
                behavior: "smooth",
              });
              pendingScrollPageRef.current = null;
            }
          });
        }}
        onLoadError={(error) => {
          setDocumentLoadError(String(error || "pdf_load_failed"));
          setDocumentPages(1);
          onPageCountChange(1);
          lastVisiblePageRef.current = 1;
          onVisiblePageChange(1);
        }}
        className={documentClassName}
      >
        {pages.map((page) => (
          <div
            key={page}
            ref={(el) => {
              pageRefs.current[page] = el;
            }}
            data-page={page}
            className="relative mx-auto overflow-hidden rounded border border-slate-200 bg-white shadow-sm"
            style={{ width: `${frameWidth}px` }}
          >
            <Page
              pageNumber={page}
              width={frameWidth}
              renderTextLayer={false}
              renderAnnotationLayer={false}
              loading={null}
              onRenderSuccess={() => {
                window.requestAnimationFrame(() => {
                  updateVisiblePage();
                  const pending = pendingScrollPageRef.current;
                  const root = scrollRef.current;
                  const target = pending === null ? null : pageRefs.current[pending];
                  if (pending !== null && root && target && target.offsetHeight > 0) {
                    root.scrollTo({
                      top: Math.max(0, target.offsetTop - 8),
                      behavior: "smooth",
                    });
                    pendingScrollPageRef.current = null;
                  }
                });
              }}
            />
            {lensEnabled ? (
              <div
                className="absolute inset-0 z-10"
                onClick={(event) => {
                  const viewportRect = scrollRef.current?.getBoundingClientRect();
                  const pageRect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                  if (!viewportRect) {
                    return;
                  }
                  const pageX = Math.max(0, Math.min(pageRect.width, event.clientX - pageRect.left));
                  const pageY = Math.max(0, Math.min(pageRect.height, event.clientY - pageRect.top));
                  const viewportX = event.clientX - viewportRect.left + (scrollRef.current?.scrollLeft || 0);
                  const viewportY = event.clientY - viewportRect.top + (scrollRef.current?.scrollTop || 0);
                  const nextActive = !lensActive;
                  setLensActive(nextActive);
                  queueLensPoint({
                    visible: nextActive,
                    pageNumber: page,
                    pageX,
                    pageY,
                    viewportX,
                    viewportY,
                  });
                }}
                onMouseMove={(event) => {
                  if (!lensActive) {
                    return;
                  }
                  const viewportRect = scrollRef.current?.getBoundingClientRect();
                  const pageRect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                  if (!viewportRect) {
                    return;
                  }
                  const pageX = Math.max(0, Math.min(pageRect.width, event.clientX - pageRect.left));
                  const pageY = Math.max(0, Math.min(pageRect.height, event.clientY - pageRect.top));
                  const viewportX = event.clientX - viewportRect.left + (scrollRef.current?.scrollLeft || 0);
                  const viewportY = event.clientY - viewportRect.top + (scrollRef.current?.scrollTop || 0);
                  queueLensPoint({
                    visible: true,
                    pageNumber: page,
                    pageX,
                    pageY,
                    viewportX,
                    viewportY,
                  });
                }}
                onMouseLeave={() => {
                  if (!lensActive) {
                    return;
                  }
                  queueLensPoint({
                    ...pendingLensPointRef.current,
                    visible: false,
                  });
                }}
              />
            ) : null}
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
          </div>
        ))}
      </Document>
      {lensEnabled && lensActive ? (
        <div
          ref={lensViewportRef}
          className={`pointer-events-none absolute z-30 overflow-hidden rounded-full border border-slate-200/80 bg-white/20 shadow-[0_18px_36px_rgba(15,23,42,0.28)] backdrop-blur-[1px] transition-opacity duration-75 ${
            lensVisible ? "opacity-100" : "opacity-0"
          }`}
          style={{
            width: `${LENS_SIZE}px`,
            height: `${LENS_SIZE}px`,
            left: "0px",
            top: "0px",
            transform: "translate3d(-9999px, -9999px, 0)",
            willChange: "transform",
          }}
        >
          <div
            ref={lensContentRef}
            className="absolute left-0 top-0"
            style={{
              width: `${lensPageWidth}px`,
              willChange: "transform",
              transform: "translate3d(0, 0, 0)",
            }}
          >
            <Document key={`lens-${pdfUrl}`} file={pdfUrl} loading={null} error={null}>
              <Page
                pageNumber={Math.max(1, Math.min(documentPages, lensPage))}
                width={lensPageWidth}
                renderTextLayer={false}
                renderAnnotationLayer={false}
                loading={null}
              />
            </Document>
          </div>
          <span
            className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-300/70"
            aria-hidden
          />
          <span
            className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-slate-300/70"
            aria-hidden
          />
        </div>
      ) : null}
    </div>
  );
});
