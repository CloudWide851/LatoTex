import * as pdfjsLib from "/assets/vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdf.worker.min.mjs";
const PDF_CMAP_URL = "/assets/vendor/cmaps/";
const PDF_STANDARD_FONT_DATA_URL = "/assets/vendor/standard_fonts/";

export function createSharePdfController({ sid, getPassword, i18n, state, el, setStatus }) {
  let activeRenderTask = null;
  let resizeTimer = 0;
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      if (state.view !== "pdf" || !state.pdfDoc) {
        return;
      }
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        void renderPdfCanvasPage().catch((error) => {
          setStatus(i18n.statusPdfLoadFailed(String(error)), true);
        });
      }, 80);
    })
    : null;

  if (resizeObserver && el.pdfCanvasWrap) {
    resizeObserver.observe(el.pdfCanvasWrap);
  }

  function updatePdfPageLabel() {
    const total = state.pdfDoc?.numPages || 1;
    const page = Math.max(1, Math.min(total, state.pdfPage || 1));
    state.pdfPage = page;
    el.pdfPage.textContent = i18n.pdfPageLabel(page, total);
  }

  function setPdfPlaceholder(message, { hideCanvas = true } = {}) {
    if (activeRenderTask) {
      activeRenderTask.cancel();
      activeRenderTask = null;
    }
    if (hideCanvas) {
      el.pdfCanvas.hidden = true;
    }
    el.pdfEmpty.hidden = false;
    el.pdfEmpty.textContent = message;
  }

  function showPdfCanvas() {
    el.pdfEmpty.hidden = true;
    el.pdfCanvas.hidden = false;
  }

  async function renderPdfCanvasPage() {
    if (!state.pdfDoc) {
      setPdfPlaceholder(i18n.noPdfPreview);
      updatePdfPageLabel();
      return;
    }
    updatePdfPageLabel();
    const page = await state.pdfDoc.getPage(state.pdfPage);
    const baseViewport = page.getViewport({ scale: 1 });
    const containerWidth = Math.max((el.pdfCanvasWrap?.clientWidth || 0) - 24, 240);
    const scale = Math.max(containerWidth / Math.max(baseViewport.width, 1), 0.1);
    const viewport = page.getViewport({ scale });
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    const canvas = el.pdfCanvas;
    const context = canvas.getContext("2d", { alpha: false });
    if (!context) {
      throw new Error("pdf canvas context unavailable");
    }
    canvas.width = Math.max(1, Math.round(viewport.width * pixelRatio));
    canvas.height = Math.max(1, Math.round(viewport.height * pixelRatio));
    canvas.style.width = `${Math.round(viewport.width)}px`;
    canvas.style.height = `${Math.round(viewport.height)}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);
    context.imageSmoothingEnabled = true;
    context.clearRect(0, 0, viewport.width, viewport.height);
    if (activeRenderTask) {
      activeRenderTask.cancel();
    }
    activeRenderTask = page.render({ canvasContext: context, viewport });
    try {
      await activeRenderTask.promise;
      showPdfCanvas();
    } catch (error) {
      if (error?.name === "RenderingCancelledException") {
        return;
      }
      throw error;
    } finally {
      if (activeRenderTask?.promise) {
        activeRenderTask = null;
      }
    }
  }

  async function renderPdfPage() {
    await renderPdfCanvasPage();
  }

  async function fetchPdfStatus() {
    if (!state.connected) return { ready: false };
    const response = await fetch(`/api/pdf/status?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(getPassword())}&t=${Date.now()}`);
    if (!response.ok) return { ready: false };
    const payload = await response.json();
    return {
      ready: payload?.state === "ready",
      state: payload?.state,
      updatedAt: payload?.updatedAt,
    };
  }

  function clearPdfState(message) {
    state.pdfReady = false;
    state.pdfDoc = null;
    setPdfPlaceholder(message);
    updatePdfPageLabel();
  }

  async function reloadPdfContent() {
    if (!state.connected) return;
    try {
      const status = await fetchPdfStatus().catch(() => ({ ready: false }));
      if (!status.ready) {
        clearPdfState(i18n.statusPdfPreparing);
        setStatus(i18n.statusPdfPreparing);
        return;
      }
      const pdfUrl = `/api/pdf?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(getPassword())}&t=${Date.now()}`;
      const response = await fetch(pdfUrl);
      if (!response.ok) {
        clearPdfState(i18n.noPdfPreview);
        setStatus(i18n.statusPdfLoadFailed(await response.text()), true);
        return;
      }
      const buffer = await response.arrayBuffer();
      state.pdfDoc = await pdfjsLib.getDocument({
        data: new Uint8Array(buffer),
        cMapUrl: PDF_CMAP_URL,
        cMapPacked: true,
        standardFontDataUrl: PDF_STANDARD_FONT_DATA_URL,
      }).promise;
      state.pdfReady = true;
      if (state.pdfPage > state.pdfDoc.numPages) state.pdfPage = state.pdfDoc.numPages;
      if (state.pdfPage < 1) state.pdfPage = 1;
      await renderPdfPage();
      setStatus(i18n.statusPdfReady);
    } catch (error) {
      clearPdfState(i18n.noPdfPreview);
      setStatus(i18n.statusPdfLoadFailed(String(error)), true);
    }
  }

  function dispose() {
    if (activeRenderTask) {
      activeRenderTask.cancel();
      activeRenderTask = null;
    }
    window.clearTimeout(resizeTimer);
    resizeObserver?.disconnect();
  }

  return {
    dispose,
    reloadPdfContent,
    renderPdfPage,
    updatePdfPageLabel,
  };
}
