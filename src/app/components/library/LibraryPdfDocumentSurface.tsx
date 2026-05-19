import type { HTMLAttributes, MutableRefObject } from "react";
import { Document } from "react-pdf";
import type { WorkspacePreviewBinarySource } from "../../../shared/utils/workspacePreviewBlob";
import type { AnnotationStroke, AnnotationTextBox, AnnotationTextStylePreset } from "./annotationModel";
import { LibraryPdfLensOverlay } from "./LibraryPdfLensOverlay";
import { LibraryPdfScrollViewerPage } from "./LibraryPdfScrollViewerPage";
import { LibraryPdfViewerErrorState } from "./libraryPdfScrollViewerShell";
import type { LensPendingPoint, ToolMode, TranslationFn } from "./libraryPdfScrollViewerConfig";

export function LibraryPdfDocumentSurface(props: {
  rootProps: HTMLAttributes<HTMLDivElement>;
  scrollRef: MutableRefObject<HTMLDivElement | null>;
  pdfUrl: string;
  pdfSource?: WorkspacePreviewBinarySource | null;
  documentLoadError: string | null;
  documentClassName: string;
  pages: number[];
  documentPages: number;
  frameWidth: number;
  annotationScale: number;
  lensEnabled: boolean;
  lensActive: boolean;
  lensVisible: boolean;
  lensPage: number;
  lensPageWidth: number;
  lensSize: number;
  readOnly: boolean;
  mode: ToolMode;
  highlightColor: string;
  highlightWidth: number;
  highlightOpacity: number;
  textColor: string;
  textBoxStylePreset: AnnotationTextStylePreset;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
  pageRefs: MutableRefObject<Record<number, HTMLDivElement | null>>;
  pendingLensPointRef: MutableRefObject<LensPendingPoint>;
  lensViewportRef: MutableRefObject<HTMLDivElement | null>;
  lensContentRef: MutableRefObject<HTMLDivElement | null>;
  onDocumentLoadSuccess: (numPages: number) => void;
  onDocumentLoadError: (error: unknown) => void;
  onMoveLens: (next: LensPendingPoint) => void;
  onHideLens: () => void;
  onPageLayoutChange: () => void;
  onPageRenderSuccess: (page: number) => void;
  onStrokesChange: (next: AnnotationStroke[]) => void;
  onTextBoxesChange: (next: AnnotationTextBox[]) => void;
  t: TranslationFn;
}) {
  const {
    rootProps,
    scrollRef,
    pdfUrl,
    pdfSource,
    documentLoadError,
    documentClassName,
    pages,
    documentPages,
    frameWidth,
    annotationScale,
    lensEnabled,
    lensActive,
    lensVisible,
    lensPage,
    lensPageWidth,
    lensSize,
    readOnly,
    mode,
    highlightColor,
    highlightWidth,
    highlightOpacity,
    textColor,
    textBoxStylePreset,
    strokes,
    textBoxes,
    pageRefs,
    pendingLensPointRef,
    lensViewportRef,
    lensContentRef,
    onDocumentLoadSuccess,
    onDocumentLoadError,
    onMoveLens,
    onHideLens,
    onPageLayoutChange,
    onPageRenderSuccess,
    onStrokesChange,
    onTextBoxesChange,
    t,
  } = props;

  if (documentLoadError) {
    return (
      <LibraryPdfViewerErrorState rootProps={rootProps}>
        <div className="rounded border border-rose-300 bg-rose-50 px-3 py-2 text-xs text-rose-700">
          {t("library.viewer.error")} {documentLoadError}
        </div>
      </LibraryPdfViewerErrorState>
    );
  }

  return (
    <div ref={scrollRef} {...rootProps}>
      <Document
        key={pdfUrl}
        file={pdfSource?.documentData ?? pdfUrl}
        loading={<div className="py-6 text-center text-xs text-slate-500">{t("library.viewer.loading")}</div>}
        onLoadSuccess={({ numPages }) => onDocumentLoadSuccess(numPages)}
        onLoadError={onDocumentLoadError}
        className={documentClassName}
      >
        {pages.map((page) => (
          <LibraryPdfScrollViewerPage
            key={page}
            page={page}
            frameWidth={frameWidth}
            annotationScale={annotationScale}
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
            onMoveLens={onMoveLens}
            onHideLens={onHideLens}
            onLayoutChange={onPageLayoutChange}
            onRenderSuccess={() => onPageRenderSuccess(page)}
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
        pdfSource={pdfSource}
        lensPage={lensPage}
        lensPageWidth={lensPageWidth}
        documentPages={documentPages}
        lensSize={lensSize}
        lensViewportRef={lensViewportRef}
        lensContentRef={lensContentRef}
      />
    </div>
  );
}
