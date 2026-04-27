import { useCallback, useEffect, useRef, useState, type RefObject } from "react";
import { fetchSharePdfBuffer, fetchSharePdfStatus } from "./shareApi";
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
  const renderEpochRef = useRef(0);
  const resizeTimerRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [placeholder, setPlaceholder] = useState(i18n.noPdfPreview);
  const [ready, setReady] = useState(false);
  const updatedAtRef = useRef<string | null>(null);

  const cancelRenderTasks = useCallback(() => {
    for (const task of renderTasksRef.current.values()) {
      task.cancel?.();
    }
    renderTasksRef.current.clear();
  }, []);

  const updatePageFromScroll = useCallback(() => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const cards = Array.from(root.querySelectorAll<HTMLElement>("[data-share-pdf-page='true']"));
    if (cards.length === 0) {
      setCurrentPage(1);
      return;
    }
    const scrollMiddle = root.scrollTop + root.clientHeight / 2;
    let bestPage = 1;
    let bestDistance = Number.POSITIVE_INFINITY;
    for (const card of cards) {
      const pageNumber = Number(card.dataset.pageNumber || 1);
      const pageMiddle = card.offsetTop + card.offsetHeight / 2;
      const distance = Math.abs(pageMiddle - scrollMiddle);
      if (distance < bestDistance) {
        bestDistance = distance;
        bestPage = pageNumber;
      }
    }
    setCurrentPage(bestPage);
  }, [containerRef]);

  const scrollToPage = useCallback((pageNumber: number, behavior: ScrollBehavior = "smooth") => {
    const root = containerRef.current;
    if (!root) {
      return;
    }
    const targetPage = Math.max(1, Math.min(pageCount, pageNumber || 1));
    setCurrentPage(targetPage);
    const card = root.querySelector<HTMLElement>(`[data-share-pdf-page='true'][data-page-number='${targetPage}']`);
    if (!card) {
      return;
    }
    root.scrollTo({
      top: Math.max(card.offsetTop - 12, 0),
      behavior,
    });
  }, [containerRef, pageCount]);

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

  const renderAllPages = useCallback(async () => {
    const root = containerRef.current;
    const pdfDoc = pdfDocRef.current;
    if (!root || !pdfDoc) {
      return;
    }
    cancelRenderTasks();
    renderEpochRef.current += 1;
    const epoch = renderEpochRef.current;
    root.innerHTML = "";
    for (let pageNumber = 1; pageNumber <= pdfDoc.numPages; pageNumber += 1) {
      const card = document.createElement("article");
      card.dataset.sharePdfPage = "true";
      card.dataset.pageNumber = String(pageNumber);
      card.className = "share-pdf-page-card";
      const canvas = document.createElement("canvas");
      canvas.className = "share-pdf-canvas";
      card.appendChild(canvas);
      root.appendChild(card);
      const page = await pdfDoc.getPage(pageNumber);
      if (epoch !== renderEpochRef.current) {
        return;
      }
      const baseViewport = page.getViewport({ scale: 1 });
      const containerWidth = Math.max(root.clientWidth - 48, 260);
      const scale = Math.max(containerWidth / Math.max(baseViewport.width, 1), 0.1);
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
      context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
      context.clearRect(0, 0, viewport.width, viewport.height);
      const renderTask = page.render({ canvasContext: context, viewport });
      renderTasksRef.current.set(pageNumber, renderTask);
      try {
        await renderTask.promise;
      } finally {
        if (renderTasksRef.current.get(pageNumber) === renderTask) {
          renderTasksRef.current.delete(pageNumber);
        }
      }
    }
    updatePageFromScroll();
  }, [cancelRenderTasks, containerRef, updatePageFromScroll]);

  const reload = useCallback(async (options?: { forceConnected?: boolean }) => {
    if (!(connected || options?.forceConnected) || !sid || !pwd) {
      return;
    }
    try {
      const status: { ready: boolean; state?: string; updatedAt?: string | null } =
        await fetchSharePdfStatus(sid, pwd).catch(() => ({ ready: false, updatedAt: null }));
      if (!status.ready) {
        pdfDocRef.current = null;
        updatedAtRef.current = null;
        setReady(false);
        setPageCount(1);
        setCurrentPage(1);
        setPlaceholder(i18n.statusPdfPreparing);
        onStatus(i18n.statusPdfPreparing);
        if (containerRef.current) {
          containerRef.current.innerHTML = "";
        }
        return;
      }
      const unchanged = pdfDocRef.current
        && ready
        && ((updatedAtRef.current && status.updatedAt && updatedAtRef.current === status.updatedAt)
          || (!updatedAtRef.current && !status.updatedAt));
      if (unchanged) {
        onStatus(i18n.statusPdfReady);
        return;
      }
      const pdfjs = await ensurePdfModule();
      const buffer = await fetchSharePdfBuffer(sid, pwd);
      const nextPdfDoc = await pdfjs.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: PDF_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
      }).promise;
      pdfDocRef.current = nextPdfDoc;
      updatedAtRef.current = status.updatedAt ?? null;
      setReady(true);
      setPageCount(nextPdfDoc.numPages);
      setCurrentPage((prev) => Math.min(Math.max(prev, 1), nextPdfDoc.numPages));
      setPlaceholder(i18n.noPdfPreview);
      await renderAllPages();
      scrollToPage(Math.min(currentPage, nextPdfDoc.numPages), "auto");
      onStatus(i18n.statusPdfReady);
    } catch (error) {
      pdfDocRef.current = null;
      updatedAtRef.current = null;
      setReady(false);
      setPageCount(1);
      setCurrentPage(1);
      setPlaceholder(i18n.noPdfPreview);
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      onStatus(i18n.statusPdfLoadFailed(String(error)), true);
    }
  }, [connected, containerRef, currentPage, ensurePdfModule, i18n, onStatus, pwd, ready, renderAllPages, scrollToPage, sid]);

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
            void renderAllPages().catch((error) => onStatus(i18n.statusPdfLoadFailed(String(error)), true));
          }, 120);
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
  }, [active, containerRef, i18n, onStatus, ready, renderAllPages, updatePageFromScroll]);

  return {
    ready,
    currentPage,
    pageCount,
    placeholder,
    reload,
    scrollToPage,
    goPrev: () => scrollToPage(currentPage - 1),
    goNext: () => scrollToPage(currentPage + 1),
    pageLabel: i18n.pdfPageLabel(currentPage, pageCount),
  };
}
