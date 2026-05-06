import { useEffect, useRef } from "react";

type ViewMode = "bib" | "pdf" | "compare";

type RefreshResult = {
  sourcePdfRelativePath?: string | null;
} | null | undefined;

export function useLibraryTranslationDriftRefresh(params: {
  projectId: string | null;
  selectedPath: string | null;
  translatedSessionPath: string | null;
  translatedSessionSourcePath: string | null;
  translatedPdfRelativePath: string | null;
  sourcePdfRelativePath: string | null;
  pdfPreviewRequested: boolean;
  viewMode: ViewMode;
  refreshDocumentData: () => Promise<RefreshResult>;
  ensurePdfPreviewLoaded: () => Promise<unknown>;
  resetTranslationState: () => void;
}) {
  const {
    projectId,
    selectedPath,
    translatedSessionPath,
    translatedSessionSourcePath,
    translatedPdfRelativePath,
    sourcePdfRelativePath,
    pdfPreviewRequested,
    viewMode,
    refreshDocumentData,
    ensurePdfPreviewLoaded,
    resetTranslationState,
  } = params;
  const translatedPathRefreshKeysRef = useRef<Set<string>>(new Set());
  const sourcePathRefreshKeysRef = useRef<Set<string>>(new Set());
  const documentKey = `${projectId ?? ""}::${selectedPath ?? ""}`;

  useEffect(() => {
    if (!projectId || !selectedPath || !translatedSessionPath) {
      return;
    }
    if (translatedSessionPath === translatedPdfRelativePath) {
      return;
    }
    const refreshKey = `${documentKey}::translated::${translatedSessionPath}::${translatedPdfRelativePath ?? ""}`;
    if (translatedPathRefreshKeysRef.current.has(refreshKey)) {
      return;
    }
    translatedPathRefreshKeysRef.current.add(refreshKey);
    void refreshDocumentData().then(() => {
      if (pdfPreviewRequested || viewMode === "pdf" || viewMode === "compare") {
        return ensurePdfPreviewLoaded();
      }
      return undefined;
    });
  }, [
    documentKey,
    ensurePdfPreviewLoaded,
    pdfPreviewRequested,
    projectId,
    refreshDocumentData,
    selectedPath,
    translatedPdfRelativePath,
    translatedSessionPath,
    viewMode,
  ]);

  useEffect(() => {
    if (
      !projectId
      || !selectedPath
      || !translatedSessionSourcePath
      || !sourcePdfRelativePath
      || translatedSessionSourcePath === sourcePdfRelativePath
    ) {
      return;
    }
    const refreshKey = `${documentKey}::source::${translatedSessionSourcePath}::${sourcePdfRelativePath}`;
    if (sourcePathRefreshKeysRef.current.has(refreshKey)) {
      return;
    }
    sourcePathRefreshKeysRef.current.add(refreshKey);
    let cancelled = false;
    void refreshDocumentData().then((nextState) => {
      if (cancelled) {
        return;
      }
      const refreshedSourcePath = nextState?.sourcePdfRelativePath ?? sourcePdfRelativePath;
      if (translatedSessionSourcePath !== refreshedSourcePath) {
        resetTranslationState();
      }
    });
    return () => {
      cancelled = true;
    };
  }, [
    documentKey,
    projectId,
    refreshDocumentData,
    resetTranslationState,
    selectedPath,
    sourcePdfRelativePath,
    translatedSessionSourcePath,
  ]);
}
