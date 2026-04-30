import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { openExternalLink } from "../../shared/api/app";
import { readFile, writeFile } from "../../shared/api/workspace";
import { LibraryDocumentToolbar } from "./library/LibraryDocumentToolbar";
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
import { LibraryTranslationStatusToast } from "./library/LibraryTranslationStatusToast";
import { LibraryPdfDownloadToast } from "./library/LibraryPdfDownloadStatus";
import { useLibraryDocumentData } from "./library/useLibraryDocumentData";
import { useLibraryPaperBrief } from "./library/useLibraryPaperBrief";
import { useLibraryPdfObjectUrls } from "./library/useLibraryPdfObjectUrls";
import { useLibraryPdfShortcuts } from "./library/useLibraryPdfShortcuts";
import { useLibraryPdfViewController } from "./library/useLibraryPdfViewController";
import { useLibraryCompareScrollDraft } from "./library/useLibraryCompareScrollDraft";
import { useLibraryTranslationPanel } from "./library/useLibraryTranslationPanel";
import { useLibraryViewerSession } from "./library/useLibraryViewerSession";
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
  paperBriefEngine: "auto" | "pdfjs" | "python";
  bibLayout?: number[];
  onBibLayoutChange?: (layout: number[]) => void;
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
    paperBriefEngine,
    bibLayout,
    onBibLayoutChange,
    t,
  } = props;
  const [linkError, setLinkError] = useState<string | null>(null);
  const [copyState, setCopyState] = useState(false);
  const [annotationMode, setAnnotationMode] = useState<ToolMode>("select");
  const [highlightColor, setHighlightColor] = useState<string>(HIGHLIGHT_COLORS[0]);
  const [highlightWidth, setHighlightWidth] = useState<number>(16);
  const [highlightOpacity, setHighlightOpacity] = useState<number>(0.65);
  const [textColor, setTextColor] = useState<string>(TEXT_COLORS[0]);
  const [textBoxStylePreset, setTextBoxStylePreset] = useState<AnnotationTextStylePreset>("minimal");
  const [annotationStrokes, setAnnotationStrokes] = useState<AnnotationStroke[]>([]);
  const [annotationTextBoxes, setAnnotationTextBoxes] = useState<AnnotationTextBox[]>([]);
  const [annotationLoaded, setAnnotationLoaded] = useState(false);
  const [pageCount, setPageCount] = useState(1);
  const [pageInput, setPageInput] = useState("1");
  const [toolConfigSignal, setToolConfigSignal] = useState(0);
  const [magnifierActive, setMagnifierActive] = useState(false);
  const viewerRef = useRef<LibraryPdfScrollViewerHandle | null>(null);
  const lastAnnotationPayloadRef = useRef<string>("");
  const {
    session,
    setSession,
  } = useLibraryViewerSession({
    projectId,
    selectedPath,
    fallbackViewMode: persistedViewMode ?? "bib",
  });
  const currentPage = session.currentPage;
  const pdfZoom = session.pdfZoom;
  const viewMode = session.viewMode;
  const { setCompareSourceScrollAnchor, setCompareSourceScrollRatio, setCompareTranslatedScrollAnchor, setCompareTranslatedScrollRatio } = useLibraryCompareScrollDraft({
    projectId,
    selectedPath,
    session,
    setSession,
  });
  const {
    loading,
    loadError,
    pdfPreviewRequested,
    pdfPreviewLoading,
    pdfPreviewError,
    citation,
    paperPreview,
    bibPreview,
    bibPreviewError,
    resolvedLink,
    sourcePdfRelativePath,
    translatedPdfRelativePath,
    pdfCacheState,
    previewRevision,
    pdfDownloadedBytes,
    pdfTotalBytes,
    ensurePdfPreviewLoaded,
    refresh: refreshDocumentData,
    reset: resetDocumentData,
  } = useLibraryDocumentData({
    projectId,
    selectedPath,
    active,
  });
  const {
    pdfUrl,
    translatedPdfUrl,
    loading: pdfObjectUrlLoading,
    error: pdfObjectUrlError,
  } = useLibraryPdfObjectUrls({
    projectId,
    enabled: pdfPreviewRequested || viewMode === "pdf" || viewMode === "compare",
    previewRevision,
    cacheState: pdfCacheState,
    sourcePdfRelativePath,
    translatedPdfRelativePath,
  });
  const hasPdf = Boolean(pdfUrl);
  const hasTranslated = Boolean(translatedPdfUrl);
  const pdfInteractionBusy = (
    pdfPreviewRequested
    || viewMode === "pdf"
    || viewMode === "compare"
  ) && (pdfPreviewLoading || pdfObjectUrlLoading);
  const documentBusy = loading || pdfInteractionBusy;
  const {
    paperPreview: computedPaperPreview,
    loading: paperPreviewLoading,
    error: paperPreviewError,
  } = useLibraryPaperBrief({
    projectId,
    selectedPath,
    pdfUrl,
    sourcePdfRelativePath,
    fallbackTitle: citation?.title ?? null,
    engine: paperBriefEngine,
    previewKey: sourcePdfRelativePath ?? selectedPath,
  });
  const {
    translationBusy,
    translationNotice,
    translationDetail,
    translationProgress,
    sourcePdfRelativePath: translatedSessionSourcePath,
    translatedPdfRelativePath: translatedSessionPath,
    setTranslationNotice,
    resetTranslationState,
    runTranslation,
  } = useLibraryTranslationPanel({
    projectId,
    selectedPath,
    translationModelId,
    t,
  });

  const activeLink = useMemo(() => resolvedLink ?? citation?.urls?.[0] ?? null, [citation?.urls, resolvedLink]);
  const annotationPath = useMemo(() => (selectedPath ? toLibraryAnnotationPath(selectedPath) : null), [selectedPath]);
  const pageStrokeCount = useMemo(() => annotationStrokes.filter((item) => item.page === currentPage).length, [annotationStrokes, currentPage]);
  const pageTextBoxCount = useMemo(() => annotationTextBoxes.filter((item) => item.page === currentPage).length, [annotationTextBoxes, currentPage]);
  const hasComparePair = Boolean(hasPdf && translatedPdfUrl);
  const hasTranslatedArtifact = Boolean(translatedSessionPath || translatedPdfRelativePath);
  const pdfOpenError = pdfPreviewError ?? pdfObjectUrlError;

  const applyViewMode = useCallback((nextMode: ViewMode) => {
    setSession({ viewMode: nextMode });
    onPersistViewMode?.(nextMode);
  }, [onPersistViewMode, setSession]);

  useEffect(() => {
    setPageInput(String(currentPage));
  }, [currentPage]);

  useEffect(() => {
    if (!projectId || !selectedPath) {
      lastAnnotationPayloadRef.current = "";
      setLinkError(null);
      setCopyState(false);
      setAnnotationMode("select");
      setAnnotationStrokes([]);
      setAnnotationTextBoxes([]);
      setAnnotationLoaded(false);
      setPageCount(1);
      setPageInput("1");
      setMagnifierActive(false);
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
    setPageCount(1);
    setPageInput(String(session.currentPage));
    setMagnifierActive(false);
    setHighlightWidth(16);
    setHighlightOpacity(0.65);
    setTextBoxStylePreset("minimal");
    setTranslationNotice(null);
    resetTranslationState();
  }, [
    projectId,
    resetDocumentData,
    resetTranslationState,
    selectedPath,
    session.currentPage,
    setTranslationNotice,
  ]);

  useEffect(() => {
    if (!projectId || !selectedPath || !annotationPath) {
      lastAnnotationPayloadRef.current = "";
      setAnnotationLoaded(false);
      setAnnotationStrokes([]);
      setAnnotationTextBoxes([]);
      return;
    }
    let disposed = false;
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
  }, [annotationPath, projectId, selectedPath]);

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
    if (translatedSessionPath && translatedSessionPath !== translatedPdfRelativePath) {
      void refreshDocumentData().then(() => {
        if (pdfPreviewRequested || viewMode === "pdf" || viewMode === "compare") {
          return ensurePdfPreviewLoaded();
        }
        return undefined;
      });
    }
  }, [
    ensurePdfPreviewLoaded,
    pdfPreviewRequested,
    refreshDocumentData,
    translatedPdfRelativePath,
    translatedSessionPath,
    viewMode,
  ]);

  useEffect(() => {
    if (
      translatedSessionSourcePath
      && sourcePdfRelativePath
      && translatedSessionSourcePath !== sourcePdfRelativePath
    ) {
      void refreshDocumentData();
    }
  }, [refreshDocumentData, sourcePdfRelativePath, translatedSessionSourcePath]);

  const {
    pendingPdfOpen,
    pendingCompareOpen,
    requestPdfOpen,
    requestCompareOpen,
    retryPdfOpen,
    setPendingCompareOpen,
  } = useLibraryPdfViewController({
    projectId,
    selectedPath,
    viewMode,
    hasPdf,
    hasComparePair,
    hasTranslated,
    hasTranslatedArtifact,
    translatedPdfUrl,
    translationBusy,
    translationNotice,
    documentBusy,
    pdfPreviewRequested,
    pdfPreviewLoading,
    pdfPreviewError,
    pdfObjectUrlLoading,
    pdfObjectUrlError,
    pdfCacheState,
    sourcePdfRelativePath,
    ensurePdfPreviewLoaded,
    applyViewMode,
    runTranslation,
  });
  const pdfDownloadToastVisible = (
    pdfPreviewRequested
    || pendingPdfOpen
    || pendingCompareOpen
    || viewMode === "pdf"
    || viewMode === "compare"
  ) && (pdfPreviewLoading || pdfObjectUrlLoading);
  const pdfDownloadToastPhase = pdfPreviewLoading ? "downloading" : "preparing";

  useEffect(() => {
    if (viewMode !== "pdf" || !hasPdf) {
      setAnnotationMode("select");
    }
  }, [hasPdf, viewMode]);

  useEffect(() => {
    if (viewMode !== "pdf" || annotationMode !== "select" || !hasPdf) {
      setMagnifierActive(false);
    }
  }, [annotationMode, hasPdf, viewMode]);

  useEffect(() => {
    if (currentPage <= pageCount) {
      return;
    }
    const next = Math.max(1, pageCount);
    setSession({ currentPage: next });
    setPageInput(String(next));
  }, [currentPage, pageCount, setSession]);

  const jumpToPage = useCallback((next: number) => {
    const normalized = Math.max(1, Math.min(pageCount || 1, Math.floor(next)));
    setSession({ currentPage: normalized });
    setPageInput(String(normalized));
    viewerRef.current?.scrollToPage(normalized);
  }, [pageCount, setSession]);

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

  const handleRetranslate = useCallback(() => {
    if (!selectedPath) {
      return;
    }
    void ensurePdfPreviewLoaded();
    setPendingCompareOpen(viewMode === "compare");
    runTranslation();
  }, [ensurePdfPreviewLoaded, runTranslation, selectedPath, viewMode]);

  useLibraryPdfShortcuts({
    enabled: viewMode === "pdf" && hasPdf,
    currentPage,
    jumpToPage,
    setMode: setAnnotationMode,
    onUndo: handleUndoCurrentPage,
    setZoom: (next) => {
      setSession((current) => ({
        ...current,
        pdfZoom: typeof next === "function" ? next(current.pdfZoom) : next,
      }));
    },
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

  return (
    <div className="grid h-full min-h-0 grid-rows-[40px_minmax(0,1fr)] gap-2">
      <LibraryDocumentToolbar
        selectedPath={selectedPath}
        viewMode={viewMode}
        documentBusy={documentBusy}
        analysisRunning={analysisRunning}
        translationBusy={translationBusy}
        hasTranslated={hasTranslated}
        translationNotice={translationNotice}
        activeLink={activeLink}
        copyState={copyState}
        onViewModeChange={applyViewMode}
        onOpenPdf={requestPdfOpen}
        onAnalyzePaper={() => onAnalyzePaper(selectedPath)}
        onCompareAction={requestCompareOpen}
        onRetranslate={handleRetranslate}
        onOpenLink={() => void handleOpenLink()}
        onCopyLink={() => void handleCopyLink()}
        t={t}
      />
      <div className="relative min-h-0 overflow-hidden">
        <LibraryTranslationStatusToast progress={translationProgress} busy={translationBusy} t={t} />
        <LibraryPdfDownloadToast
          visible={pdfDownloadToastVisible}
          phase={pdfDownloadToastPhase}
          downloadedBytes={pdfDownloadedBytes}
          totalBytes={pdfTotalBytes}
          offsetTopClassName={translationBusy && translationProgress ? "top-[5.75rem]" : "top-3"}
          t={t}
        />
        <LibraryViewerContentPanel
          viewMode={viewMode}
          loading={loading}
          loadError={loadError}
          pdfPreviewLoading={pdfPreviewLoading}
          pdfObjectUrlLoading={pdfObjectUrlLoading}
          pdfPreviewError={pdfOpenError}
          pdfRequestStatusVisible={
            viewMode === "bib"
            && pdfPreviewRequested
            && !hasPdf
            && !pdfPreviewLoading
            && !pdfObjectUrlLoading
            && (Boolean(pdfOpenError) || pdfCacheState === "error")
          }
          pdfRetryAvailable={!pdfPreviewLoading && !pdfObjectUrlLoading && Boolean(pdfOpenError || pdfCacheState === "error")}
          onRetryPdf={retryPdfOpen}
          hasPdf={hasPdf}
          pdfUrl={pdfUrl}
          annotationMode={annotationMode}
          setAnnotationMode={setAnnotationMode}
          magnifierActive={magnifierActive}
          setMagnifierActive={setMagnifierActive}
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
          setPdfZoom={(next) => {
            setSession((current) => ({
              ...current,
              pdfZoom: typeof next === "function" ? next(current.pdfZoom) : next,
            }));
          }}
          compareSourceZoom={session.compareSourceZoom}
          setCompareSourceZoom={(next) => {
            setSession((current) => ({
              ...current,
              compareSourceZoom: typeof next === "function" ? next(current.compareSourceZoom) : next,
            }));
          }}
          compareTranslatedZoom={session.compareTranslatedZoom}
          setCompareTranslatedZoom={(next) => {
            setSession((current) => ({
              ...current,
              compareTranslatedZoom: typeof next === "function" ? next(current.compareTranslatedZoom) : next,
            }));
          }}
          toolConfigSignal={toolConfigSignal}
          setToolConfigSignal={setToolConfigSignal}
          viewerRef={viewerRef}
          pageCount={pageCount}
          setPageCount={setPageCount}
          annotationStrokes={annotationStrokes}
          annotationTextBoxes={annotationTextBoxes}
          setAnnotationStrokes={setAnnotationStrokes}
          setAnnotationTextBoxes={setAnnotationTextBoxes}
          setCurrentPage={(next) => setSession({ currentPage: next })}
          pdfScrollAnchor={session.pdfScrollAnchor}
          setPdfScrollAnchor={(next) => setSession({ pdfScrollAnchor: next })}
          pdfScrollRatio={session.pdfScrollRatio}
          setPdfScrollRatio={(next) => setSession({ pdfScrollRatio: next })}
          compareSourceScrollAnchor={session.compareSourceScrollAnchor}
          setCompareSourceScrollAnchor={setCompareSourceScrollAnchor}
          compareSourceScrollRatio={session.compareSourceScrollRatio}
          setCompareSourceScrollRatio={setCompareSourceScrollRatio}
          compareTranslatedScrollAnchor={session.compareTranslatedScrollAnchor}
          setCompareTranslatedScrollAnchor={setCompareTranslatedScrollAnchor}
          compareTranslatedScrollRatio={session.compareTranslatedScrollRatio}
          setCompareTranslatedScrollRatio={setCompareTranslatedScrollRatio}
          bibScrollRatio={session.bibScrollRatio}
          setBibScrollRatio={(next) => setSession({ bibScrollRatio: next })}
          metaScrollRatio={session.metaScrollRatio}
          setMetaScrollRatio={(next) => setSession({ metaScrollRatio: next })}
          hasComparePair={hasComparePair}
          translatedPdfUrl={translatedPdfUrl}
          bibPreview={bibPreview}
          bibPreviewError={bibPreviewError}
          citation={citation}
          paperPreview={computedPaperPreview ?? paperPreview}
          paperPreviewLoading={paperPreviewLoading}
          paperPreviewError={paperPreviewError}
          onAnalyzePaper={() => onAnalyzePaper(selectedPath)}
          linkError={linkError}
          bibLayout={bibLayout}
          onBibLayoutChange={onBibLayoutChange}
          t={t}
        />
      </div>
    </div>
  );
}
