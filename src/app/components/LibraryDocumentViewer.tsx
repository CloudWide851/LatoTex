import {
  Check,
  Copy,
  ExternalLink,
  FileSearch,
  FileText,
  Languages,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openExternalLink } from "../../shared/api/app";
import { readFile, writeFile } from "../../shared/api/workspace";
import type { LibraryPdfScrollViewerHandle } from "./library/LibraryPdfScrollViewer";
import { HIGHLIGHT_COLORS, TEXT_COLORS } from "./library/annotationPalette";
import {
  parseAnnotationPayload,
  toLibraryAnnotationPath,
  type AnnotationPayload,
  type AnnotationStroke,
  type AnnotationTextStylePreset,
  type AnnotationTextBox,
} from "./library/annotationModel";
import { useLibraryPdfShortcuts } from "./library/useLibraryPdfShortcuts";
import { useLibraryTranslationPanel } from "./library/useLibraryTranslationPanel";
import { LibraryTranslationStatusToast } from "./library/LibraryTranslationStatusToast";
import { useLibraryDocumentData } from "./library/useLibraryDocumentData";
import { filenameFromPath } from "./library/viewerUtils";
import { LibraryViewerContentPanel } from "./library/LibraryViewerContentPanel";
type TranslationFn = (key: any) => string;
type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type ViewMode = "bib" | "pdf" | "compare";

