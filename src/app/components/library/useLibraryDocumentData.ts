import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  libraryCitationSummary,
  libraryCitationSummaryRemote,
  libraryExtractPaperContext,
  libraryResolvePdfPreview,
} from "../../../shared/api/library";
import { readFile } from "../../../shared/api/workspace";
import type { LibraryCitationSummary, LibraryPdfPreview } from "../../../shared/types/app";
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
  resolvedLink: string | null;
  sourcePdfRelativePath: string | null;
  sourcePdfPreviewUrl: string | null;
  translatedPdfRelativePath: string | null;
  translatedPdfPreviewUrl: string | null;
  pdfCacheState: LibraryPdfPreview["cacheState"];
  pdfCacheError: string | null;
  pdfDownloadedBytes: number | null;
  pdfTotalBytes: number | null;
};

type RefreshOptions = {
  preferCache?: boolean;
  bustCache?: boolean;
};

type ApplyStateOptions = {
  loading?: boolean;
  loadError?: string | null;
  pdfPreviewLoading?: boolean;
  pdfPreviewError?: string | null;
  paperPreviewLoading?: boolean;
  paperPreviewError?: string | null;
};

const EMPTY_STATE: DocumentDataState = {
  citation: null,
  paperPreview: null,
  bibPreview: "",
  resolvedLink: null,
  sourcePdfRelativePath: null,
  sourcePdfPreviewUrl: null,
  translatedPdfRelativePath: null,
  translatedPdfPreviewUrl: null,
  pdfCacheState: "missing",
  pdfCacheError: null,
  pdfDownloadedBytes: null,
  pdfTotalBytes: null,
};

const DOCUMENT_CACHE_MAX = 24;
const DOCUMENT_CACHE_TTL_MS = 10 * 60 * 1000;
const PDF_PREVIEW_POLL_MS = 1500;

type DocumentCacheEntry = {
  updatedAt: number;
  value: DocumentDataState;
};

const documentCache = new Map<string, DocumentCacheEntry>();

function documentCacheKey(projectId: string, selectedPath: string): string {
  return `${projectId}::${selectedPath}`;
}

function getCachedDocumentState(cacheKey: string): DocumentDataState | null {
  const cached = documentCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  if (Date.now() - cached.updatedAt > DOCUMENT_CACHE_TTL_MS) {
    documentCache.delete(cacheKey);
    return null;
  }
  documentCache.delete(cacheKey);
  documentCache.set(cacheKey, {
    updatedAt: Date.now(),
    value: cached.value,
  });
  return cached.value;
}

