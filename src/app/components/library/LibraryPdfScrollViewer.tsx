import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState, type MouseEvent, type WheelEvent as ReactWheelEvent } from "react";
import { Document } from "react-pdf";
import { ensureReactPdfWorker } from "../pdf/reactPdfSetup";
import { LibraryPdfLensOverlay } from "./LibraryPdfLensOverlay";
import { LibraryPdfScrollViewerPage } from "./LibraryPdfScrollViewerPage";
import { resolvePdfScrollAnchor, resolveScrollTopForPdfAnchor, resolveVisiblePdfPage, type PdfScrollAnchor } from "./libraryPdfScrollState";
import { collectPdfPageMetrics, ensurePdfScrollSyncGroup, maxPdfScrollTop } from "./libraryPdfScrollViewerShared";
import { arePdfScrollAnchorsEqual, type LensPendingPoint, type LibraryPdfScrollViewerHandle, type LibraryPdfScrollViewerProps, LENS_SCALE, LENS_SIZE, MAX_LIBRARY_PDF_ZOOM, MIN_LIBRARY_PDF_ZOOM, normalizePdfScrollAnchor } from "./libraryPdfScrollViewerConfig";
import { WORKSPACE_LAYOUT_REFRESH_EVENT } from "../../hooks/workspaceLayoutRefresh";

ensureReactPdfWorker();
export type { LibraryPdfScrollViewerHandle } from "./libraryPdfScrollViewerConfig";

