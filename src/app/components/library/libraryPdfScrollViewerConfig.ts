import type { MutableRefObject } from "react";
import type { AnnotationStroke, AnnotationTextBox, AnnotationTextStylePreset } from "./annotationModel";
import type { PdfScrollAnchor } from "./libraryPdfScrollState";
import { clampPdfScrollRatio, type LibraryPdfScrollSyncGroup } from "./libraryPdfScrollViewerShared";

export type ToolMode = "select" | "highlight" | "eraser" | "textbox";
export type TranslationFn = (key: any) => string;

export type LensPendingPoint = {
  visible: boolean;
  viewportX: number;
  viewportY: number;
  pageX: number;
  pageY: number;
  pageNumber: number;
};

export type LibraryPdfScrollViewerProps = {
  pdfUrl: string;
  pageCount: number;
  zoom: number;
  mode: ToolMode;
  highlightColor: string;
  highlightWidth: number;
  highlightOpacity: number;
  textColor: string;
  textBoxStylePreset: AnnotationTextStylePreset;
  strokes: AnnotationStroke[];
  textBoxes: AnnotationTextBox[];
  onStrokesChange: (next: AnnotationStroke[]) => void;
  onTextBoxesChange: (next: AnnotationTextBox[]) => void;
  onVisiblePageChange: (page: number) => void;
  onPageCountChange: (count: number) => void;
  onRequestToolConfig?: () => void;
  readOnly?: boolean;
  syncId?: string;
  syncGroupRef?: MutableRefObject<LibraryPdfScrollSyncGroup | null>;
  containerClassName?: string;
  documentClassName?: string;
  onZoomChange?: (next: number) => void;
  initialScrollAnchor?: PdfScrollAnchor | null;
  onScrollAnchorChange?: (anchor: PdfScrollAnchor) => void;
  initialScrollRatio?: number;
  onScrollRatioChange?: (ratio: number) => void;
  enableLens?: boolean;
  onDocumentLoadError?: (error: string) => void;
  t: TranslationFn;
};

export type LibraryPdfScrollViewerHandle = {
  scrollToPage: (page: number) => void;
};

export const MIN_LIBRARY_PDF_ZOOM = 0.7;
export const MAX_LIBRARY_PDF_ZOOM = 2.4;
export const LENS_SCALE = 1.6;
export const LENS_SIZE = 220;

function createRatioFallbackAnchor(ratio: number): PdfScrollAnchor {
  return {
    page: 1,
    pageFocusRatio: 0,
    absoluteRatio: clampPdfScrollRatio(ratio),
  };
}

export function normalizePdfScrollAnchor(anchor: PdfScrollAnchor | null | undefined, fallbackRatio = 0): PdfScrollAnchor {
  if (!anchor) {
    return createRatioFallbackAnchor(fallbackRatio);
  }
  return {
    page: Math.max(1, Math.floor(anchor.page || 1)),
    pageFocusRatio: clampPdfScrollRatio(anchor.pageFocusRatio),
    absoluteRatio: clampPdfScrollRatio(anchor.absoluteRatio),
  };
}

export function arePdfScrollAnchorsEqual(left: PdfScrollAnchor, right: PdfScrollAnchor): boolean {
  return left.page === right.page
    && Math.abs(left.pageFocusRatio - right.pageFocusRatio) < 0.002
    && Math.abs(left.absoluteRatio - right.absoluteRatio) < 0.002;
}
