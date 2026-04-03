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
import { filenameFromPath } from "./library/viewerUtils";
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
import { LibraryDocumentSidebar } from "./library/LibraryDocumentSidebar";
import { LibraryTranslationStatusToast } from "./library/LibraryTranslationStatusToast";
import { LibraryViewerContentPanel } from "./library/LibraryViewerContentPanel";
import { useLibraryDocumentData } from "./library/useLibraryDocumentData";
import { useLibraryPdfShortcuts } from "./library/useLibraryPdfShortcuts";
import { useLibraryTranslationPanel } from "./library/useLibraryTranslationPanel";

type TranslationFn = (key: any) => string;
type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type ViewMode = "bib" | "pdf" | "compare";

function ViewModeButton(props: {
  active: boolean;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className={`rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
        props.active
          ? "border-primary-500 bg-primary-50 text-primary-800"
          : "border-slate-300 bg-white text-slate-700 hover:bg-slate-100"
      }`}
      onClick={props.onClick}
    >
      {props.label}
    </button>
  );
}

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
  const lastAnnotationPayloadRef = useRef("");

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
    sourcePdfRelativePath,
    translatedPdfRelativePath,
    translatedPdfUrl,
    resolvedLink,
    pdfDownloadedBytes,
    pdfTotalBytes,
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

  const sourcePdfState = (pdfPreviewError ? "error" : hasPdf ? "ready" : (pdfPreviewLoading ? "pending" : "missing")) as
    | "ready"
    | "pending"
    | "error"
    | "missing";
  const translatedPdfState = hasTranslated ? "ready" : translationBusy ? "pending" : "missing";
  const title = citation?.title || filenameFromPath(selectedPath);

  return (
    <section className="grid h-full min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-3 rounded-xl border border-slate-200 bg-[#f8fafc] p-3">
      <header className="grid gap-3 rounded-xl border border-slate-200 bg-white px-4 py-3 xl:grid-cols-[minmax(0,1fr)_auto_auto] xl:items-center">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-slate-500">
            <FileText className="h-3.5 w-3.5" />
            <span>{t("library.detailTitle")}</span>
          </div>
          <h2 className="mt-1 truncate text-sm font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 truncate text-xs text-slate-500">{selectedPath}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <ViewModeButton
            active={viewMode === "bib"}
            label={t("library.viewer.showBib")}
            onClick={() => applyViewMode("bib")}
          />
          <ViewModeButton
            active={viewMode === "pdf"}
            label={t("library.viewer.showPdf")}
            onClick={() => applyViewMode("pdf")}
          />
          <ViewModeButton
            active={viewMode === "compare"}
            label={t("library.viewer.showCompare")}
            onClick={() => applyViewMode("compare")}
          />
        </div>

        <div className="flex flex-wrap items-center justify-start gap-2 xl:justify-end">
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            onClick={() => onAnalyzePaper(selectedPath)}
            disabled={analysisRunning}
          >
            <FileSearch className="h-3.5 w-3.5" />
            {t("library.viewer.analyzePaper")}
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-1 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs font-medium text-slate-700 transition hover:bg-slate-100 disabled:opacity-50"
            onClick={() => handleRunTranslation()}
            disabled={translationBusy || !selectedPath}
          >
            <Languages className="h-3.5 w-3.5" />
            {t("library.viewer.translatePaper")}
          </button>
          {activeLink ? (
            <>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                onClick={handleOpenLink}
                title={t("library.viewer.openLink")}
              >
                <ExternalLink className="h-4 w-4" />
              </button>
              <button
                type="button"
                className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
                onClick={handleCopyLink}
                title={t("library.viewer.copyLink")}
              >
                {copyState ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
              </button>
            </>
          ) : null}
        </div>
      </header>

      <div className="grid min-h-0 gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <LibraryViewerContentPanel
          projectId={projectId}
          viewMode={viewMode}
          loading={loading}
          loadError={loadError}
          pdfPreviewLoading={pdfPreviewLoading}
          pdfPreviewError={pdfPreviewError}
          pdfDownloadedBytes={pdfDownloadedBytes}
          pdfTotalBytes={pdfTotalBytes}
          hasPdf={hasPdf}
          pdfUrl={pdfUrl}
          sourcePdfRelativePath={sourcePdfRelativePath}
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
          translatedPdfRelativePath={translatedPdfRelativePath}
          translatedPdfUrl={translatedPdfUrl}
          bibPreview={bibPreview}
          t={t}
        />

        <LibraryDocumentSidebar
          citation={citation}
          activeLink={activeLink}
          linkError={linkError}
          copyState={copyState}
          paperPreview={paperPreview}
          paperPreviewLoading={paperPreviewLoading}
          paperPreviewError={paperPreviewError}
          sourcePdfState={sourcePdfState}
          translatedPdfState={translatedPdfState}
          pdfDownloadedBytes={pdfDownloadedBytes}
          pdfTotalBytes={pdfTotalBytes}
          translationBusy={translationBusy}
          translationDetail={translationDetail}
          onAnalyzePaper={selectedPath ? (() => onAnalyzePaper(selectedPath)) : null}
          onOpenLink={handleOpenLink}
          onCopyLink={handleCopyLink}
          t={t}
        />
      </div>

      <LibraryTranslationStatusToast
        progress={translationProgress}
        busy={translationBusy}
        t={t}
      />
    </section>
  );
}
