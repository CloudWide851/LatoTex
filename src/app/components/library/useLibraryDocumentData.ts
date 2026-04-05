import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  libraryCitationSummary,
  libraryCitationSummaryRemote,
  libraryExtractPaperContext,
  libraryResolvePdfPreview,
} from "../../../shared/api/library";
import { readFile } from "../../../shared/api/workspace";
import type {
  LibraryCitationSummary,
  LibraryPdfPreview,
} from "../../../shared/types/app";
import { toLibraryWorkspacePath } from "../../../shared/utils/libraryPath";
import {
  buildWorkspacePreviewBlobUrl,
  revokeObjectUrl,
} from "../../../shared/utils/workspacePreviewBlob";

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
  translatedPdfRelativePath: string | null;
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
  translatedPdfRelativePath: null,
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

function mergePdfPreviewState(
  current: DocumentDataState,
  preview: LibraryPdfPreview,
  citationOverride?: LibraryCitationSummary | null,
): Omit<DocumentDataState, "citation" | "bibPreview"> {
  const citation = citationOverride ?? current.citation;
  const nextSourcePdfRelativePath = preview.relativePath ?? null;
  const keepPaperPreview =
    current.paperPreview?.sourcePath
    && nextSourcePdfRelativePath
    && current.paperPreview.sourcePath === nextSourcePdfRelativePath;

  return {
    paperPreview: keepPaperPreview ? current.paperPreview : null,
    resolvedLink: preview.sourceUrl ?? citation?.urls?.[0] ?? current.resolvedLink,
    sourcePdfRelativePath: nextSourcePdfRelativePath,
    translatedPdfRelativePath: preview.translatedRelativePath ?? null,
    pdfCacheState: preview.cacheState ?? (preview.relativePath ? "ready" : "missing"),
    pdfCacheError: preview.cacheError ?? null,
    pdfDownloadedBytes: preview.downloadedBytes ?? null,
    pdfTotalBytes: preview.totalBytes ?? null,
  };
}

function toDocumentState(params: {
  current: DocumentDataState;
  citation: LibraryCitationSummary;
  bibPreview: string;
  pdfPreview: LibraryPdfPreview;
}): DocumentDataState {
  const citation = mergeSummaries(params.current.citation, applySummaryDefaults(params.citation));
  return {
    citation,
    bibPreview: params.bibPreview,
    ...mergePdfPreviewState(params.current, params.pdfPreview, citation),
  };
}

