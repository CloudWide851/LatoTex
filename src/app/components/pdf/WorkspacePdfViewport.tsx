import { useEffect, useRef, useState } from "react";
import type { AnnotationStroke, AnnotationTextBox } from "../library/annotationModel";
import {
  LibraryPdfScrollViewer,
  type LibraryPdfScrollViewerHandle,
} from "../library/LibraryPdfScrollViewer";
import type { PdfScrollAnchor } from "../library/libraryPdfScrollState";
import { useWorkspacePdfSource } from "./useWorkspacePdfSource";

type TranslationFn = (key: any) => string;

const EMPTY_STROKES: AnnotationStroke[] = [];
const EMPTY_TEXTBOXES: AnnotationTextBox[] = [];
const ZERO_SCROLL_ANCHOR: PdfScrollAnchor = {
  page: 1,
  pageFocusRatio: 0,
  absoluteRatio: 0,
};

export function WorkspacePdfViewport(props: {
  pdfUrl: string | null;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
  pdfFallbackProjectId?: string | null;
  pdfFallbackRelativePath?: string | null;
  focusRequest?: { page: number; token: number } | null;
  t: TranslationFn;
}) {
  const {
    pdfUrl,
    emptyText,
    pdfZoom,
    onPdfZoomChange,
    pdfFallbackProjectId,
    pdfFallbackRelativePath,
    focusRequest,
    t,
  } = props;
  const viewerRef = useRef<LibraryPdfScrollViewerHandle | null>(null);
  const [pageCount, setPageCount] = useState(1);
  const [scrollAnchor, setScrollAnchor] = useState<PdfScrollAnchor>(ZERO_SCROLL_ANCHOR);
  const [scrollRatio, setScrollRatio] = useState(0);
  const { effectivePdfUrl, tryFallbackToBlob } = useWorkspacePdfSource({
    pdfUrl,
    fallbackProjectId: pdfFallbackProjectId,
    fallbackRelativePath: pdfFallbackRelativePath,
  });

  useEffect(() => {
    setPageCount(1);
    setScrollAnchor(ZERO_SCROLL_ANCHOR);
    setScrollRatio(0);
  }, [effectivePdfUrl]);

  useEffect(() => {
    if (!focusRequest) {
      return;
    }
    viewerRef.current?.scrollToPage(focusRequest.page);
  }, [focusRequest]);

  if (!effectivePdfUrl) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
        {emptyText}
      </div>
    );
  }

  return (
    <LibraryPdfScrollViewer
      ref={viewerRef}
      pdfUrl={effectivePdfUrl}
      pageCount={pageCount}
      zoom={pdfZoom}
      mode="select"
      readOnly
      highlightColor="#fde047"
      highlightWidth={16}
      highlightOpacity={0.65}
      textColor="#111827"
      textBoxStylePreset="minimal"
      strokes={EMPTY_STROKES}
      textBoxes={EMPTY_TEXTBOXES}
      onStrokesChange={() => undefined}
      onTextBoxesChange={() => undefined}
      onVisiblePageChange={() => undefined}
      onPageCountChange={setPageCount}
      onZoomChange={onPdfZoomChange}
      initialScrollAnchor={scrollAnchor}
      onScrollAnchorChange={setScrollAnchor}
      initialScrollRatio={scrollRatio}
      onScrollRatioChange={setScrollRatio}
      containerClassName="relative h-full min-h-0 overflow-x-auto overflow-y-scroll rounded-lg border border-slate-200 bg-slate-50"
      documentClassName="mx-auto flex w-max min-w-full flex-col gap-3 p-3"
      onDocumentLoadError={() => {
        void tryFallbackToBlob();
      }}
      t={t}
    />
  );
}