function setCachedDocumentState(cacheKey: string, value: DocumentDataState) {
  if (documentCache.has(cacheKey)) {
    documentCache.delete(cacheKey);
  }
  documentCache.set(cacheKey, {
    updatedAt: Date.now(),
    value,
  });
  while (documentCache.size > DOCUMENT_CACHE_MAX) {
    const oldest = documentCache.keys().next().value;
    if (!oldest) {
      break;
    }
    documentCache.delete(oldest);
  }
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
  active: boolean;
}) {
  const { projectId, selectedPath, active } = params;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [pdfPreviewLoading, setPdfPreviewLoading] = useState(false);
  const [pdfPreviewError, setPdfPreviewError] = useState<string | null>(null);
  const [paperPreviewLoading, setPaperPreviewLoading] = useState(false);
  const [paperPreviewError, setPaperPreviewError] = useState<string | null>(null);
  const [state, setState] = useState<DocumentDataState>(EMPTY_STATE);
  const requestIdRef = useRef(0);
  const stateRef = useRef<DocumentDataState>(EMPTY_STATE);
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [translatedPdfUrl, setTranslatedPdfUrl] = useState<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    stateRef.current = EMPTY_STATE;
    setLoading(false);
    setLoadError(null);
    setPdfPreviewLoading(false);
    setPdfPreviewError(null);
    setPaperPreviewLoading(false);
    setPaperPreviewError(null);
    setPdfUrl(null);
    setTranslatedPdfUrl(null);
    setState(EMPTY_STATE);
  }, []);

  const applyState = useCallback((next: DocumentDataState, options?: ApplyStateOptions) => {
    stateRef.current = next;
    startTransition(() => {
      setState(next);
      setPdfUrl(next.sourcePdfPreviewUrl ?? null);
      setTranslatedPdfUrl(next.translatedPdfPreviewUrl ?? null);
      setLoading(Boolean(options?.loading));
      setLoadError(options?.loadError ?? null);
      setPdfPreviewLoading(Boolean(options?.pdfPreviewLoading));
      setPdfPreviewError(options?.pdfPreviewError ?? null);
      setPaperPreviewLoading(Boolean(options?.paperPreviewLoading));
      setPaperPreviewError(options?.paperPreviewError ?? null);
    });
  }, []);

  const mergeRemoteCitationSummary = useCallback((
    requestId: number,
    cacheKey: string,
    remoteSummary: LibraryCitationSummary,
  ) => {
    if (requestIdRef.current !== requestId) {
      return;
    }
    const current = stateRef.current;
    const nextState: DocumentDataState = {
      ...current,
      citation: applySummaryDefaults(remoteSummary),
      resolvedLink: remoteSummary.urls?.[0] ?? current.resolvedLink,
    };
    stateRef.current = nextState;
    setCachedDocumentState(cacheKey, nextState);
    startTransition(() => setState(nextState));
  }, []);

  const hydratePaperPreview = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    baseState: DocumentDataState;
    sourcePdfRelativePath: string;
  }) => {
    const { requestId, cacheKey, baseState, sourcePdfRelativePath } = options;
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
      setCachedDocumentState(cacheKey, nextState);
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

  const hydratePdfPreview = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    baseState: DocumentDataState;
    previewPromise?: Promise<Awaited<ReturnType<typeof libraryResolvePdfPreview>>>;
  }) => {
    const { requestId, cacheKey, baseState, previewPromise } = options;
    if (!projectId || !selectedPath) {
      applyState(baseState, { pdfPreviewLoading: false, pdfPreviewError: null });
      return baseState;
    }

    startTransition(() => {
      setPdfPreviewLoading(true);
      setPdfPreviewError(null);
    });

    try {
      const preview = await (previewPromise ?? libraryResolvePdfPreview(projectId, selectedPath));
      if (requestIdRef.current !== requestId) {
        return null;
      }

      const nextState: DocumentDataState = {
        ...baseState,
        resolvedLink: preview.sourceUrl ?? baseState.resolvedLink,
        sourcePdfRelativePath: preview.relativePath ?? null,
        sourcePdfPreviewUrl: preview.previewUrl ?? null,
        translatedPdfRelativePath: preview.translatedRelativePath ?? null,
        translatedPdfPreviewUrl: preview.translatedPreviewUrl ?? null,
        pdfCacheState: preview.cacheState ?? (preview.relativePath ? "ready" : "missing"),
        pdfCacheError: preview.cacheError ?? null,
        pdfDownloadedBytes: preview.downloadedBytes ?? null,
        pdfTotalBytes: preview.totalBytes ?? null,
      };
      const shouldLoadPaperPreview = Boolean(preview.relativePath)
        && nextState.pdfCacheState === "ready"
        && nextState.paperPreview?.sourcePath !== preview.relativePath;

      setCachedDocumentState(cacheKey, nextState);
      applyState(nextState, {
        pdfPreviewLoading: nextState.pdfCacheState === "pending",
        pdfPreviewError: nextState.pdfCacheState === "error" ? nextState.pdfCacheError : null,
        paperPreviewLoading: shouldLoadPaperPreview,
        paperPreviewError: null,
      });

      if (shouldLoadPaperPreview && preview.relativePath) {
        void hydratePaperPreview({
          requestId,
          cacheKey,
          baseState: nextState,
          sourcePdfRelativePath: preview.relativePath,
        });
      }
      return nextState;
    } catch (error) {
      const errorMessage = String(error);
      const errorState: DocumentDataState = {
        ...baseState,
        sourcePdfRelativePath: null,
        sourcePdfPreviewUrl: null,
        translatedPdfRelativePath: null,
        translatedPdfPreviewUrl: null,
        pdfCacheState: "error",
        pdfCacheError: errorMessage,
        pdfDownloadedBytes: null,
        pdfTotalBytes: null,
      };
      setCachedDocumentState(cacheKey, errorState);
      if (requestIdRef.current === requestId) {
        applyState(errorState, {
          pdfPreviewLoading: false,
          pdfPreviewError: errorMessage,
          paperPreviewLoading: false,
          paperPreviewError: null,
        });
      }
      return errorState;
    }
  }, [applyState, hydratePaperPreview, projectId, selectedPath]);

  const refresh = useCallback(
    async (options?: RefreshOptions) => {
      if (!projectId || !selectedPath) {
        reset();
        return null;
      }

      const cacheKey = documentCacheKey(projectId, selectedPath);
      if (!options?.bustCache && options?.preferCache) {
        const cached = getCachedDocumentState(cacheKey);
        if (cached) {
          applyState(cached, {
            loading: false,
            loadError: null,
            pdfPreviewLoading: cached.pdfCacheState === "pending",
            pdfPreviewError: cached.pdfCacheState === "error" ? cached.pdfCacheError : null,
            paperPreviewLoading: false,
            paperPreviewError: null,
          });
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
      setPdfPreviewLoading(false);
      setPdfPreviewError(null);
      setPaperPreviewLoading(false);
      setPaperPreviewError(null);

      try {
        const previewPromise = libraryResolvePdfPreview(projectId, selectedPath, { bustCache: options?.bustCache ?? false });
        const summary = await libraryCitationSummary(projectId, selectedPath);
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
                .catch((error) => {
                  console.error("Failed to read bib file:", bibRelative, error);
                  return "";
                })
            : Promise.resolve("")
        );
        if (requestIdRef.current !== requestId) {
          return null;
        }

        const baseState: DocumentDataState = {
          citation: normalizedSummary,
          bibPreview,
          resolvedLink: normalizedSummary.urls?.[0] ?? null,
          sourcePdfRelativePath: null,
          sourcePdfPreviewUrl: null,
          translatedPdfRelativePath: null,
          translatedPdfPreviewUrl: null,
          paperPreview: null,
          pdfCacheState: "pending",
          pdfCacheError: null,
          pdfDownloadedBytes: null,
          pdfTotalBytes: null,
        };

        setCachedDocumentState(cacheKey, baseState);
        applyState(baseState, {
          loading: false,
          loadError: null,
          pdfPreviewLoading: true,
          pdfPreviewError: null,
          paperPreviewLoading: false,
          paperPreviewError: null,
        });
        void libraryCitationSummaryRemote(projectId, selectedPath)
          .then((remoteSummary) => {
            mergeRemoteCitationSummary(requestId, cacheKey, remoteSummary);
          })
          .catch(() => undefined);
        return await hydratePdfPreview({
          requestId,
          cacheKey,
          baseState,
          previewPromise,
        });
      } catch (error) {
        if (requestIdRef.current === requestId) {
          stateRef.current = EMPTY_STATE;
          setState(EMPTY_STATE);
          setPdfUrl(null);
          setTranslatedPdfUrl(null);
          setLoading(false);
          setLoadError(String(error));
          setPdfPreviewLoading(false);
          setPdfPreviewError(null);
          setPaperPreviewLoading(false);
          setPaperPreviewError(null);
        }
        return null;
      }
    },
    [applyState, hydratePaperPreview, hydratePdfPreview, mergeRemoteCitationSummary, projectId, reset, selectedPath],
  );

  useEffect(() => {
    if (!projectId || !selectedPath) {
      reset();
      return;
    }
    void refresh({ preferCache: true });
  }, [projectId, refresh, reset, selectedPath]);

  useEffect(() => {
    if (!active || !projectId || !selectedPath || state.pdfCacheState !== "pending") {
      return;
    }
    const cacheKey = documentCacheKey(projectId, selectedPath);
    let timer: number | null = null;
    let cancelled = false;

    const poll = async () => {
      if (cancelled) {
        return;
      }
      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      const result = await hydratePdfPreview({
        requestId,
        cacheKey,
        baseState: stateRef.current,
      });
      if (cancelled) {
        return;
      }
      if (result?.pdfCacheState === "pending") {
        timer = window.setTimeout(() => {
          void poll();
        }, PDF_PREVIEW_POLL_MS);
      }
    };

    timer = window.setTimeout(() => {
      void poll();
    }, PDF_PREVIEW_POLL_MS);

    return () => {
      cancelled = true;
      if (timer !== null) {
        window.clearTimeout(timer);
      }
    };
  }, [active, hydratePdfPreview, projectId, selectedPath, state.pdfCacheState]);

  return {
    ...state,
    pdfUrl,
    translatedPdfUrl,
    loading,
    loadError,
    pdfPreviewLoading,
    pdfPreviewError,
    paperPreviewLoading,
    paperPreviewError,
    refresh,
    reset,
  };
}
