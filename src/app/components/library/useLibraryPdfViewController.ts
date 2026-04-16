import { useCallback, useEffect, useState } from "react";

type ViewMode = "bib" | "pdf" | "compare";

export function useLibraryPdfViewController(params: {
  projectId: string | null;
  selectedPath: string | null;
  viewMode: ViewMode;
  hasPdf: boolean;
  hasComparePair: boolean;
  hasTranslated: boolean;
  hasTranslatedArtifact: boolean;
  translatedPdfUrl: string | null;
  translationBusy: boolean;
  translationNotice: { type: "info" | "error"; message: string } | null;
  documentBusy: boolean;
  pdfPreviewRequested: boolean;
  pdfPreviewLoading: boolean;
  pdfPreviewError: string | null;
  pdfObjectUrlLoading: boolean;
  pdfObjectUrlError: string | null;
  pdfCacheState: string;
  sourcePdfRelativePath: string | null;
  ensurePdfPreviewLoaded: (options?: { bustCache?: boolean }) => Promise<unknown>;
  applyViewMode: (mode: ViewMode) => void;
  runTranslation: () => void;
}) {
  const {
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
  } = params;
  const [pendingPdfOpen, setPendingPdfOpen] = useState(false);
  const [pendingCompareOpen, setPendingCompareOpen] = useState(false);

  useEffect(() => {
    setPendingPdfOpen(false);
    setPendingCompareOpen(false);
  }, [projectId, selectedPath]);

  useEffect(() => {
    if (!pendingPdfOpen || !hasPdf || documentBusy) {
      return;
    }
    if (pendingCompareOpen && hasComparePair) {
      return;
    }
    setPendingPdfOpen(false);
    if (viewMode !== "pdf") {
      applyViewMode("pdf");
    }
  }, [
    applyViewMode,
    documentBusy,
    hasComparePair,
    hasPdf,
    pendingCompareOpen,
    pendingPdfOpen,
    viewMode,
  ]);

  useEffect(() => {
    if (!pendingPdfOpen) {
      return;
    }
    const objectUrlPendingFromReadyPreview = (
      pdfPreviewRequested
      && pdfCacheState === "ready"
      && Boolean(sourcePdfRelativePath)
      && !pdfObjectUrlError
      && !pdfPreviewError
    );
    if (
      hasPdf
      || pdfPreviewLoading
      || pdfObjectUrlLoading
      || pdfCacheState === "pending"
      || objectUrlPendingFromReadyPreview
    ) {
      return;
    }
    setPendingPdfOpen(false);
  }, [
    hasPdf,
    pdfCacheState,
    pdfObjectUrlError,
    pdfObjectUrlLoading,
    pdfPreviewError,
    pdfPreviewLoading,
    pdfPreviewRequested,
    pendingPdfOpen,
    sourcePdfRelativePath,
  ]);

  useEffect(() => {
    if (documentBusy || pendingPdfOpen) {
      return;
    }
    if (viewMode === "compare" && !hasComparePair && !pendingCompareOpen) {
      applyViewMode(hasPdf ? "pdf" : "bib");
      return;
    }
    if (viewMode === "pdf" && !hasPdf) {
      applyViewMode("bib");
    }
  }, [applyViewMode, documentBusy, hasComparePair, hasPdf, pendingCompareOpen, pendingPdfOpen, viewMode]);

  useEffect(() => {
    if (!pendingCompareOpen || documentBusy || !hasComparePair) {
      return;
    }
    setPendingCompareOpen(false);
    applyViewMode("compare");
  }, [applyViewMode, documentBusy, hasComparePair, pendingCompareOpen]);

  useEffect(() => {
    if (!pendingCompareOpen || translationBusy) {
      return;
    }
    if (translationNotice?.type === "error") {
      setPendingCompareOpen(false);
    }
  }, [pendingCompareOpen, translationBusy, translationNotice]);

  const requestPdfOpen = useCallback(() => {
    if (hasPdf) {
      setPendingPdfOpen(false);
      applyViewMode("pdf");
      return;
    }
    setPendingPdfOpen(true);
    if (pdfCacheState !== "error") {
      void ensurePdfPreviewLoaded();
    }
  }, [applyViewMode, ensurePdfPreviewLoaded, hasPdf, pdfCacheState]);

  const requestCompareOpen = useCallback(() => {
    if (hasTranslated && translatedPdfUrl) {
      setPendingPdfOpen(false);
      setPendingCompareOpen(false);
      applyViewMode("compare");
      return;
    }
    setPendingPdfOpen(true);
    setPendingCompareOpen(true);
    if (hasPdf) {
      applyViewMode("pdf");
    }
    if (pdfCacheState !== "error" || hasPdf) {
      void ensurePdfPreviewLoaded();
    }
    if (!hasTranslatedArtifact && !translationBusy) {
      runTranslation();
    }
  }, [
    applyViewMode,
    ensurePdfPreviewLoaded,
    hasPdf,
    hasTranslated,
    hasTranslatedArtifact,
    pdfCacheState,
    runTranslation,
    translatedPdfUrl,
    translationBusy,
  ]);

  const retryPdfOpen = useCallback(() => {
    setPendingPdfOpen(true);
    void ensurePdfPreviewLoaded({ bustCache: true });
  }, [ensurePdfPreviewLoaded]);

  return {
    pendingPdfOpen,
    pendingCompareOpen,
    requestPdfOpen,
    requestCompareOpen,
    retryPdfOpen,
    setPendingCompareOpen,
  };
}