async function readBibPreview(
  projectId: string,
  selectedPath: string,
  citation: LibraryCitationSummary,
): Promise<string> {
  const bibRelativePath = citation.bibPath ?? (selectedPath.toLowerCase().endsWith(".bib") ? selectedPath : "");
  if (!bibRelativePath) {
    return "";
  }
  const result = await readFile(projectId, toLibraryWorkspacePath(bibRelativePath));
  return result.content;
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
  const [pdfUrl, setPdfUrl] = useState<string | null>(null);
  const [translatedPdfUrl, setTranslatedPdfUrl] = useState<string | null>(null);
  const requestIdRef = useRef(0);
  const stateRef = useRef<DocumentDataState>(EMPTY_STATE);
  const sourceBlobUrlRef = useRef<string | null>(null);
  const translatedBlobUrlRef = useRef<string | null>(null);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const updateBlobUrls = useCallback((nextPdfUrl: string | null, nextTranslatedPdfUrl: string | null) => {
    if (sourceBlobUrlRef.current && sourceBlobUrlRef.current !== nextPdfUrl) {
      revokeObjectUrl(sourceBlobUrlRef.current);
    }
    if (translatedBlobUrlRef.current && translatedBlobUrlRef.current !== nextTranslatedPdfUrl) {
      revokeObjectUrl(translatedBlobUrlRef.current);
    }
    sourceBlobUrlRef.current = nextPdfUrl;
    translatedBlobUrlRef.current = nextTranslatedPdfUrl;
    setPdfUrl(nextPdfUrl);
    setTranslatedPdfUrl(nextTranslatedPdfUrl);
  }, []);

  const clearBlobUrls = useCallback(() => {
    updateBlobUrls(null, null);
  }, [updateBlobUrls]);

  useEffect(() => {
    return () => {
      revokeObjectUrl(sourceBlobUrlRef.current);
      revokeObjectUrl(translatedBlobUrlRef.current);
      sourceBlobUrlRef.current = null;
      translatedBlobUrlRef.current = null;
    };
  }, []);

  const applyState = useCallback((next: DocumentDataState, options?: ApplyStateOptions) => {
    stateRef.current = next;
    startTransition(() => {
      setState(next);
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
    clearBlobUrls();
    setLoading(false);
    setLoadError(null);
    setPdfPreviewLoading(false);
    setPdfPreviewError(null);
    setPaperPreviewLoading(false);
    setPaperPreviewError(null);
    setState(EMPTY_STATE);
  }, [clearBlobUrls]);

  const hydratePdfBlobUrls = useCallback(async (options: {
    requestId: number;
    sourcePdfRelativePath: string | null;
    translatedPdfRelativePath: string | null;
    cacheState: LibraryPdfPreview["cacheState"];
  }) => {
    const {
      requestId,
      sourcePdfRelativePath,
      translatedPdfRelativePath,
      cacheState,
    } = options;

    if (!projectId || cacheState !== "ready" || !sourcePdfRelativePath) {
      if (requestIdRef.current === requestId) {
        clearBlobUrls();
      }
      return;
    }

    try {
      const [nextPdfUrl, nextTranslatedPdfUrl] = await Promise.all([
        buildWorkspacePreviewBlobUrl(projectId, sourcePdfRelativePath),
        translatedPdfRelativePath
          ? buildWorkspacePreviewBlobUrl(projectId, translatedPdfRelativePath)
          : Promise.resolve(null),
      ]);
      if (requestIdRef.current !== requestId) {
        revokeObjectUrl(nextPdfUrl);
        revokeObjectUrl(nextTranslatedPdfUrl);
        return;
      }
      updateBlobUrls(nextPdfUrl, nextTranslatedPdfUrl);
    } catch (error) {
      if (requestIdRef.current !== requestId) {
        return;
      }
      clearBlobUrls();
      startTransition(() => {
        setPdfPreviewLoading(false);
        setPdfPreviewError(String(error));
      });
    }
  }, [clearBlobUrls, projectId, updateBlobUrls]);

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

  const applyResolvedPdfPreview = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    preview: LibraryPdfPreview;
  }) => {
    const { requestId, cacheKey, preview } = options;
    if (requestIdRef.current !== requestId) {
      return null;
    }
    const nextState: DocumentDataState = {
      ...stateRef.current,
      ...mergePdfPreviewState(stateRef.current, preview),
    };
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
    await hydratePdfBlobUrls({
      requestId,
      sourcePdfRelativePath: nextState.sourcePdfRelativePath,
      translatedPdfRelativePath: nextState.translatedPdfRelativePath,
      cacheState: nextState.pdfCacheState,
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
  }, [applyState, hydratePaperPreview, hydratePdfBlobUrls]);

  const applyDocumentPayload = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    citation: LibraryCitationSummary;
    bibPreview: string;
    pdfPreview: LibraryPdfPreview;
  }) => {
    const { requestId, cacheKey, citation, bibPreview, pdfPreview } = options;
    if (requestIdRef.current !== requestId) {
      return null;
    }
    const nextState = toDocumentState({
      current: stateRef.current,
      citation,
      bibPreview,
      pdfPreview,
    });
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
    await hydratePdfBlobUrls({
      requestId,
      sourcePdfRelativePath: nextState.sourcePdfRelativePath,
      translatedPdfRelativePath: nextState.translatedPdfRelativePath,
      cacheState: nextState.pdfCacheState,
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
  }, [applyState, hydratePaperPreview, hydratePdfBlobUrls]);

  const resolveRemotePdfPreview = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    bustCache?: boolean;
  }) => {
    const { requestId, cacheKey, bustCache = false } = options;
    if (!projectId || !selectedPath) {
      return null;
    }
    try {
      const preview = await libraryResolvePdfPreview(projectId, selectedPath, { bustCache });
      return await applyResolvedPdfPreview({ requestId, cacheKey, preview });
    } catch (error) {
      if (requestIdRef.current === requestId) {
        startTransition(() => {
          setPdfPreviewLoading(false);
          setPdfPreviewError(String(error));
        });
      }
      return null;
    }
  }, [applyResolvedPdfPreview, projectId, selectedPath]);

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
      const [citation, pdfPreview] = await Promise.all([
        libraryCitationSummary(projectId, selectedPath),
        libraryResolvePdfPreview(projectId, selectedPath, { bustCache: options?.bustCache ?? false }),
      ]);
      const bibPreview = await readBibPreview(projectId, selectedPath, citation);
      if (requestIdRef.current !== requestId) {
        return null;
      }
      void libraryCitationSummaryRemote(projectId, selectedPath)
        .then((remoteSummary) => {
          mergeRemoteCitationSummary(requestId, cacheKey, remoteSummary);
          const currentState = stateRef.current;
          if (!currentState.sourcePdfRelativePath && currentState.pdfCacheState === "missing") {
            void resolveRemotePdfPreview({ requestId, cacheKey, bustCache: false });
          }
        })
        .catch(() => undefined);
      return await applyDocumentPayload({
        requestId,
        cacheKey,
        citation,
        bibPreview,
        pdfPreview,
      });
    } catch (error) {
      if (requestIdRef.current === requestId) {
        stateRef.current = EMPTY_STATE;
        clearBlobUrls();
        setState(EMPTY_STATE);
        setLoading(false);
        setLoadError(String(error));
        setPdfPreviewLoading(false);
        setPdfPreviewError(null);
        setPaperPreviewLoading(false);
        setPaperPreviewError(null);
      }
      return null;
    }
  }, [applyDocumentPayload, clearBlobUrls, mergeRemoteCitationSummary, projectId, reset, resolveRemotePdfPreview, selectedPath]);

  const refresh = useCallback(async (options?: RefreshOptions) => {
    if (!projectId || !selectedPath) {
      reset();
      return null;
    }
    const cacheKey = documentCacheKey(projectId, selectedPath);
    if (!options?.bustCache && options?.preferCache) {
      const cached = getCachedDocumentState(cacheKey);
      if (cached) {
        const requestId = requestIdRef.current + 1;
        requestIdRef.current = requestId;
        applyState(cached, {
          loading: false,
          loadError: null,
          pdfPreviewLoading: cached.pdfCacheState === "pending",
          pdfPreviewError: cached.pdfCacheState === "error" ? cached.pdfCacheError : null,
          paperPreviewLoading: false,
          paperPreviewError: null,
        });
        await hydratePdfBlobUrls({
          requestId,
          sourcePdfRelativePath: cached.sourcePdfRelativePath,
          translatedPdfRelativePath: cached.translatedPdfRelativePath,
          cacheState: cached.pdfCacheState,
        });
        if (cached.sourcePdfRelativePath && !cached.paperPreview) {
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
  }, [applyState, hydratePaperPreview, hydratePdfBlobUrls, loadDocument, projectId, reset, selectedPath]);

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
      await resolveRemotePdfPreview({
        requestId: requestIdRef.current,
        cacheKey: documentCacheKey(projectId, selectedPath),
        bustCache: false,
      });
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
  }, [active, projectId, resolveRemotePdfPreview, selectedPath, state.pdfCacheState]);

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
