import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  libraryCitationSummary,
  libraryExtractPaperContext,
  libraryResolvePdfPreview,
} from "../../../shared/api/library";
import { readFile } from "../../../shared/api/workspace";
import type { LibraryCitationSummary } from "../../../shared/types/app";
import { toLibraryWorkspacePath } from "../../../shared/utils/libraryPath";

type PaperPreview = {
  title?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  pageCount?: number;
  excerpt?: string | null;
  sourcePath?: string | null;
} | null;

type DocumentDataState = {
  citation: LibraryCitationSummary | null;
  paperPreview: PaperPreview;
  bibPreview: string;
  pdfUrl: string | null;
  translatedPdfUrl: string | null;
  resolvedLink: string | null;
  sourcePdfRelativePath: string | null;
  translatedPdfRelativePath: string | null;
};

type RefreshOptions = {
  preferCache?: boolean;
  bustCache?: boolean;
};

const EMPTY_STATE: DocumentDataState = {
  citation: null,
  paperPreview: null,
  bibPreview: "",
  pdfUrl: null,
  translatedPdfUrl: null,
  resolvedLink: null,
  sourcePdfRelativePath: null,
  translatedPdfRelativePath: null,
};

const documentCache = new Map<string, DocumentDataState>();

function documentCacheKey(projectId: string, selectedPath: string): string {
  return `${projectId}::${selectedPath}`;
}

function applySummaryDefaults(summary: LibraryCitationSummary): LibraryCitationSummary {
  return {
    ...summary,
    authors: summary.authors ?? [],
    urls: summary.urls ?? [],
  };
}

function toPaperPreview(
  paperContext: Awaited<ReturnType<typeof libraryExtractPaperContext>>,
  sourcePdfRelativePath: string,
): PaperPreview {
  if (!paperContext) {
    return null;
  }
  return {
    title: paperContext.title,
    detectedLanguage: paperContext.detectedLanguage,
    extractionEngine: paperContext.extractionEngine,
    pageCount: Number(paperContext.pageCount ?? 0),
    excerpt: String(paperContext.chunks?.[0]?.text ?? "").slice(0, 520),
    sourcePath: sourcePdfRelativePath || paperContext.pdfRelativePath || null,
  };
}

export function useLibraryDocumentData(params: {
  projectId: string | null;
  selectedPath: string | null;
}) {
  const { projectId, selectedPath } = params;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [paperPreviewLoading, setPaperPreviewLoading] = useState(false);
  const [paperPreviewError, setPaperPreviewError] = useState<string | null>(null);
  const [state, setState] = useState<DocumentDataState>(EMPTY_STATE);
  const requestIdRef = useRef(0);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setLoading(false);
    setLoadError(null);
    setPaperPreviewLoading(false);
    setPaperPreviewError(null);
    setState(EMPTY_STATE);
  }, []);

  const applyState = useCallback((
    next: DocumentDataState,
    options?: {
      paperPreviewLoading?: boolean;
      paperPreviewError?: string | null;
    },
  ) => {
    startTransition(() => {
      setState(next);
      setLoadError(null);
      setLoading(false);
      setPaperPreviewLoading(Boolean(options?.paperPreviewLoading));
      setPaperPreviewError(options?.paperPreviewError ?? null);
    });
  }, []);

  const hydratePaperPreview = useCallback(async (params: {
    requestId: number;
    cacheKey: string;
    baseState: DocumentDataState;
    sourcePdfRelativePath: string;
  }) => {
    const { requestId, cacheKey, baseState, sourcePdfRelativePath } = params;
    if (!projectId || !sourcePdfRelativePath) {
      applyState(baseState, { paperPreviewLoading: false, paperPreviewError: null });
      return baseState;
    }

    startTransition(() => {
      setPaperPreviewLoading(true);
      setPaperPreviewError(null);
    });

    try {
      const paperContext = await libraryExtractPaperContext(projectId, sourcePdfRelativePath);
      if (requestIdRef.current !== requestId) {
        return null;
      }
      const nextState: DocumentDataState = {
        ...baseState,
        paperPreview: toPaperPreview(paperContext, sourcePdfRelativePath),
      };
      documentCache.set(cacheKey, nextState);
      applyState(nextState, { paperPreviewLoading: false, paperPreviewError: null });
      return nextState;
    } catch (error) {
      if (requestIdRef.current === requestId) {
        startTransition(() => {
          setPaperPreviewLoading(false);
          setPaperPreviewError(String(error));
        });
      }
      return null;
    }
  }, [applyState, projectId]);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      if (!projectId || !selectedPath) {
        reset();
        return null;
      }

      const cacheKey = documentCacheKey(projectId, selectedPath);
      if (!options?.bustCache && options?.preferCache) {
        const cached = documentCache.get(cacheKey);
        if (cached) {
          applyState(cached, { paperPreviewLoading: false, paperPreviewError: null });
          if (cached.sourcePdfRelativePath && !cached.paperPreview) {
            const requestId = requestIdRef.current + 1;
            requestIdRef.current = requestId;
            void hydratePaperPreview({
              requestId,
              cacheKey,
              baseState: cached,
              sourcePdfRelativePath: cached.sourcePdfRelativePath,
            });
          }
          return cached;
        }
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setLoadError(null);
      setPaperPreviewLoading(false);
      setPaperPreviewError(null);

      try {
        const [summary, preview] = await Promise.all([
          libraryCitationSummary(projectId, selectedPath),
          libraryResolvePdfPreview(projectId, selectedPath),
        ]);
        if (requestIdRef.current !== requestId) {
          return null;
        }

        const normalizedSummary = applySummaryDefaults(summary);
        const bibRelative =
          normalizedSummary.bibPath
          ?? (selectedPath.toLowerCase().endsWith(".bib") ? selectedPath : "");

        const bibPreview = await (
          bibRelative
            ? readFile(projectId, toLibraryWorkspacePath(bibRelative))
                .then((result) => result.content ?? "")
                .catch(() => "")
            : Promise.resolve("")
        );
        if (requestIdRef.current !== requestId) {
          return null;
        }

        const baseState: DocumentDataState = {
          citation: normalizedSummary,
          bibPreview,
          resolvedLink: preview.sourceUrl ?? normalizedSummary.urls?.[0] ?? null,
          pdfUrl: preview.previewUrl ?? null,
          translatedPdfUrl: preview.translatedPreviewUrl ?? null,
          sourcePdfRelativePath: preview.relativePath ?? null,
          translatedPdfRelativePath: preview.translatedRelativePath ?? null,
          paperPreview: null,
        };

        documentCache.set(cacheKey, baseState);
        applyState(baseState, {
          paperPreviewLoading: Boolean(preview.relativePath),
          paperPreviewError: null,
        });
        if (!preview.relativePath) {
          return baseState;
        }
        void hydratePaperPreview({
          requestId,
          cacheKey,
          baseState,
          sourcePdfRelativePath: preview.relativePath,
        });
        return baseState;
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadError(String(error));
          setPaperPreviewLoading(false);
          setPaperPreviewError(null);
        }
        return null;
      }
    },
    [applyState, hydratePaperPreview, projectId, reset, selectedPath],
  );

  useEffect(() => {
    if (!projectId || !selectedPath) {
      reset();
      return;
    }
    void refresh({ preferCache: true });
  }, [projectId, refresh, reset, selectedPath]);

  return {
    ...state,
    loading,
    loadError,
    paperPreviewLoading,
    paperPreviewError,
    refresh,
    reset,
  };
}