export function LibraryDocumentViewer(props: {
  projectId: string | null;
  selectedPath: string | null;
  active: boolean;
  onAnalyzePaper: (path: string) => void;
  analysisRunning: boolean;
  persistedViewMode?: ViewMode | null;
  onPersistViewMode?: (mode: ViewMode) => void;
  translationModelId?: string | null;
  t: TranslationFn;
}) {
  const {
    projectId,
    selectedPath,
    active,
    onAnalyzePaper,
    analysisRunning,
    persistedViewMode,
    onPersistViewMode,
    translationModelId,
    t,
  } = props;
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState(false);
  const [viewMode, setViewMode] = useState<ViewMode>(persistedViewMode ?? "bib");
  const [annotationMode, setAnnotationMode] = useState<ToolMode>("select");
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0]);
  const [highlightWidth, setHighlightWidth] = useState<number>(16);
  const [highlightOpacity, setHighlightOpacity] = useState<number>(0.65);
  const [textColor, setTextColor] = useState<string>(TEXT_COLORS[0]);
  const [textBoxStylePreset, setTextBoxStylePreset] = useState<AnnotationTextStylePreset>("minimal");
  const [annotationStrokes, setAnnotationStrokes] = useState<AnnotationStroke[]>([]);
  const [annotationTextBoxes, setAnnotationTextBoxes] = useState<AnnotationTextBox[]>([]);
  const [annotationLoaded, setAnnotationLoaded] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageCount, setPageCount] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [pdfZoom, setPdfZoom] = useState(1);
  const [toolConfigSignal, setToolConfigSignal] = useState(0);
  const viewerRef = useRef<LibraryPdfScrollViewerHandle | null>(null);
  const lastAnnotationPayloadRef = useRef<string>("");
  const {
    loading,
    loadError,
    pdfPreviewLoading,
    pdfPreviewError,
    citation,
    paperPreview,
    paperPreviewLoading,
    paperPreviewError,
    bibPreview,
    pdfUrl,
    translatedPdfUrl,
    resolvedLink,
    refresh: refreshDocumentData,
    reset: resetDocumentData,
  } = useLibraryDocumentData({
    projectId,
    selectedPath,
    active,
  });
  const hasPdf = Boolean(pdfUrl);
  const hasTranslated = Boolean(translatedPdfUrl);
  const documentBusy = loading || pdfPreviewLoading;

  const {
    translationBusy,
    translationNotice,
    translationDetail,
    translationProgress,
    setTranslationNotice,
    resetTranslationState,
    runTranslation,
  } = useLibraryTranslationPanel({
    projectId,
    selectedPath,
    translationModelId,
    t,
  });

  const activeLink = useMemo(
    () => resolvedLink ?? citation?.urls?.[0] ?? null,
    [citation?.urls, resolvedLink],
  );
  const annotationPath = useMemo(
    () => (selectedPath ? toLibraryAnnotationPath(selectedPath) : null),
    [selectedPath],
  );
  const pageStrokeCount = useMemo(
    () => annotationStrokes.filter((item) => item.page === currentPage).length,
    [annotationStrokes, currentPage],
  );
  const pageTextBoxCount = useMemo(
    () => annotationTextBoxes.filter((item) => item.page === currentPage).length,
    [annotationTextBoxes, currentPage],
  );
  const hasComparePair = Boolean(hasPdf && translatedPdfUrl);

  const applyViewMode = useCallback((nextMode: ViewMode) => {
    setViewMode(nextMode);
    onPersistViewMode?.(nextMode);
  }, [onPersistViewMode]);

  useEffect(() => {
    if (!projectId || !selectedPath) {
      lastAnnotationPayloadRef.current = "";
      setLinkError(null);
      setCopyState(false);
      setAnnotationMode("select");
      setAnnotationStrokes([]);
      setAnnotationTextBoxes([]);
      setAnnotationLoaded(false);
      setCurrentPage(1);
      setPageCount(1);
      setPageInput("1");
      setPdfZoom(1);
      setHighlightWidth(16);
      setHighlightOpacity(0.65);
      setTextBoxStylePreset("minimal");
      setTranslationNotice(null);
      resetTranslationState();
      resetDocumentData();
      return;
    }

    setLinkError(null);
    setCopyState(false);
    setAnnotationMode("select");
    setCurrentPage(1);
    setPageCount(1);
    setPageInput("1");
    setPdfZoom(1);
    setHighlightWidth(16);
    setHighlightOpacity(0.65);
    setTextBoxStylePreset("minimal");
    setTranslationNotice(null);
    resetTranslationState();
  }, [projectId, resetDocumentData, resetTranslationState, selectedPath, setTranslationNotice]);

  useEffect(() => {
    let disposed = false;
    if (!projectId || !annotationPath) {
      lastAnnotationPayloadRef.current = "";
      setAnnotationLoaded(false);
      setAnnotationStrokes([]);
      setAnnotationTextBoxes([]);
      return;
    }
    setAnnotationLoaded(false);
    setAnnotationStrokes([]);
    setAnnotationTextBoxes([]);
    void readFile(projectId, annotationPath)
      .then((result) => {
        if (disposed) {
          return;
        }
        const parsed = parseAnnotationPayload(result.content);
        lastAnnotationPayloadRef.current = JSON.stringify({
          version: 4,
          strokes: parsed.strokes,
          textBoxes: parsed.textBoxes,
        });
        setAnnotationStrokes(parsed.strokes);
        setAnnotationTextBoxes(parsed.textBoxes);
      })
      .catch(() => {
        if (!disposed) {
          lastAnnotationPayloadRef.current = "";
          setAnnotationStrokes([]);
          setAnnotationTextBoxes([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setAnnotationLoaded(true);
        }
      });
    return () => {
      disposed = true;
    };
  }, [annotationPath, projectId]);

  useEffect(() => {
    if (!annotationLoaded || !projectId || !annotationPath) {
      return;
    }
    const timer = window.setTimeout(() => {
      const payload: AnnotationPayload = {
        version: 4,
        strokes: annotationStrokes,
        textBoxes: annotationTextBoxes,
      };
      const compact = JSON.stringify(payload);
      if (compact === lastAnnotationPayloadRef.current) {
        return;
      }
      lastAnnotationPayloadRef.current = compact;
      void writeFile(projectId, annotationPath, JSON.stringify(payload, null, 2));
    }, 420);
    return () => {
      window.clearTimeout(timer);
    };
  }, [annotationLoaded, annotationPath, annotationStrokes, annotationTextBoxes, projectId]);

  useEffect(() => {
    setViewMode(persistedViewMode ?? "bib");
  }, [persistedViewMode, projectId]);

  useEffect(() => {
    if (documentBusy) {
      return;
    }
    if (viewMode === "compare" && !hasComparePair) {
      setViewMode(hasPdf ? "pdf" : "bib");
      return;
    }
    if (viewMode === "pdf" && !hasPdf) {
      setViewMode("bib");
    }
  }, [documentBusy, hasComparePair, hasPdf, viewMode]);

  useEffect(() => {
    if (viewMode !== "pdf" || !hasPdf) {
      setAnnotationMode("select");
    }
  }, [hasPdf, viewMode]);

  useEffect(() => {
    if (currentPage <= pageCount) {
      return;
    }
    const next = Math.max(1, pageCount);
    setCurrentPage(next);
    setPageInput(String(next));
  }, [currentPage, pageCount]);

  const jumpToPage = useCallback((next: number) => {
    const normalized = Math.max(1, Math.min(pageCount || 1, Math.floor(next)));
    setCurrentPage(normalized);
    setPageInput(String(normalized));
    viewerRef.current?.scrollToPage(normalized);
  }, [pageCount]);

  const handleUndoCurrentPage = useCallback(() => {
    setAnnotationStrokes((items) => {
      const pageItems = items.filter((item) => item.page === currentPage);
      if (pageItems.length === 0) {
        return items;
      }
      const lastId = pageItems[pageItems.length - 1].id;
      return items.filter((item) => item.id !== lastId);
    });
  }, [currentPage]);

  const handleClearCurrentPage = useCallback(() => {
    setAnnotationStrokes((items) => items.filter((item) => item.page !== currentPage));
    setAnnotationTextBoxes((items) => items.filter((item) => item.page !== currentPage));
  }, [currentPage]);

  const handleRunTranslation = useCallback((onDone?: () => void) => {
    runTranslation(() => {
      void refreshDocumentData({ bustCache: true }).then(() => {
        onDone?.();
      });
    });
  }, [refreshDocumentData, runTranslation]);

  useLibraryPdfShortcuts({
    enabled: viewMode === "pdf" && hasPdf,
    currentPage,
    jumpToPage,
    setMode: setAnnotationMode,
    onUndo: handleUndoCurrentPage,
    setZoom: setPdfZoom,
  });

  const handleOpenLink = async () => {
    if (!activeLink) {
      return;
    }
    setLinkError(null);
    try {
      await openExternalLink(activeLink);
    } catch {
      setLinkError(t("library.viewer.linkOpenFailed"));
    }
  };

  const handleCopyLink = async () => {
    if (!activeLink || typeof navigator === "undefined" || !navigator.clipboard) {
      return;
    }
    try {
      await navigator.clipboard.writeText(activeLink);
      setCopyState(true);
      window.setTimeout(() => setCopyState(false), 1400);
    } catch {
      setLinkError(t("library.viewer.linkOpenFailed"));
    }
  };

  if (!selectedPath) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {t("library.noSelection")}
      </div>
    );
  }

  const actionBtnClass = "panel-topbar-btn motion-hover-rise inline-flex items-center justify-center rounded border border-slate-300 bg-white text-slate-700 hover:bg-slate-100 disabled:opacity-40";

  return (
    <div className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] gap-2">
      <section className="panel-topbar flex items-center justify-between rounded-lg border border-slate-200 bg-white px-3 motion-shell-stage motion-panel-glow">
        <div className="flex min-w-0 items-center gap-2">
          <FileText className="h-3.5 w-3.5 text-slate-500" />
          <span className="panel-topbar-text truncate text-sm font-medium text-slate-700">{filenameFromPath(selectedPath)}</span>
        </div>
        <div className="flex min-w-0 flex-nowrap items-center gap-1 overflow-x-auto py-1">
          <button
            className={`panel-topbar-text rounded border px-2 py-1 text-[11px] ${
              viewMode === "bib"
                ? "border-primary-300 bg-primary-50 text-primary-900"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => applyViewMode("bib")}
            title={t("library.viewer.showBib")}
          >
            {t("library.viewer.showBib")}
          </button>
          <button
            className={`panel-topbar-text rounded border px-2 py-1 text-[11px] ${
              viewMode === "pdf"
                ? "border-primary-300 bg-primary-50 text-primary-900"
                : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
            }`}
            onClick={() => applyViewMode("pdf")}
            title={t("library.viewer.showPdf")}
            disabled={!hasPdf}
          >
            {t("library.viewer.showPdf")}
          </button>

          <button
            className={actionBtnClass}
            onClick={() => selectedPath && onAnalyzePaper(selectedPath)}
            title={t("library.viewer.analyzePaper")}
            disabled={!selectedPath || documentBusy || analysisRunning}
          >
            <FileSearch className="h-3.5 w-3.5" />
          </button>

          <button
            className={actionBtnClass}
            onClick={() => {
              if (hasTranslated && translatedPdfUrl) {
                applyViewMode("compare");
                return;
              }
              handleRunTranslation(() => applyViewMode("compare"));
            }}
            title={translationBusy ? t("library.viewer.translating") : hasTranslated ? t("library.viewer.showCompare") : t("library.viewer.translatePaper")}
            disabled={!selectedPath || documentBusy || translationBusy}
          >
            <Languages className={`h-3.5 w-3.5 ${translationBusy ? "animate-pulse" : ""}`} />
          </button>

          {viewMode === "pdf" ? (
            <>
              <button
                className={actionBtnClass}
                onClick={() => void handleOpenLink()}
                disabled={!activeLink}
                title={t("library.viewer.openLink")}
              >
                <ExternalLink className="h-3.5 w-3.5" />
              </button>
              <button
                className={actionBtnClass}
                onClick={() => void handleCopyLink()}
                disabled={!activeLink}
                title={copyState ? t("library.viewer.copySuccess") : t("library.viewer.copyLink")}
              >
                {copyState ? <Check className="h-3.5 w-3.5" /> : <Copy className="h-3.5 w-3.5" />}
              </button>
            </>
          ) : null}
        </div>
      </section>

      {translationNotice ? (
        <div className={`rounded border px-3 py-2 text-xs motion-card-pop ${translationNotice.type === "info" ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-rose-200 bg-rose-50 text-rose-700"}`}>
          {translationNotice.message}
        </div>
      ) : null}

      <div className="relative min-h-0">
        <LibraryTranslationStatusToast progress={translationProgress} busy={translationBusy} t={t} />
        <LibraryViewerContentPanel
        viewMode={viewMode}
        loading={loading}
        loadError={loadError}
        pdfPreviewLoading={pdfPreviewLoading}
        pdfPreviewError={pdfPreviewError}
        hasPdf={hasPdf}
        pdfUrl={pdfUrl}
        annotationMode={annotationMode}
        setAnnotationMode={setAnnotationMode}
        highlightColor={highlightColor}
        setHighlightColor={setHighlightColor}
        highlightWidth={highlightWidth}
        setHighlightWidth={setHighlightWidth}
        highlightOpacity={highlightOpacity}
        setHighlightOpacity={setHighlightOpacity}
        textColor={textColor}
        setTextColor={setTextColor}
        textBoxStylePreset={textBoxStylePreset}
        setTextBoxStylePreset={setTextBoxStylePreset}
        pageStrokeCount={pageStrokeCount}
        pageTextBoxCount={pageTextBoxCount}
        handleUndoCurrentPage={handleUndoCurrentPage}
        handleClearCurrentPage={handleClearCurrentPage}
        pageInput={pageInput}
        setPageInput={setPageInput}
        currentPage={currentPage}
        jumpToPage={jumpToPage}
        pdfZoom={pdfZoom}
        setPdfZoom={setPdfZoom}
        toolConfigSignal={toolConfigSignal}
        setToolConfigSignal={setToolConfigSignal}
        viewerRef={viewerRef}
        pageCount={pageCount}
        setPageCount={setPageCount}
        annotationStrokes={annotationStrokes}
        annotationTextBoxes={annotationTextBoxes}
        setAnnotationStrokes={setAnnotationStrokes}
        setAnnotationTextBoxes={setAnnotationTextBoxes}
        setCurrentPage={setCurrentPage}
        translationDetail={translationDetail}
        translationBusy={translationBusy}
        selectedPath={selectedPath}
        runTranslation={handleRunTranslation}
        hasComparePair={hasComparePair}
        translatedPdfUrl={translatedPdfUrl}
        bibPreview={bibPreview}
        citation={citation}
        paperPreview={paperPreview}
        paperPreviewLoading={paperPreviewLoading}
        paperPreviewError={paperPreviewError}
        onAnalyzePaper={paperPreview?.sourcePath ? () => onAnalyzePaper(paperPreview.sourcePath!) : null}
        linkError={linkError}
        t={t}
      />
      </div>
    </div>
  );
}
