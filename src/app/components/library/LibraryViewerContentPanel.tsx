import { FileUp, Minus, Plus } from "lucide-react";
import { useRef, type MutableRefObject } from "react";
import type { LibraryCitationSummary } from "../../../shared/types/app";
import { LibraryCitationMetaPanel } from "./LibraryCitationMetaPanel";
import {
  LibraryPdfScrollViewer,
  type LibraryPdfScrollViewerHandle,
} from "./LibraryPdfScrollViewer";
import { LibraryPdfToolSidebar } from "./LibraryPdfToolSidebar";
import type { LibraryPdfScrollSyncGroup } from "./libraryPdfScrollViewerShared";
import type { PdfScrollAnchor } from "./libraryPdfScrollState";
import { useElementScrollRatio } from "./useElementScrollRatio";
import type {
  AnnotationStroke,
  AnnotationTextBox,
  AnnotationTextStylePreset,
} from "./annotationModel";

type TranslationFn = (key: any) => string;
type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type ViewMode = "bib" | "pdf" | "compare";

const MIN_LIBRARY_COMPARE_ZOOM = 0.7;
const MAX_LIBRARY_COMPARE_ZOOM = 2.4;

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
}

function clampCompareZoom(next: number): number {
  return Math.max(MIN_LIBRARY_COMPARE_ZOOM, Math.min(MAX_LIBRARY_COMPARE_ZOOM, Number(next.toFixed(2))));
}

const LIBRARY_INFO_PANE_CLASSNAME = [
  "library-scrollbar min-h-0 overflow-x-auto overflow-y-scroll rounded-xl",
  "border border-slate-200 bg-white p-3 motion-card-pop",
].join(" ");

