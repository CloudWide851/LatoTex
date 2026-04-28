import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { fetchSharePdfBuffer, fetchSharePdfStatus, type SharePdfStatus } from "./shareApi";
import {
  SHARE_PDF_PAGE_GAP,
  clampSharePdfPage,
  computeSharePdfPageTop,
  computeSharePdfTotalHeight,
  resolveSharePdfPageFromScroll,
  resolveVisibleSharePdfRange,
} from "./sharePdfVirtualizer";
import type { ShareI18n } from "./shareTypes";

type PdfModule = {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument: (input: {
    data: Uint8Array;
    cMapUrl: string;
    cMapPacked: boolean;
    standardFontDataUrl: string;
  }) => { promise: Promise<any> };
};

const PDF_CMAP_URL = "/assets/vendor/cmaps/";
const PDF_STANDARD_FONT_DATA_URL = "/assets/vendor/standard_fonts/";
const DEFAULT_PAGE_WIDTH = 720;
const DEFAULT_PAGE_HEIGHT = 980;

function statusVersion(status: SharePdfStatus): string | null {
  if (status.version) {
    return status.version;
  }
  if (status.updatedAt || status.sizeBytes) {
    return `${status.updatedAt ?? "unknown"}-${status.sizeBytes ?? 0}`;
  }
  return null;
}

function makeStage(root: HTMLDivElement, totalHeight: number): HTMLDivElement {
  let stage = root.querySelector<HTMLDivElement>("[data-share-pdf-stage='true']");
  if (!stage) {
    root.innerHTML = "";
    stage = document.createElement("div");
    stage.dataset.sharePdfStage = "true";
    stage.className = "share-pdf-stage";
    root.appendChild(stage);
  }
  stage.style.height = `${Math.max(1, Math.round(totalHeight))}px`;
  return stage;
}

function isPdfRenderCancelled(error: unknown): boolean {
  const message = String((error as { name?: string; message?: string } | null)?.name || (error as { message?: string } | null)?.message || error);
  return /cancel/i.test(message);
}

