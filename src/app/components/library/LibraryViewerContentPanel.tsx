import { FileUp, RotateCcw } from "lucide-react";
import { useRef, type MutableRefObject } from "react";
import type { LibraryCitationSummary } from "../../../shared/types/app";
import { LibraryCitationMetaPanel } from "./LibraryCitationMetaPanel";
import {
  LibraryPdfScrollViewer,
  type LibraryPdfScrollSyncGroup,
  type LibraryPdfScrollViewerHandle,
} from "./LibraryPdfScrollViewer";
import { LibraryPdfToolSidebar } from "./LibraryPdfToolSidebar";
import type {
  AnnotationStroke,
  AnnotationTextBox,
  AnnotationTextStylePreset,
} from "./annotationModel";

type TranslationFn = (key: any) => string;
type ToolMode = "select" | "highlight" | "eraser" | "textbox";
type ViewMode = "bib" | "pdf" | "compare";

function formatByteCount(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / (1024 ** index);
  return `${value >= 100 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
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
  translationDetail: string | null;
  translationBusy: boolean;
  translationNotice: { type: "info" | "error"; message: string } | null;
  selectedPath: string | null;
  runTranslation: (onSuccess?: () => void) => void;
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
    translationDetail,
    translationBusy,
    translationNotice,
    selectedPath,
    runTranslation,
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
  const pdfPaneLoading = loading || pdfPreviewLoading || pdfObjectUrlLoading;
  const pdfPaneError = loadError ?? pdfPreviewError;
  const pdfProgressPercent = pdfTotalBytes && pdfTotalBytes > 0
    ? Math.max(0, Math.min(100, (Math.max(pdfDownloadedBytes ?? 0, 0) / pdfTotalBytes) * 100))
    : null;

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
              onRequestToolConfig={() => setToolConfigSignal((prev) => prev + 1)}
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
      <section className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] gap-2 rounded-lg border border-slate-200 bg-white p-3 motion-card-pop motion-layered-backdrop">
        <div className="flex items-center justify-between gap-2 rounded-md border border-slate-200 bg-slate-50 px-2.5 py-1.5">
          <div className="flex min-w-0 items-center gap-2 overflow-hidden">
            <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] text-slate-600">
              {t("library.viewer.syncScroll")}
            </span>
            <span
              className={`truncate rounded-full px-2 py-0.5 text-[11px] ${
                translationBusy
                  ? "border border-amber-200 bg-amber-50 text-amber-700"
                  : translationNotice?.type === "error"
                    ? "border border-rose-200 bg-rose-50 text-rose-700"
                    : "border border-emerald-200 bg-emerald-50 text-emerald-700"
              }`}
              title={translationDetail || translationNotice?.message || undefined}
            >
              {translationBusy
                ? t("library.viewer.translating")
                : translationNotice?.type === "error"
                  ? translationNotice.message
                  : t("library.viewer.translationReady")}
            </span>
          </div>
          <button
            className="inline-flex h-7 w-7 items-center justify-center rounded border border-slate-300 bg-white text-slate-700 transition motion-hover-rise hover:bg-slate-100 disabled:opacity-50"
            onClick={() => {
              runTranslation();
            }}
            disabled={translationBusy || !selectedPath}
            title={t("library.viewer.translatePaper")}
            aria-label={t("library.viewer.translatePaper")}
          >
            <RotateCcw className={`h-3.5 w-3.5 ${translationBusy ? "motion-rotate-soft" : ""}`} />
          </button>
        </div>
        {pdfPaneLoading ? (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("library.viewer.loading")}
          </div>
        ) : pdfPaneError ? (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">{t("library.viewer.error")} {pdfPaneError}</div>
        ) : hasComparePair && pdfUrl && translatedPdfUrl ? (
          <div className="grid h-full min-h-0 grid-cols-2 gap-2">
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded border border-slate-200 bg-slate-50 motion-card-pop">
              <div className="border-b border-slate-200 px-2 py-1 text-xs font-medium text-slate-600">{t("library.viewer.compareOriginal")}</div>
              <LibraryPdfScrollViewer
                pdfUrl={pdfUrl}
                pageCount={pageCount}
                zoom={pdfZoom}
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
                onPageCountChange={setPageCount}
                readOnly
                syncId="source"
                syncGroupRef={compareSyncGroupRef}
                containerClassName="relative min-h-0 min-w-0 h-full overflow-auto rounded-none border-0 bg-slate-100"
                documentClassName="space-y-3 px-2 py-0 pr-4"
                t={t}
              />
            </div>
            <div className="grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden rounded border border-slate-200 bg-slate-50 motion-card-pop">
              <div className="border-b border-slate-200 px-2 py-1 text-xs font-medium text-slate-600">{t("library.viewer.compareTranslated")}</div>
              <LibraryPdfScrollViewer
                pdfUrl={translatedPdfUrl}
                pageCount={pageCount}
                zoom={pdfZoom}
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
                containerClassName="relative min-h-0 min-w-0 h-full overflow-auto rounded-none border-0 bg-slate-100"
                documentClassName="space-y-3 px-2 py-0 pr-4"
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
    <div className="grid h-full min-h-0 grid-rows-[minmax(0,1fr)_minmax(210px,0.95fr)] gap-2">
      <section className="min-h-0 overflow-auto rounded-lg border border-slate-200 bg-white p-3 motion-card-pop">
        {loading ? (
          <div className="flex h-full items-center justify-center text-xs text-slate-500">{t("library.viewer.loading")}</div>
        ) : loadError ? (
          <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">{t("library.viewer.error")} {loadError}</div>
        ) : bibPreview.trim().length > 0 ? (
          <pre className="min-h-full whitespace-pre-wrap break-words rounded border border-slate-200 bg-slate-50 p-3 font-mono text-xs leading-5 text-slate-700">
            {bibPreview}
          </pre>
        ) : (
          <div className="flex h-full items-center justify-center rounded border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
            {t("library.viewer.noBib")}
          </div>
        )}
      </section>
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
  );
}
