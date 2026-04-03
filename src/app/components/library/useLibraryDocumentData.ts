import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  libraryCitationSummaryRemote,
  libraryExtractPaperContext,
  openLibraryDocument,
} from "../../../shared/api/library";
import type {
  LibraryCitationSummary,
  LibraryDocumentOpenResult,
  LibraryPdfPreview,
} from "../../../shared/types/app";

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
  documentCache.set(cacheKey, { updatedAt: Date.now(), value: cached.value });
  return cached.value;
}

function setCachedDocumentState(cacheKey: string, value: DocumentDataState) {
  if (documentCache.has(cacheKey)) {
    documentCache.delete(cacheKey);
  }
  documentCache.set(cacheKey, { updatedAt: Date.now(), value });
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

function mergeSummaries(
  current: LibraryCitationSummary | null,
  nextLocal: LibraryCitationSummary | null,
): LibraryCitationSummary | null {
  if (!nextLocal) {
    return current;
  }
  if (!current) {
    return applySummaryDefaults(nextLocal);
  }
  const normalizedCurrent = applySummaryDefaults(current);
  const normalizedNext = applySummaryDefaults(nextLocal);
  return {
    ...normalizedNext,
    title: normalizedNext.title ?? normalizedCurrent.title ?? null,
    publishedAt: normalizedNext.publishedAt ?? normalizedCurrent.publishedAt ?? null,
    doi: normalizedNext.doi ?? normalizedCurrent.doi ?? null,
    arxivId: normalizedNext.arxivId ?? normalizedCurrent.arxivId ?? null,
    source: normalizedNext.source ?? normalizedCurrent.source ?? null,
    bibPath: normalizedNext.bibPath ?? normalizedCurrent.bibPath ?? null,
    citationKey: normalizedNext.citationKey ?? normalizedCurrent.citationKey ?? null,
    authors: Array.from(new Set([...normalizedNext.authors, ...normalizedCurrent.authors])),
    urls: Array.from(new Set([...normalizedNext.urls, ...normalizedCurrent.urls])),
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

function toDocumentState(
  document: LibraryDocumentOpenResult,
  current: DocumentDataState,
): DocumentDataState {
  const preview = document.pdfPreview;
  const citation = mergeSummaries(current.citation, applySummaryDefaults(document.citation));
  const nextSourcePdfRelativePath = preview.relativePath ?? null;
  const keepPaperPreview =
    current.paperPreview?.sourcePath
    && nextSourcePdfRelativePath
    && current.paperPreview.sourcePath === nextSourcePdfRelativePath;

  return {
    citation,
    bibPreview: document.bibPreview ?? "",
    paperPreview: keepPaperPreview ? current.paperPreview : null,
    resolvedLink: preview.sourceUrl ?? citation?.urls?.[0] ?? current.resolvedLink,
    sourcePdfRelativePath: nextSourcePdfRelativePath,
    sourcePdfPreviewUrl: preview.previewUrl ?? null,
    translatedPdfRelativePath: preview.translatedRelativePath ?? null,
    translatedPdfPreviewUrl: preview.translatedPreviewUrl ?? null,
    pdfCacheState: preview.cacheState ?? (preview.relativePath ? "ready" : "missing"),
    pdfCacheError: preview.cacheError ?? null,
    pdfDownloadedBytes: preview.downloadedBytes ?? null,
    pdfTotalBytes: preview.totalBytes ?? null,
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

  const mergeRemoteCitationSummary = useCallback((
    requestId: number,
    cacheKey: string,
    remoteSummary: LibraryCitationSummary,
  ) => {
    if (requestIdRef.current !== requestId) {
      return;
    }
    const nextCitation = mergeSummaries(stateRef.current.citation, remoteSummary);
    const nextState: DocumentDataState = {
      ...stateRef.current,
      citation: nextCitation,
      resolvedLink: stateRef.current.resolvedLink ?? nextCitation?.urls?.[0] ?? null,
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

  const applyDocumentPayload = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    document: LibraryDocumentOpenResult;
  }) => {
    const { requestId, cacheKey, document } = options;
    if (requestIdRef.current !== requestId) {
      return null;
    }
    const nextState = toDocumentState(document, stateRef.current);
    const shouldLoadPaperPreview = Boolean(nextState.sourcePdfRelativePath)
      && nextState.pdfCacheState === "ready"
      && nextState.paperPreview?.sourcePath !== nextState.sourcePdfRelativePath;

    setCachedDocumentState(cacheKey, nextState);
    applyState(nextState, {
      loading: false,
      loadError: null,
      pdfPreviewLoading: nextState.pdfCacheState === "pending",
      pdfPreviewError: nextState.pdfCacheState === "error" ? nextState.pdfCacheError : null,
      paperPreviewLoading: shouldLoadPaperPreview,
      paperPreviewError: null,
    });

    if (shouldLoadPaperPreview && nextState.sourcePdfRelativePath) {
      void hydratePaperPreview({
        requestId,
        cacheKey,
        baseState: nextState,
        sourcePdfRelativePath: nextState.sourcePdfRelativePath,
      });
    }
    return nextState;
  }, [applyState, hydratePaperPreview]);

  const loadDocument = useCallback(async (options?: RefreshOptions) => {
    if (!projectId || !selectedPath) {
      reset();
      return null;
    }
    const requestId = requestIdRef.current + 1;
    requestIdRef.current = requestId;
    const cacheKey = documentCacheKey(projectId, selectedPath);

    setLoading(true);
    setLoadError(null);
    setPdfPreviewLoading(false);
    setPdfPreviewError(null);
    setPaperPreviewLoading(false);
    setPaperPreviewError(null);

    try {
      const document = await openLibraryDocument(projectId, selectedPath, {
        bustCache: options?.bustCache ?? false,
      });
      if (requestIdRef.current !== requestId) {
        return null;
      }
      void libraryCitationSummaryRemote(projectId, selectedPath)
        .then((remoteSummary) => {
          mergeRemoteCitationSummary(requestId, cacheKey, remoteSummary);
        })
        .catch(() => undefined);
      return await applyDocumentPayload({ requestId, cacheKey, document });
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
  }, [applyDocumentPayload, mergeRemoteCitationSummary, projectId, reset, selectedPath]);

  const refresh = useCallback(async (options?: RefreshOptions) => {
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
    return await loadDocument(options);
  }, [applyState, hydratePaperPreview, loadDocument, projectId, reset, selectedPath]);

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
    let timer: number | null = null;
    let cancelled = false;
    const poll = async () => {
      if (cancelled) {
        return;
      }
      await loadDocument({ preferCache: false, bustCache: false });
      if (!cancelled && stateRef.current.pdfCacheState === "pending") {
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
  }, [active, loadDocument, projectId, selectedPath, state.pdfCacheState]);

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