export function useSharePdfPreview(params: {
  sid: string;
  pwd: string;
  connected: boolean;
  i18n: ShareI18n;
  containerRef: RefObject<HTMLDivElement>;
  active: boolean;
  onStatus: (message: string, isError?: boolean) => void;
}) {
  const { sid, pwd, connected, i18n, containerRef, active, onStatus } = params;
  const pdfModuleRef = useRef<PdfModule | null>(null);
  const pdfDocRef = useRef<any>(null);
  const renderTasksRef = useRef(new Map<number, any>());
  const renderedPagesRef = useRef(new Set<number>());
  const pageNodesRef = useRef(new Map<number, HTMLElement>());
  const renderEpochRef = useRef(0);
  const resizeTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const versionRef = useRef<string | null>(null);
  const pageWidthRef = useRef(DEFAULT_PAGE_WIDTH);
  const pageHeightRef = useRef(DEFAULT_PAGE_HEIGHT);
  const [currentPage, setCurrentPageState] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [placeholder, setPlaceholder] = useState(i18n.noPdfPreview);
  const [ready, setReady] = useState(false);
  const currentPageRef = useRef(1);
  const pageCountRef = useRef(1);

  const setCurrentPage = useCallback((page: number) => {
    const next = clampSharePdfPage(page, pageCountRef.current);
    currentPageRef.current = next;
    setCurrentPageState((prev) => (prev === next ? prev : next));
  }, []);

  const clearRenderedPages = useCallback(() => {
    for (const task of renderTasksRef.current.values()) {
      task.cancel?.();
    }
    renderTasksRef.current.clear();
    renderedPagesRef.current.clear();
    pageNodesRef.current.clear();
    if (containerRef.current) {
      containerRef.current.innerHTML = "";
    }
  }, [containerRef]);

  const ensurePdfModule = useCallback(async () => {
    if (pdfModuleRef.current) {
      return pdfModuleRef.current;
    }
    const moduleUrl = "/assets/vendor/pdf.min.mjs";
    const module = await import(/* @vite-ignore */ moduleUrl) as PdfModule;
    module.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdf.worker.min.mjs";
    pdfModuleRef.current = module;
    return module;
  }, []);

  const resolvePageMetrics = useCallback(async () => {
    const root = containerRef.current;
    const pdfDoc = pdfDocRef.current;
    if (!root || !pdfDoc) {
      return;
    }
    const page = await pdfDoc.getPage(1);
    const baseViewport = page.getViewport({ scale: 1 });
    const containerWidth = Math.max(root.clientWidth - 32, 260);
    const scale = Math.max(containerWidth / Math.max(baseViewport.width, 1), 0.1);
    const viewport = page.getViewport({ scale });
    pageWidthRef.current = Math.round(viewport.width);
    pageHeightRef.current = Math.round(viewport.height);
  }, [containerRef]);

  const updatePageFromScroll = useCallback(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    setCurrentPage(resolveSharePdfPageFromScroll({
      scrollTop: root.scrollTop,
      clientHeight: root.clientHeight,
      pageCount: pageCountRef.current,
      pageSlotHeight: pageHeightRef.current + SHARE_PDF_PAGE_GAP,
    }));
  }, [containerRef, setCurrentPage]);

  const renderVisiblePages = useCallback(async () => {
    const root = containerRef.current;
    const pdfDoc = pdfDocRef.current;
    if (!root || !pdfDoc) {
      return;
    }
    renderEpochRef.current += 1;
    const epoch = renderEpochRef.current;
    const pageSlotHeight = pageHeightRef.current + SHARE_PDF_PAGE_GAP;
    const totalHeight = computeSharePdfTotalHeight(pdfDoc.numPages, pageSlotHeight);
    const stage = makeStage(root, totalHeight);
    const range = resolveVisibleSharePdfRange({
      scrollTop: root.scrollTop,
      clientHeight: root.clientHeight,
      pageCount: pdfDoc.numPages,
      pageSlotHeight,
    });
    const keep = new Set<number>();
    for (let pageNumber = range.start; pageNumber <= range.end; pageNumber += 1) {
      keep.add(pageNumber);
    }
    for (const [pageNumber, node] of pageNodesRef.current.entries()) {
      if (!keep.has(pageNumber)) {
        renderTasksRef.current.get(pageNumber)?.cancel?.();
        renderTasksRef.current.delete(pageNumber);
        renderedPagesRef.current.delete(pageNumber);
        node.remove();
        pageNodesRef.current.delete(pageNumber);
      }
    }
    for (let pageNumber = range.start; pageNumber <= range.end; pageNumber += 1) {
      if (renderedPagesRef.current.has(pageNumber) || renderTasksRef.current.has(pageNumber)) {
        continue;
      }
      const shell = document.createElement("article");
      shell.dataset.sharePdfPage = "true";
      shell.dataset.pageNumber = String(pageNumber);
      shell.className = "share-pdf-page-shell";
      shell.style.top = `${computeSharePdfPageTop(pageNumber, pageSlotHeight)}px`;
      shell.style.width = `${pageWidthRef.current}px`;
      shell.style.minHeight = `${pageHeightRef.current}px`;
      const canvas = document.createElement("canvas");
      canvas.className = "share-pdf-canvas";
      shell.appendChild(canvas);
      stage.appendChild(shell);
      pageNodesRef.current.set(pageNumber, shell);

      const page = await pdfDoc.getPage(pageNumber);
      if (epoch !== renderEpochRef.current || !pageNodesRef.current.has(pageNumber)) {
        return;
      }
      const baseViewport = page.getViewport({ scale: 1 });
      const scale = Math.max(pageWidthRef.current / Math.max(baseViewport.width, 1), 0.1);
      const viewport = page.getViewport({ scale });
      const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
      const context = canvas.getContext("2d", { alpha: false });
      if (!context) {
        throw new Error("pdf canvas context unavailable");
      }
      canvas.width = Math.max(1, Math.round(viewport.width * pixelRatio));
      canvas.height = Math.max(1, Math.round(viewport.height * pixelRatio));
      canvas.style.width = `${Math.round(viewport.width)}px`;
      canvas.style.height = `${Math.round(viewport.height)}px`;
      shell.style.width = `${Math.round(viewport.width)}px`;
      shell.style.minHeight = `${Math.round(viewport.height)}px`;
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const renderTask = page.render({ canvasContext: context, viewport });
      renderTasksRef.current.set(pageNumber, renderTask);
      try {
        await renderTask.promise;
        if (epoch === renderEpochRef.current && pageNodesRef.current.has(pageNumber)) {
          renderedPagesRef.current.add(pageNumber);
        }
      } catch (error) {
        if (!isPdfRenderCancelled(error)) {
          throw error;
        }
      } finally {
        if (renderTasksRef.current.get(pageNumber) === renderTask) {
          renderTasksRef.current.delete(pageNumber);
        }
      }
    }
    updatePageFromScroll();
  }, [containerRef, updatePageFromScroll]);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = "smooth") => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const targetPage = clampSharePdfPage(pageNumber, pageCountRef.current);
    setCurrentPage(targetPage);
    root.scrollTo({
      top: Math.max(computeSharePdfPageTop(targetPage, pageHeightRef.current + SHARE_PDF_PAGE_GAP) - 10, 0),
      behavior,
    });
    window.requestAnimationFrame(() => {
      void renderVisiblePages().catch((error) => onStatus(i18n.statusPdfLoadFailed(String(error)), true));
    });
  }, [containerRef, i18n, onStatus, renderVisiblePages, setCurrentPage]);

  const reload = useCallback(async (options?: { forceConnected?: boolean }) => {
    if (!(connected || options?.forceConnected) || !sid || !pwd) {
      return;
    }
    try {
      const status = await fetchSharePdfStatus(sid, pwd).catch(() => ({ ready: false } as SharePdfStatus));
      if (!status.ready) {
        pdfDocRef.current = null;
        versionRef.current = null;
        pageCountRef.current = 1;
        setReady(false);
        setPageCount(1);
        setCurrentPage(1);
        setPlaceholder(i18n.statusPdfPreparing);
        clearRenderedPages();
        onStatus(i18n.statusPdfPreparing);
        return;
      }
      const nextVersion = statusVersion(status);
      if (pdfDocRef.current && ready && versionRef.current === nextVersion) {
        await renderVisiblePages();
        onStatus(i18n.statusPdfReady);
        return;
      }
      renderEpochRef.current += 1;
      clearRenderedPages();
      const pdfjs = await ensurePdfModule();
      const buffer = await fetchSharePdfBuffer(sid, pwd, nextVersion);
      const nextPdfDoc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: PDF_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
      }).promise;
      pdfDocRef.current = nextPdfDoc;
      versionRef.current = nextVersion;
      pageCountRef.current = nextPdfDoc.numPages;
      setReady(true);
      setPageCount(nextPdfDoc.numPages);
      setCurrentPage(Math.min(currentPageRef.current, nextPdfDoc.numPages));
      setPlaceholder(i18n.noPdfPreview);
      await resolvePageMetrics();
      await renderVisiblePages();
      scrollToPage(Math.min(currentPageRef.current, nextPdfDoc.numPages), "auto");
      onStatus(i18n.statusPdfReady);
    } catch (error) {
      pdfDocRef.current = null;
      versionRef.current = null;
      pageCountRef.current = 1;
      setReady(false);
      setPageCount(1);
      setCurrentPage(1);
      setPlaceholder(i18n.noPdfPreview);
      clearRenderedPages();
      onStatus(i18n.statusPdfLoadFailed(String(error)), true);
    }
  }, [clearRenderedPages, connected, ensurePdfModule, i18n, onStatus, pwd, ready, renderVisiblePages, resolvePageMetrics, scrollToPage, setCurrentPage, sid]);

  useEffect(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const handleScroll = () => {
      if (scrollRafRef.current !== null) {
        return;
      }
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updatePageFromScroll();
        void renderVisiblePages().catch((error) => onStatus(i18n.statusPdfLoadFailed(String(error)), true));
      });
    };
    const resizeObserver = typeof ResizeObserver === "undefined"
      ? null
      : new ResizeObserver(() => {
          if (!ready || !active) {
            return;
          }
          if (resizeTimerRef.current !== null) {
            window.clearTimeout(resizeTimerRef.current);
          }
          resizeTimerRef.current = window.setTimeout(() => {
            renderEpochRef.current += 1;
            clearRenderedPages();
            void resolvePageMetrics()
              .then(renderVisiblePages)
              .catch((error) => onStatus(i18n.statusPdfLoadFailed(String(error)), true));
          }, 140);
        });
    root.addEventListener("scroll", handleScroll, { passive: true });
    resizeObserver?.observe(root);
    return () => {
      root.removeEventListener("scroll", handleScroll);
      resizeObserver?.disconnect();
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
      if (resizeTimerRef.current !== null) {
        window.clearTimeout(resizeTimerRef.current);
        resizeTimerRef.current = null;
      }
    };
  }, [active, clearRenderedPages, containerRef, i18n, onStatus, ready, renderVisiblePages, resolvePageMetrics, updatePageFromScroll]);

  const goPrev = useCallback(() => scrollToPage(currentPageRef.current - 1), [scrollToPage]);
  const goNext = useCallback(() => scrollToPage(currentPageRef.current + 1), [scrollToPage]);

  return useMemo(() => ({
    ready,
    currentPage,
    pageCount,
    placeholder,
    reload,
    scrollToPage,
    goPrev,
    goNext,
    pageLabel: i18n.pdfPageLabel(currentPage, pageCount),
  }), [currentPage, goNext, goPrev, i18n, pageCount, placeholder, ready, reload, scrollToPage]);
}