function isPdfViewerWheelTarget(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && !target.closest(
    "[contenteditable='true'],[data-textbox-editing='true'],[data-textbox-menu='true']",
  );
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
    containerClassName = "library-scrollbar relative min-h-0 min-w-0 h-full overflow-x-auto overflow-y-scroll rounded border border-slate-200 bg-slate-100",
    documentClassName = "mx-auto flex w-max min-w-full flex-col gap-3 p-3 pr-4 pb-4",
    onZoomChange,
    initialScrollAnchor = null,
    onScrollAnchorChange,
    initialScrollRatio = 0,
    onScrollRatioChange,
    enableLens = true,
    onDocumentLoadError,
    t,
  } = props;

  const scrollRef = useRef<HTMLDivElement | null>(null);
  const pageRefs = useRef<Record<number, HTMLDivElement | null>>({});
  const pendingScrollPageRef = useRef<number | null>(null);
  const renderedPagesRef = useRef<Set<number>>(new Set());
  const pendingRenderRestoreRef = useRef(true);
  const pendingRestoreAnchorRef = useRef<PdfScrollAnchor>(
    normalizePdfScrollAnchor(initialScrollAnchor, initialScrollRatio),
  );
  const lastReportedScrollRatioRef = useRef(pendingRestoreAnchorRef.current.absoluteRatio);
  const lastReportedScrollAnchorRef = useRef<PdfScrollAnchor>(pendingRestoreAnchorRef.current);
  const scrollRafRef = useRef<number | null>(null);
  const syncResetRafRef = useRef<number | null>(null);
  const restoreRafRef = useRef<number | null>(null);
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
  const lastVisiblePageRef = useRef(1);
  const [viewportWidth, setViewportWidth] = useState(920);
  const [documentPages, setDocumentPages] = useState(Math.max(1, pageCount));
  const [documentLoadError, setDocumentLoadError] = useState<string | null>(null);
  const [lensActive, setLensActive] = useState(false);
  const [lensVisible, setLensVisible] = useState(false);
  const [lensPage, setLensPage] = useState(1);
  const lensEnabled = enableLens && (readOnly || mode === "select");

  const pages = useMemo(() => Array.from({ length: Math.max(1, documentPages) }, (_, index) => index + 1), [documentPages]);
  const frameWidth = useMemo(() => {
    const base = Math.max(360, Math.floor((viewportWidth - 42) * 0.92));
    return Math.floor(base * zoom);
  }, [viewportWidth, zoom]);
  const lensPageWidth = useMemo(() => Math.max(280, Math.floor(frameWidth * LENS_SCALE)), [frameWidth]);

  const updateVisiblePage = useCallback(() => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const next = resolveVisiblePdfPage(collectPdfPageMetrics(pageRefs.current, documentPages), root.scrollTop, root.clientHeight);
    if (next !== lastVisiblePageRef.current) {
      lastVisiblePageRef.current = next;
      onVisiblePageChange(next);
    }
  }, [documentPages, onVisiblePageChange]);

  const emitScrollAnchor = useCallback((anchor: PdfScrollAnchor) => {
    const normalized = normalizePdfScrollAnchor(anchor);
    pendingRestoreAnchorRef.current = normalized;
    if (!arePdfScrollAnchorsEqual(lastReportedScrollAnchorRef.current, normalized)) {
      lastReportedScrollAnchorRef.current = normalized;
      onScrollAnchorChange?.(normalized);
    }
    if (Math.abs(lastReportedScrollRatioRef.current - normalized.absoluteRatio) >= 0.002) {
      lastReportedScrollRatioRef.current = normalized.absoluteRatio;
      onScrollRatioChange?.(normalized.absoluteRatio);
    }
  }, [onScrollAnchorChange, onScrollRatioChange]);

  const restoreScrollAnchor = useCallback((anchor?: PdfScrollAnchor | null) => {
    const root = scrollRef.current;
    if (!root) {
      return;
    }
    const normalized = normalizePdfScrollAnchor(anchor ?? pendingRestoreAnchorRef.current);
    pendingRestoreAnchorRef.current = normalized;
    if (restoreRafRef.current !== null) {
      window.cancelAnimationFrame(restoreRafRef.current);
    }
    restoreRafRef.current = window.requestAnimationFrame(() => {
      restoreRafRef.current = null;
      const limit = maxPdfScrollTop(root);
      const nextTop = resolveScrollTopForPdfAnchor(
        collectPdfPageMetrics(pageRefs.current, documentPages),
        normalized,
        root.clientHeight,
        limit,
      );
      if (Math.abs(root.scrollTop - nextTop) >= 2) {
        syncingScrollRef.current = true;
        root.scrollTop = nextTop;
        if (syncResetRafRef.current !== null) {
          window.cancelAnimationFrame(syncResetRafRef.current);
        }
        syncResetRafRef.current = window.requestAnimationFrame(() => {
          syncingScrollRef.current = false;
          syncResetRafRef.current = null;
          updateVisiblePage();
        });
      } else {
        updateVisiblePage();
      }
      emitScrollAnchor(normalized);
    });
  }, [documentPages, emitScrollAnchor, updateVisiblePage]);
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
    renderedPagesRef.current = new Set();
    pendingRenderRestoreRef.current = true;
  }, [pdfUrl]);
  useEffect(() => {
    return () => {
      if (lensRafRef.current !== null) {
        window.cancelAnimationFrame(lensRafRef.current);
      }
      if (restoreRafRef.current !== null) {
        window.cancelAnimationFrame(restoreRafRef.current);
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
    const normalized = normalizePdfScrollAnchor(initialScrollAnchor, initialScrollRatio);
    const previous = pendingRestoreAnchorRef.current;
    pendingRestoreAnchorRef.current = normalized;
    if (!scrollRef.current) {
      lastReportedScrollAnchorRef.current = normalized;
      lastReportedScrollRatioRef.current = normalized.absoluteRatio;
      return;
    }
    if (
      arePdfScrollAnchorsEqual(previous, normalized)
      && arePdfScrollAnchorsEqual(lastReportedScrollAnchorRef.current, normalized)
    ) {
      return;
    }
    restoreScrollAnchor(normalized);
  }, [initialScrollAnchor, initialScrollRatio, restoreScrollAnchor]);
  useEffect(() => {
    if (!scrollRef.current || pages.length === 0) {
      return;
    }
    renderedPagesRef.current = new Set();
    pendingRenderRestoreRef.current = true;
    if (typeof ResizeObserver === "undefined") {
      setViewportWidth(scrollRef.current.clientWidth || 920);
      restoreScrollAnchor();
      return;
    }
    const observer = new ResizeObserver(() => {
      if (!scrollRef.current) {
        return;
      }
      setViewportWidth(scrollRef.current.clientWidth || 920);
      restoreScrollAnchor();
    });
    observer.observe(scrollRef.current);
    return () => observer.disconnect();
  }, [pages.length, restoreScrollAnchor]);

  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const handleLayoutRefresh = () => {
      if (!scrollRef.current) {
        return;
      }
      window.requestAnimationFrame(() => {
        setViewportWidth(scrollRef.current?.clientWidth || 920);
        renderedPagesRef.current = new Set();
        pendingRenderRestoreRef.current = true;
        restoreScrollAnchor();
      });
    };
    window.addEventListener(WORKSPACE_LAYOUT_REFRESH_EVENT, handleLayoutRefresh as EventListener);
    return () => {
      window.removeEventListener(WORKSPACE_LAYOUT_REFRESH_EVENT, handleLayoutRefresh as EventListener);
    };
  }, [restoreScrollAnchor]);
  useEffect(() => {
    const group = ensurePdfScrollSyncGroup(syncGroupRef);
    if (!group) {
      return;
    }
    const applyAnchor = (anchor: PdfScrollAnchor) => {
      const root = scrollRef.current;
      if (!root) {
        return;
      }
      const normalized = normalizePdfScrollAnchor(anchor);
      const limit = maxPdfScrollTop(root);
      const metrics = collectPdfPageMetrics(pageRefs.current, documentPages);
      const targetTop = resolveScrollTopForPdfAnchor(metrics, normalized, root.clientHeight, limit);
      pendingRestoreAnchorRef.current = normalized;
      emitScrollAnchor(normalized);
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
    group.viewers.set(syncId, applyAnchor);
    const initialAnchor =
      group.lastAnchor.absoluteRatio > 0 || group.lastAnchor.page !== 1 || group.lastAnchor.pageFocusRatio > 0
        ? group.lastAnchor
        : pendingRestoreAnchorRef.current;
    applyAnchor(initialAnchor);
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
  }, [documentPages, emitScrollAnchor, syncGroupRef, syncId, updateVisiblePage]);
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
        const limit = maxPdfScrollTop(root);
        const ratio = limit > 0 ? root.scrollTop / limit : 0;
        if (syncingScrollRef.current) {
          return;
        }
        const anchor = resolvePdfScrollAnchor(
          collectPdfPageMetrics(pageRefs.current, documentPages),
          root.scrollTop,
          root.clientHeight,
          ratio,
        );
        emitScrollAnchor(anchor);
        const group = syncGroupRef?.current;
        if (!group) {
          return;
        }
        group.lastAnchor = anchor;
        for (const [viewerId, applyAnchor] of group.viewers.entries()) {
          if (viewerId === syncId) {
            continue;
          }
          applyAnchor(anchor);
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
  }, [documentPages, emitScrollAnchor, syncGroupRef, syncId, updateVisiblePage]);

  useEffect(() => {
    pendingScrollPageRef.current = null;
    pageRefs.current = {};
    renderedPagesRef.current = new Set();
    pendingRenderRestoreRef.current = true;
    setDocumentPages(Math.max(1, pageCount || 1));
    lastVisiblePageRef.current = 1;
    onVisiblePageChange(1);
    onPageCountChange(Math.max(1, pageCount || 1));
    restoreScrollAnchor(normalizePdfScrollAnchor(initialScrollAnchor, initialScrollRatio));
  }, [initialScrollAnchor, initialScrollRatio, onPageCountChange, onVisiblePageChange, pageCount, pdfUrl, restoreScrollAnchor]);
  useEffect(() => {
    const group = syncGroupRef?.current;
    if (!group) {
      restoreScrollAnchor();
      return;
    }
    const viewer = group.viewers.get(syncId);
    if (!viewer) {
      restoreScrollAnchor();
      return;
    }
    const timer = window.setTimeout(() => {
      viewer(
        group.lastAnchor.absoluteRatio > 0 || group.lastAnchor.page !== 1 || group.lastAnchor.pageFocusRatio > 0
          ? group.lastAnchor
          : pendingRestoreAnchorRef.current,
      );
    }, 40);
    return () => window.clearTimeout(timer);
  }, [documentPages, pdfUrl, restoreScrollAnchor, syncGroupRef, syncId, viewportWidth]);
  useEffect(() => {
    const pending = pendingScrollPageRef.current;
    if (pending === null) {
      return;
    }
    const target = pageRefs.current[pending];
    const root = scrollRef.current;
    if (!target || !root) {
      return;
    }
    root.scrollTo({
      top: Math.max(0, target.offsetTop - 8),
      behavior: "smooth",
    });
    pendingScrollPageRef.current = null;
  }, [documentPages, pages, viewportWidth]);
  const rootProps = {
    ref: scrollRef,
    className: `${containerClassName}${lensEnabled && lensActive ? " cursor-zoom-out" : ""}`,
    tabIndex: 0,
    "data-library-pdf-scroll": "true",
    style: {
      touchAction: "pan-x pan-y" as const,
      overscrollBehavior: "contain" as const,
    },
    onWheelCapture: (event: ReactWheelEvent<HTMLDivElement>) => {
      const root = scrollRef.current;
      if (!root || event.ctrlKey || Math.abs(event.deltaY) < Math.abs(event.deltaX) || !isPdfViewerWheelTarget(event.target)) {
        return;
      }
      event.preventDefault();
      root.scrollTop += event.deltaY;
    },
    onWheel: (event: ReactWheelEvent<HTMLDivElement>) => {
      if (!event.ctrlKey || !onZoomChange) {
        return;
      }
      event.preventDefault();
      const step = event.deltaY < 0 ? 0.1 : -0.1;
      const nextZoom = Math.max(MIN_LIBRARY_PDF_ZOOM, Math.min(MAX_LIBRARY_PDF_ZOOM, Number((zoom + step).toFixed(2))));
      if (nextZoom !== zoom) {
        onZoomChange(nextZoom);
      }
    },
    onContextMenu: readOnly || !onRequestToolConfig ? undefined : (event: MouseEvent<HTMLDivElement>) => {
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
        loading={<div className="py-6 text-center text-xs text-slate-500">{t("library.viewer.loading")}</div>}
        onLoadSuccess={({ numPages }) => {
          setDocumentLoadError(null);
          renderedPagesRef.current = new Set();
          pendingRenderRestoreRef.current = true;
          const next = Math.max(1, numPages || 1);
          setDocumentPages(next);
          onPageCountChange(next);
          if (lastVisiblePageRef.current > next) {
            lastVisiblePageRef.current = 1;
            onVisiblePageChange(1);
          }
          window.requestAnimationFrame(() => {
            restoreScrollAnchor();
            updateVisiblePage();
            const pending = pendingScrollPageRef.current;
            const root = scrollRef.current;
            const target = pending === null ? null : pageRefs.current[Math.max(1, Math.min(next, pending))];
            if (pending !== null && root && target) {
              root.scrollTo({ top: Math.max(0, target.offsetTop - 8), behavior: "smooth" });
              pendingScrollPageRef.current = null;
            }
          });
        }}
        onLoadError={(error) => {
          const message = String(error || "pdf_load_failed");
          setDocumentLoadError(message);
          setDocumentPages(1);
          onPageCountChange(1);
          lastVisiblePageRef.current = 1;
          onVisiblePageChange(1);
          onDocumentLoadError?.(message);
        }}
        className={documentClassName}
      >
        {pages.map((page) => (
          <LibraryPdfScrollViewerPage
            key={page}
            page={page}
            frameWidth={frameWidth}
            lensEnabled={lensEnabled}
            lensActive={lensActive}
            readOnly={readOnly}
            mode={mode}
            highlightColor={highlightColor}
            highlightWidth={highlightWidth}
            highlightOpacity={highlightOpacity}
            textColor={textColor}
            textBoxStylePreset={textBoxStylePreset}
            strokes={strokes}
            textBoxes={textBoxes}
            pageRefs={pageRefs}
            scrollRef={scrollRef}
            pendingLensPointRef={pendingLensPointRef}
            onToggleLens={(point) => {
              setLensActive(point.visible);
              queueLensPoint(point);
            }}
            onMoveLens={queueLensPoint}
            onHideLens={() => {
              queueLensPoint({ ...pendingLensPointRef.current, visible: false });
            }}
            onRenderSuccess={() => {
              renderedPagesRef.current.add(page);
              const shouldRestoreAfterRender =
                pendingRenderRestoreRef.current
                && renderedPagesRef.current.size >= documentPages;
              const pending = pendingScrollPageRef.current;
              const root = scrollRef.current;
              const target = pending === null ? null : pageRefs.current[pending];
              if (!shouldRestoreAfterRender && !(pending !== null && root && target && target.offsetHeight > 0)) {
                return;
              }
              window.requestAnimationFrame(() => {
                if (shouldRestoreAfterRender) {
                  pendingRenderRestoreRef.current = false;
                  restoreScrollAnchor();
                  updateVisiblePage();
                }
                const nextPending = pendingScrollPageRef.current;
                const nextRoot = scrollRef.current;
                const nextTarget = nextPending === null ? null : pageRefs.current[nextPending];
                if (nextPending !== null && nextRoot && nextTarget && nextTarget.offsetHeight > 0) {
                  nextRoot.scrollTo({ top: Math.max(0, nextTarget.offsetTop - 8), behavior: "smooth" });
                  pendingScrollPageRef.current = null;
                }
              });
            }}
            onStrokesChange={onStrokesChange}
            onTextBoxesChange={onTextBoxesChange}
            t={t}
          />
        ))}
      </Document>
      <LibraryPdfLensOverlay
        active={lensEnabled && lensActive}
        visible={lensVisible}
        pdfUrl={pdfUrl}
        lensPage={lensPage}
        lensPageWidth={lensPageWidth}
        documentPages={documentPages}
        lensSize={LENS_SIZE}
        lensViewportRef={lensViewportRef}
        lensContentRef={lensContentRef}
      />
    </div>
  );
});