function ComparePaneHeader(props: {
  label: string;
  zoom: number;
  onZoomOut: () => void;
  onZoomIn: () => void;
  t: TranslationFn;
}) {
  const { label, zoom, onZoomOut, onZoomIn, t } = props;
  return (
    <div className="flex items-center justify-between gap-2 border-b border-slate-200 px-2 py-1">
      <div className="truncate text-xs font-medium text-slate-600">{label}</div>
      <div className="flex items-center gap-1">
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
          onClick={onZoomOut}
          title={`${label} · ${t("preview.zoomOut")}`}
          aria-label={`${label} · ${t("preview.zoomOut")}`}
        >
          <Minus className="h-3.5 w-3.5" />
        </button>
        <span className="w-11 text-center text-[11px] font-medium text-slate-600">{Math.round(zoom * 100)}%</span>
        <button
          type="button"
          className="inline-flex h-6 w-6 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition hover:bg-slate-100"
          onClick={onZoomIn}
          title={`${label} · ${t("preview.zoomIn")}`}
          aria-label={`${label} · ${t("preview.zoomIn")}`}
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

type LibraryViewerContentPanelProps = {
  viewMode: ViewMode;
  loading: boolean;
  loadError: string | null;
  pdfPreviewLoading: boolean;
  pdfObjectUrlLoading: boolean;
  pdfPreviewError: string | null;
  pdfDownloadedBytes: number | null;
  pdfTotalBytes: number | null;
  hasPdf: boolean;
  pdfUrl: string | null;
  annotationMode: ToolMode;
  setAnnotationMode: (mode: ToolMode) => void;
  highlightColor: string;
  setHighlightColor: (color: string) => void;
  highlightWidth: number;
  setHighlightWidth: (width: number) => void;
  highlightOpacity: number;
  setHighlightOpacity: (opacity: number) => void;
  textColor: string;
  setTextColor: (color: string) => void;
  textBoxStylePreset: AnnotationTextStylePreset;
  setTextBoxStylePreset: (preset: AnnotationTextStylePreset) => void;
  pageStrokeCount: number;
  pageTextBoxCount: number;
  handleUndoCurrentPage: () => void;
  handleClearCurrentPage: () => void;
  pageInput: string;
  setPageInput: (next: string) => void;
  currentPage: number;
  jumpToPage: (next: number) => void;
  pdfZoom: number;
  setPdfZoom: (next: number | ((prev: number) => number)) => void;
  compareSourceZoom: number;
  setCompareSourceZoom: (next: number | ((prev: number) => number)) => void;
  compareTranslatedZoom: number;
  setCompareTranslatedZoom: (next: number | ((prev: number) => number)) => void;
  toolConfigSignal: number;
  setToolConfigSignal: (next: number | ((prev: number) => number)) => void;
  viewerRef: MutableRefObject<LibraryPdfScrollViewerHandle | null>;
  pageCount: number;
  setPageCount: (next: number) => void;
  annotationStrokes: AnnotationStroke[];
  annotationTextBoxes: AnnotationTextBox[];
  setAnnotationStrokes: (next: AnnotationStroke[] | ((prev: AnnotationStroke[]) => AnnotationStroke[])) => void;
  setAnnotationTextBoxes: (next: AnnotationTextBox[] | ((prev: AnnotationTextBox[]) => AnnotationTextBox[])) => void;
  setCurrentPage: (next: number) => void;
  pdfScrollAnchor: PdfScrollAnchor;
  setPdfScrollAnchor: (next: PdfScrollAnchor) => void;
  pdfScrollRatio: number;
  setPdfScrollRatio: (next: number) => void;
  compareSourceScrollAnchor: PdfScrollAnchor;
  setCompareSourceScrollAnchor: (next: PdfScrollAnchor) => void;
  compareSourceScrollRatio: number;
  setCompareSourceScrollRatio: (next: number) => void;
  compareTranslatedScrollAnchor: PdfScrollAnchor;
  setCompareTranslatedScrollAnchor: (next: PdfScrollAnchor) => void;
  compareTranslatedScrollRatio: number;
  setCompareTranslatedScrollRatio: (next: number) => void;
  bibScrollRatio: number;
  setBibScrollRatio: (next: number) => void;
  metaScrollRatio: number;
  setMetaScrollRatio: (next: number) => void;
  hasComparePair: boolean;
  translatedPdfUrl: string | null;
  bibPreview: string;
  citation: LibraryCitationSummary | null;
  paperPreview?: {
    title?: string | null;
    detectedLanguage?: string | null;
    extractionEngine?: string | null;
    pageCount?: number | null;
    excerpt?: string | null;
  } | null;
  paperPreviewLoading: boolean;
  paperPreviewError: string | null;
  onAnalyzePaper?: (() => void) | null;
  linkError: string | null;
  t: TranslationFn;
};

export function LibraryViewerContentPanel(props: LibraryViewerContentPanelProps) {
  const {
    viewMode,
    loading,
    loadError,
    pdfPreviewLoading,
    pdfObjectUrlLoading,
    pdfPreviewError,
    pdfDownloadedBytes,
    pdfTotalBytes,
    hasPdf,
    pdfUrl,
    annotationMode,
    setAnnotationMode,
    highlightColor,
    setHighlightColor,
    highlightWidth,
    setHighlightWidth,
    highlightOpacity,
    setHighlightOpacity,
    textColor,
    setTextColor,
    textBoxStylePreset,
    setTextBoxStylePreset,
    pageStrokeCount,
    pageTextBoxCount,
    handleUndoCurrentPage,
    handleClearCurrentPage,
    pageInput,
    setPageInput,
    currentPage,
    jumpToPage,
    pdfZoom,
    setPdfZoom,
    compareSourceZoom,
    setCompareSourceZoom,
    compareTranslatedZoom,
    setCompareTranslatedZoom,
    toolConfigSignal,
    setToolConfigSignal,
    viewerRef,
    pageCount,
    setPageCount,
    annotationStrokes,
    annotationTextBoxes,
    setAnnotationStrokes,
    setAnnotationTextBoxes,
    setCurrentPage,
    pdfScrollAnchor,
    setPdfScrollAnchor,
    pdfScrollRatio,
    setPdfScrollRatio,
    compareSourceScrollAnchor,
    setCompareSourceScrollAnchor,
    compareSourceScrollRatio,
    setCompareSourceScrollRatio,
    compareTranslatedScrollAnchor,
    setCompareTranslatedScrollAnchor,
    compareTranslatedScrollRatio,
    setCompareTranslatedScrollRatio,
    bibScrollRatio,
    setBibScrollRatio,
    metaScrollRatio,
    setMetaScrollRatio,
    hasComparePair,
    translatedPdfUrl,
    bibPreview,
    citation,
    paperPreview,
    paperPreviewLoading,
    paperPreviewError,
    onAnalyzePaper,
    linkError,
    t,
  } = props;

  const compareSyncGroupRef = useRef<LibraryPdfScrollSyncGroup | null>(null);
  const bibContainerRef = useRef<HTMLElement | null>(null);
  const metaContainerRef = useRef<HTMLElement | null>(null);
  const pdfPaneLoading = loading || pdfPreviewLoading || pdfObjectUrlLoading;
  const pdfPaneError = loadError ?? pdfPreviewError;
  const pdfProgressPercent = pdfTotalBytes && pdfTotalBytes > 0
    ? Math.max(0, Math.min(100, (Math.max(pdfDownloadedBytes ?? 0, 0) / pdfTotalBytes) * 100))
    : null;
  const pdfViewerContainerClassName = "library-scrollbar relative h-full min-h-0 min-w-0 overflow-x-auto overflow-y-scroll bg-transparent";
  const pdfViewerDocumentClassName = "mx-auto flex w-max min-w-full flex-col gap-3 p-0 pr-3 pb-3";
  const compareViewerContainerClassName = "library-scrollbar relative h-full min-h-0 min-w-0 overflow-x-auto overflow-y-scroll bg-transparent";
  const compareViewerDocumentClassName = "mx-auto flex w-max min-w-full flex-col gap-3 px-2 py-0 pr-3 pb-3";

  useElementScrollRatio({
    node: viewMode === "bib" ? bibContainerRef.current : null,
    enabled: viewMode === "bib",
    initialRatio: bibScrollRatio,
    onRatioChange: setBibScrollRatio,
    restoreDeps: [bibPreview],
  });
  useElementScrollRatio({
    node: metaContainerRef.current,
    enabled: viewMode === "bib",
    initialRatio: metaScrollRatio,
    onRatioChange: setMetaScrollRatio,
    restoreDeps: [citation?.sourcePath ?? "", paperPreview?.excerpt ?? ""],
  });

  if (viewMode === "pdf") {
    return (
      <section className="grid min-h-0 grid-rows-[minmax(0,1fr)] overflow-hidden rounded-xl border border-slate-200 bg-white">
        {pdfPaneLoading ? (
          <div className="flex h-full items-center justify-center px-4">
            <div className="w-full max-w-sm rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-xs text-slate-600">
              <div>{pdfPreviewLoading ? t("library.viewer.downloadingPdf") : t("library.viewer.loading")}</div>
              {pdfPreviewLoading ? (
                <div className="mt-2">
                  <div className="h-2 overflow-hidden rounded-full bg-slate-200">
                    <div
                      className="h-full rounded-full bg-primary-500 transition-[width] duration-300"
                      style={{ width: `${pdfProgressPercent ?? 20}%` }}
                    />
                  </div>
                  <div className="mt-2 flex items-center justify-between text-[11px] text-slate-500">
                    <span>{t("library.viewer.downloadProgress")}</span>
                    <span>
                      {pdfTotalBytes && pdfTotalBytes > 0
                        ? `${formatByteCount(pdfDownloadedBytes ?? 0)} / ${formatByteCount(pdfTotalBytes)}`
                        : formatByteCount(pdfDownloadedBytes ?? 0)}
                    </span>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        ) : pdfPaneError ? (
          <div className="m-3 rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {t("library.viewer.error")} {pdfPaneError}
          </div>
        ) : hasPdf && pdfUrl ? (
          <div className="grid h-full min-h-0 grid-cols-[56px_minmax(0,1fr)] gap-3 p-3">
            <LibraryPdfToolSidebar
              t={t}
              hasPdf={hasPdf}
              mode={annotationMode}
              onModeChange={setAnnotationMode}
              highlightColor={highlightColor}
              onHighlightColorChange={setHighlightColor}
              highlightWidth={highlightWidth}
              onHighlightWidthChange={setHighlightWidth}
              highlightOpacity={highlightOpacity}
              onHighlightOpacityChange={setHighlightOpacity}
              textColor={textColor}
              onTextColorChange={setTextColor}
              textBoxStylePreset={textBoxStylePreset}
              onTextBoxStylePresetChange={setTextBoxStylePreset}
              canUndo={pageStrokeCount > 0}
              canClear={pageStrokeCount > 0 || pageTextBoxCount > 0}
              onUndo={handleUndoCurrentPage}
              onClear={handleClearCurrentPage}
              pageInput={pageInput}
              onPageInputChange={setPageInput}
              onPageCommit={() => {
                const parsed = Number(pageInput);
                if (Number.isFinite(parsed)) {
                  jumpToPage(parsed);
                } else {
                  setPageInput(String(currentPage));
                }
              }}
              onPrevPage={() => jumpToPage(currentPage - 1)}
              onNextPage={() => jumpToPage(currentPage + 1)}
              pdfZoom={pdfZoom}
              onZoomOut={() => setPdfZoom((prev) => Math.max(0.7, Number((prev - 0.1).toFixed(2))))}
              onZoomIn={() => setPdfZoom((prev) => Math.min(2.4, Number((prev + 0.1).toFixed(2))))}
              openConfigSignal={toolConfigSignal}
            />
            <LibraryPdfScrollViewer
              ref={viewerRef}
              pdfUrl={pdfUrl}
              pageCount={pageCount}
              zoom={pdfZoom}
              mode={annotationMode}
              highlightColor={highlightColor}
              highlightWidth={highlightWidth}
              highlightOpacity={highlightOpacity}
              textColor={textColor}
              textBoxStylePreset={textBoxStylePreset}
              strokes={annotationStrokes}
              textBoxes={annotationTextBoxes}
              onStrokesChange={setAnnotationStrokes}
              onTextBoxesChange={setAnnotationTextBoxes}
              onVisiblePageChange={(page) => {
                setCurrentPage(page);
                setPageInput(String(page));
              }}
              onPageCountChange={setPageCount}
              onZoomChange={setPdfZoom}
              initialScrollAnchor={pdfScrollAnchor}
              onScrollAnchorChange={setPdfScrollAnchor}
              onRequestToolConfig={() => setToolConfigSignal((prev) => prev + 1)}
              initialScrollRatio={pdfScrollRatio}
              onScrollRatioChange={setPdfScrollRatio}
              containerClassName={pdfViewerContainerClassName}
              documentClassName={pdfViewerDocumentClassName}
              t={t}
            />
          </div>
        ) : (
          <div className="m-3 flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            <FileUp className="mr-2 h-3.5 w-3.5" />
            {t("library.viewer.noPdf")}
          </div>
        )}
      </section>
    );
  }

  if (viewMode === "compare") {
    return (
      <section className="grid min-h-0 grid-rows-[minmax(0,1fr)] rounded-lg border border-slate-200 bg-white p-3 motion-card-pop motion-layered-backdrop">
        {pdfPaneLoading ? (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("library.viewer.loading")}
          </div>
        ) : pdfPaneError ? (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
            {t("library.viewer.error")} {pdfPaneError}
          </div>
        ) : hasComparePair && pdfUrl && translatedPdfUrl ? (
          <div className="grid h-full min-h-0 grid-cols-2 gap-3">
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70">
              <ComparePaneHeader
                label={t("library.viewer.compareOriginal")}
                zoom={compareSourceZoom}
                onZoomOut={() => setCompareSourceZoom((prev) => clampCompareZoom(prev - 0.1))}
                onZoomIn={() => setCompareSourceZoom((prev) => clampCompareZoom(prev + 0.1))}
                t={t}
              />
              <LibraryPdfScrollViewer
                pdfUrl={pdfUrl}
                pageCount={pageCount}
                zoom={compareSourceZoom}
                mode="select"
                highlightColor={highlightColor}
                highlightWidth={highlightWidth}
                highlightOpacity={highlightOpacity}
                textColor={textColor}
                textBoxStylePreset={textBoxStylePreset}
                strokes={annotationStrokes}
                textBoxes={annotationTextBoxes}
                onStrokesChange={setAnnotationStrokes}
                onTextBoxesChange={setAnnotationTextBoxes}
                onVisiblePageChange={() => undefined}
                onPageCountChange={setPageCount}
                readOnly
                syncId="source"
                syncGroupRef={compareSyncGroupRef}
                containerClassName={compareViewerContainerClassName}
                documentClassName={compareViewerDocumentClassName}
                onZoomChange={setCompareSourceZoom}
                initialScrollAnchor={compareSourceScrollAnchor}
                onScrollAnchorChange={setCompareSourceScrollAnchor}
                initialScrollRatio={compareSourceScrollRatio}
                onScrollRatioChange={setCompareSourceScrollRatio}
                t={t}
              />
            </div>
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded-lg border border-slate-200 bg-slate-50/70">
              <ComparePaneHeader
                label={t("library.viewer.compareTranslated")}
                zoom={compareTranslatedZoom}
                onZoomOut={() => setCompareTranslatedZoom((prev) => clampCompareZoom(prev - 0.1))}
                onZoomIn={() => setCompareTranslatedZoom((prev) => clampCompareZoom(prev + 0.1))}
                t={t}
              />
              <LibraryPdfScrollViewer
                pdfUrl={translatedPdfUrl}
                pageCount={pageCount}
                zoom={compareTranslatedZoom}
                mode="select"
                highlightColor={highlightColor}
                highlightWidth={highlightWidth}
                highlightOpacity={highlightOpacity}
                textColor={textColor}
                textBoxStylePreset={textBoxStylePreset}
                strokes={[]}
                textBoxes={[]}
                onStrokesChange={() => undefined}
                onTextBoxesChange={() => undefined}
                onVisiblePageChange={() => undefined}
                onPageCountChange={() => undefined}
                readOnly
                syncId="translated"
                syncGroupRef={compareSyncGroupRef}
                containerClassName={compareViewerContainerClassName}
                documentClassName={compareViewerDocumentClassName}
                onZoomChange={setCompareTranslatedZoom}
                initialScrollAnchor={compareTranslatedScrollAnchor}
                onScrollAnchorChange={setCompareTranslatedScrollAnchor}
                initialScrollRatio={compareTranslatedScrollRatio}
                onScrollRatioChange={setCompareTranslatedScrollRatio}
                t={t}
              />
            </div>
          </div>
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("library.viewer.compareUnavailable")}
          </div>
        )}
      </section>
    );
  }

  return (
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(230px,1fr)] gap-2">
      <section
        ref={(node) => {
          bibContainerRef.current = node;
        }}
        className={LIBRARY_INFO_PANE_CLASSNAME}
      >
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("library.viewer.loading")}</div>
        ) : loadError ? (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">{t("library.viewer.error")} {loadError}</div>
        ) : bibPreview.trim().length > 0 ? (
          <pre className="min-h-full whitespace-pre-wrap break-words rounded-lg border border-slate-200 bg-slate-50/70 p-3 font-mono text-xs leading-5 text-slate-700">
            {bibPreview}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("library.viewer.noBib")}
          </div>
        )}
      </section>
      <div
        ref={(node) => {
          metaContainerRef.current = node;
        }}
        className={LIBRARY_INFO_PANE_CLASSNAME}
      >
        <LibraryCitationMetaPanel
          citation={citation}
          linkError={linkError}
          paperPreview={paperPreview}
          paperPreviewLoading={paperPreviewLoading}
          paperPreviewError={paperPreviewError}
          onAnalyzePaper={onAnalyzePaper}
          t={t}
        />
      </div>
    </div>
  );
}
