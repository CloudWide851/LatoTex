import * as pdfjsLib from "/assets/vendor/pdf.min.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "/assets/vendor/pdf.worker.min.mjs";
const PDF_CMAP_URL = "/assets/vendor/cmaps/";
const PDF_STANDARD_FONT_DATA_URL = "/assets/vendor/standard_fonts/";

export function createSharePdfController({ sid, getPassword, i18n, state, el, setStatus }) {
  const pageRenderTasks = new Map();
  let renderEpoch = 0;
  let resizeTimer = 0;
  let scrollRaf = 0;
  const resizeObserver = typeof ResizeObserver === "function"
    ? new ResizeObserver(() => {
      if (state.view !== "pdf" || !state.pdfDoc) {
        return;
      }
      window.clearTimeout(resizeTimer);
      resizeTimer = window.setTimeout(() => {
        void renderAllPdfPages().catch((error) => {
          setStatus(i18n.statusPdfLoadFailed(String(error)), true);
        });
      }, 120);
    })
    : null;

  if (resizeObserver && el.pdfCanvasWrap) {
    resizeObserver.observe(el.pdfCanvasWrap);
  }

  function cancelAllRenderTasks() {
    for (const task of pageRenderTasks.values()) {
      task.cancel();
    }
    pageRenderTasks.clear();
  }

  function updatePdfPageLabel() {
    const total = state.pdfDoc?.numPages || 1;
    const page = Math.max(1, Math.min(total, state.pdfPage || 1));
    state.pdfPage = page;
    el.pdfPage.textContent = i18n.pdfPageLabel(page, total);
  }

  function clearPdfPages() {
    el.pdfPages.innerHTML = "";
  }

  function setPdfPlaceholder(message, { clearPages = true } = {}) {
    cancelAllRenderTasks();
    renderEpoch += 1;
    el.pdfCanvas.hidden = true;
    if (clearPages) {
      clearPdfPages();
    }
    el.pdfEmpty.hidden = false;
    el.pdfEmpty.textContent = message;
  }

  function showPdfPages() {
    el.pdfEmpty.hidden = true;
    el.pdfCanvas.hidden = true;
  }

  function ensurePdfPages() {
    const total = state.pdfDoc?.numPages || 0;
    if (total === 0) {
      clearPdfPages();
      return [];
    }
    const existing = Array.from(el.pdfPages.querySelectorAll("[data-pdf-page-card='true']"));
    if (existing.length === total) {
      return existing;
    }
    clearPdfPages();
    const cards = [];
    for (let pageNumber = 1; pageNumber <= total; pageNumber += 1) {
      const card = document.createElement("article");
      card.className = "pdf-page-card";
      card.dataset.pdfPageCard = "true";
      card.dataset.pageNumber = String(pageNumber);
      const canvas = document.createElement("canvas");
      canvas.className = "pdf-page-canvas";
      canvas.dataset.pageNumber = String(pageNumber);
      card.appendChild(canvas);
      el.pdfPages.appendChild(card);
      cards.push(card);
    }
    return cards;
  }

  function resolveVisiblePdfPage() {
    const cards = Array.from(el.pdfPages.querySelectorAll("[data-pdf-page-card='true']"));
    if (cards.length === 0) {
      return 1;
    }
    const scrollMiddle = el.pdfCanvasWrap.scrollTop + el.pdfCanvasWrap.clientHeight / 2;
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
    return bestPage;
  }

  function schedulePageLabelRefresh() {
    if (scrollRaf) {
      return;
    }
    scrollRaf = window.requestAnimationFrame(() => {
      scrollRaf = 0;
      if (!state.pdfDoc) {
        updatePdfPageLabel();
        return;
      }
      state.pdfPage = resolveVisiblePdfPage();
      updatePdfPageLabel();
    });
  }

  async function renderPdfPageCanvas(pageNumber, epoch) {
    const canvas = el.pdfPages.querySelector(`canvas[data-page-number='${pageNumber}']`);
    if (!(canvas instanceof HTMLCanvasElement)) {
      return;
    }
    const page = await state.pdfDoc.getPage(pageNumber);
    if (epoch !== renderEpoch) {
      return;
    }
    const baseViewport = page.getViewport({ scale: 1 });
    const containerWidth = Math.max((el.pdfCanvasWrap?.clientWidth || 0) - 88, 240);
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
    context.imageSmoothingEnabled = true;
    context.clearRect(0, 0, viewport.width, viewport.height);
    const renderTask = page.render({ canvasContext: context, viewport });
    pageRenderTasks.set(pageNumber, renderTask);
    try {
      await renderTask.promise;
      if (epoch === renderEpoch) {
        showPdfPages();
      }
    } catch (error) {
      if (error?.name === "RenderingCancelledException") {
        return;
      }
      throw error;
    } finally {
      if (pageRenderTasks.get(pageNumber) === renderTask) {
        pageRenderTasks.delete(pageNumber);
      }
    }
  }

  async function renderAllPdfPages() {
    if (!state.pdfDoc) {
      setPdfPlaceholder(i18n.noPdfPreview);
      updatePdfPageLabel();
      return;
    }
    cancelAllRenderTasks();
    renderEpoch += 1;
    const epoch = renderEpoch;
    ensurePdfPages();
    showPdfPages();
    for (let pageNumber = 1; pageNumber <= state.pdfDoc.numPages; pageNumber += 1) {
      await renderPdfPageCanvas(pageNumber, epoch);
      if (epoch !== renderEpoch) {
        return;
      }
    }
    schedulePageLabelRefresh();
  }

  function scrollToPdfPage(pageNumber, behavior = "smooth") {
    const total = state.pdfDoc?.numPages || 1;
    const targetPage = Math.max(1, Math.min(total, pageNumber || 1));
    state.pdfPage = targetPage;
    updatePdfPageLabel();
    const card = el.pdfPages.querySelector(`[data-pdf-page-card='true'][data-page-number='${targetPage}']`);
    if (!(card instanceof HTMLElement)) {
      return;
    }
    el.pdfCanvasWrap.scrollTo({
      top: Math.max(card.offsetTop - 12, 0),
      behavior,
    });
  }

  async function renderPdfPage() {
    if (!state.pdfDoc) {
      setPdfPlaceholder(i18n.noPdfPreview);
      updatePdfPageLabel();
      return;
    }
    if (el.pdfPages.childElementCount === 0) {
      await renderAllPdfPages();
    }
    scrollToPdfPage(state.pdfPage, "smooth");
  }

  async function fetchPdfStatus() {
    if (!state.connected) {
      return { ready: false };
    }
    const response = await fetch(`/api/pdf/status?sid=${encodeURIComponent(sid)}&pwd=${encodeURIComponent(getPassword())}&t=${Date.now()}`);
    if (!response.ok) {
      return { ready: false };
    }
    const payload = await response.json();
    return {
      ready: payload?.state === "ready",
      state: payload?.state,
      updatedAt: payload?.updatedAt ?? null,
    };
  }

  function clearPdfState(message) {
    state.pdfReady = false;
    state.pdfDoc = null;
    state.pdfUpdatedAt = null;
    setPdfPlaceholder(message);
    updatePdfPageLabel();
  }

  async function reloadPdfContent() {
    if (!state.connected) {
      return;
    }
    try {
      const status = await fetchPdfStatus().catch(() => ({ ready: false }));
      if (!status.ready) {
        clearPdfState(i18n.statusPdfPreparing);
        setStatus(i18n.statusPdfPreparing);
        return;
      }
      const alreadyLoaded = state.pdfDoc
        && state.pdfReady
        && ((state.pdfUpdatedAt && status.updatedAt && state.pdfUpdatedAt === status.updatedAt)
          || (!state.pdfUpdatedAt && !status.updatedAt));
      if (alreadyLoaded) {
        updatePdfPageLabel();
        setStatus(i18n.statusPdfReady);
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
      state.pdfUpdatedAt = status.updatedAt ?? null;
      state.pdfReady = true;
      if (state.pdfPage > state.pdfDoc.numPages) {
        state.pdfPage = state.pdfDoc.numPages;
      }
      if (state.pdfPage < 1) {
        state.pdfPage = 1;
      }
      await renderAllPdfPages();
      scrollToPdfPage(state.pdfPage, "auto");
      setStatus(i18n.statusPdfReady);
    } catch (error) {
      clearPdfState(i18n.noPdfPreview);
      setStatus(i18n.statusPdfLoadFailed(String(error)), true);
    }
  }

  function handlePdfScroll() {
    if (state.view !== "pdf" || !state.pdfDoc) {
      return;
    }
    schedulePageLabelRefresh();
  }

  el.pdfCanvasWrap?.addEventListener("scroll", handlePdfScroll, { passive: true });

  function dispose() {
    cancelAllRenderTasks();
    renderEpoch += 1;
    window.clearTimeout(resizeTimer);
    if (scrollRaf) {
      window.cancelAnimationFrame(scrollRaf);
      scrollRaf = 0;
    }
    resizeObserver?.disconnect();
    el.pdfCanvasWrap?.removeEventListener("scroll", handlePdfScroll);
  }

  return {
    dispose,
    reloadPdfContent,
    renderPdfPage,
    scrollToPdfPage,
    updatePdfPageLabel,
  };
}
