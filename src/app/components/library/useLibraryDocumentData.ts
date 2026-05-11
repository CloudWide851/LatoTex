import { startTransition, useCallback, useEffect, useRef, useState } from "react";
import {
  libraryCitationResolve,
  libraryCitationSummary,
  libraryCitationSummaryRemote,
  libraryResolvePdfPreview,
} from "../../../shared/api/library";
import { readFile } from "../../../shared/api/workspace";
import type {
  LibraryCitationSummary,
  LibraryPdfPreview,
} from "../../../shared/types/app";
import { toLibraryWorkspacePath } from "../../../shared/utils/libraryPath";
import {
  hasPdfPreviewIdentityChanged,
  isDocumentDataStateEqual,
} from "./libraryDocumentDataState";

type PaperPreview = null;

export type DocumentDataState = {
  citation: LibraryCitationSummary | null;
  paperPreview: PaperPreview;
  bibPreview: string;
  bibPreviewError: string | null;
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
  bibPreviewError: null,
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

export function clearLibraryDocumentDataCache() {
  documentCache.clear();
}

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

function mergePdfPreviewState(
  current: DocumentDataState,
  preview: LibraryPdfPreview,
  citationOverride?: LibraryCitationSummary | null,
): Omit<DocumentDataState, "citation" | "bibPreview" | "bibPreviewError"> {
  const citation = citationOverride ?? current.citation;
  return {
    paperPreview: null,
    resolvedLink: current.resolvedLink ?? citation?.urls?.[0] ?? preview.sourceUrl ?? null,
    sourcePdfRelativePath: preview.relativePath ?? null,
    translatedPdfRelativePath: preview.translatedRelativePath ?? null,
    pdfCacheState: preview.cacheState ?? (preview.relativePath ? "ready" : "missing"),
    pdfCacheError: preview.cacheError ?? null,
    pdfDownloadedBytes: preview.downloadedBytes ?? null,
    pdfTotalBytes: preview.totalBytes ?? null,
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

function toCitationOnlyDocumentState(
  current: DocumentDataState,
  citation: LibraryCitationSummary,
  bibPreview: string,
  bibPreviewError: string | null = null,
  preservePdfPreview = false,
): DocumentDataState {
  const nextCitation = mergeSummaries(current.citation, applySummaryDefaults(citation));
  const baseState = preservePdfPreview ? current : EMPTY_STATE;
  return {
    ...baseState,
    citation: nextCitation,
    bibPreview,
    bibPreviewError,
    resolvedLink: nextCitation?.urls?.[0] ?? baseState.resolvedLink ?? null,
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
  const [previewRevision, setPreviewRevision] = useState(0);
  const [pdfPreviewRequested, setPdfPreviewRequested] = useState(false);
  const [state, setState] = useState<DocumentDataState>(EMPTY_STATE);
  const requestIdRef = useRef(0);
  const previewRequestRef = useRef<{ key: string; promise: Promise<LibraryPdfPreview> } | null>(null);
  const activeDocumentKeyRef = useRef<string | null>(null);
  const pdfPreviewRequestedRef = useRef(false);
  const stateRef = useRef<DocumentDataState>(EMPTY_STATE);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  const applyState = useCallback((next: DocumentDataState, options?: ApplyStateOptions) => {
    stateRef.current = next;
    setState(next);
    setLoading(Boolean(options?.loading));
    setLoadError(options?.loadError ?? null);
    setPdfPreviewLoading(Boolean(options?.pdfPreviewLoading));
    setPdfPreviewError(options?.pdfPreviewError ?? null);
    setPaperPreviewLoading(Boolean(options?.paperPreviewLoading));
    setPaperPreviewError(options?.paperPreviewError ?? null);
  }, []);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    previewRequestRef.current = null;
    activeDocumentKeyRef.current = null;
    pdfPreviewRequestedRef.current = false;
    stateRef.current = EMPTY_STATE;
    setLoading(false);
    setLoadError(null);
    setPdfPreviewLoading(false);
    setPdfPreviewError(null);
    setPaperPreviewLoading(false);
    setPaperPreviewError(null);
    setPdfPreviewRequested(false);
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
    activeDocumentKeyRef.current = cacheKey;
    setCachedDocumentState(cacheKey, nextState);
    startTransition(() => setState(nextState));
  }, []);

  const applyResolvedPdfPreview = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    preview: LibraryPdfPreview;
  }) => {
    const { requestId, cacheKey, preview } = options;
    if (requestIdRef.current !== requestId) {
      return null;
    }
    const currentState = stateRef.current;
    const nextState: DocumentDataState = {
      ...currentState,
      ...mergePdfPreviewState(currentState, preview),
    };
    const shouldBumpPreviewRevision = hasPdfPreviewIdentityChanged(currentState, nextState);
    setCachedDocumentState(cacheKey, nextState);
    activeDocumentKeyRef.current = cacheKey;
    applyState(nextState, {
      loading: false,
      loadError: null,
      pdfPreviewLoading: nextState.pdfCacheState === "pending",
      pdfPreviewError: nextState.pdfCacheState === "error" ? nextState.pdfCacheError : null,
      paperPreviewLoading: false,
      paperPreviewError: null,
    });
    if (shouldBumpPreviewRevision) {
      setPreviewRevision((revision) => revision + 1);
    }
    return nextState;
  }, [applyState]);

  const resolveRemotePdfPreview = useCallback(async (options: {
    requestId: number;
    cacheKey: string;
    bustCache?: boolean;
  }) => {
    const { requestId, cacheKey, bustCache = false } = options;
    if (!projectId || !selectedPath) {
      return null;
    }
    const requestKey = `${projectId}:${selectedPath}:${bustCache ? "1" : "0"}`;
    if (previewRequestRef.current?.key === requestKey) {
      try {
        const preview = await previewRequestRef.current.promise;
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
    }
    const promise = (async () => {
      return await libraryResolvePdfPreview(projectId, selectedPath, { bustCache });
    })();
    previewRequestRef.current = { key: requestKey, promise };
    try {
      const preview = await promise;
      return await applyResolvedPdfPreview({ requestId, cacheKey, preview });
    } catch (error) {
      if (requestIdRef.current === requestId) {
        startTransition(() => {
          setPdfPreviewLoading(false);
          setPdfPreviewError(String(error));
        });
      }
      return null;
    } finally {
      if (previewRequestRef.current?.key === requestKey) {
        previewRequestRef.current = null;
      }
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
      const resolved = await libraryCitationResolve({
        projectId,
        relativePath: selectedPath,
        includeRemote: false,
      }).catch(async () => ({
        matchedPath: selectedPath,
        matchKind: "legacy",
        summary: await libraryCitationSummary(projectId, selectedPath),
        pdfPreview: null,
        diagnostics: [],
      }));
      const citation = resolved.summary;
      let bibPreview = "";
      let bibPreviewError: string | null = null;
      try {
        bibPreview = await readBibPreview(projectId, selectedPath, citation);
      } catch (error) {
        bibPreviewError = String(error);
      }
      if (requestIdRef.current !== requestId) {
        return null;
      }
      const nextState = toCitationOnlyDocumentState(
        stateRef.current,
        citation,
        bibPreview,
        bibPreviewError,
        activeDocumentKeyRef.current === cacheKey,
      );
      setCachedDocumentState(cacheKey, nextState);
      activeDocumentKeyRef.current = cacheKey;
      applyState(nextState, {
        loading: false,
        loadError: null,
        pdfPreviewLoading: Boolean(resolved.pdfPreview && resolved.pdfPreview.cacheState === "pending"),
        pdfPreviewError: null,
        paperPreviewLoading: false,
        paperPreviewError: null,
      });
      if (resolved.pdfPreview) {
        await applyResolvedPdfPreview({ requestId, cacheKey, preview: resolved.pdfPreview });
      }

      if (!resolved.pdfPreview || resolved.pdfPreview.cacheState !== "ready") {
        void resolveRemotePdfPreview({
          requestId,
          cacheKey,
          bustCache: options?.bustCache ?? false,
        });
      }

      void libraryCitationSummaryRemote(projectId, selectedPath)
        .then((remoteSummary) => {
          mergeRemoteCitationSummary(requestId, cacheKey, remoteSummary);
          const currentState = stateRef.current;
          if (
            !currentState.sourcePdfRelativePath
            && currentState.pdfCacheState === "missing"
          ) {
            void resolveRemotePdfPreview({ requestId, cacheKey, bustCache: false });
          }
        })
        .catch(() => undefined);
      return nextState;
    } catch (error) {
      if (requestIdRef.current === requestId) {
        stateRef.current = EMPTY_STATE;
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
  }, [applyState, mergeRemoteCitationSummary, projectId, reset, resolveRemotePdfPreview, selectedPath]);

  const ensurePdfPreviewLoaded = useCallback(async (options?: { bustCache?: boolean }) => {
    if (!projectId || !selectedPath) {
      return null;
    }
    pdfPreviewRequestedRef.current = true;
    setPdfPreviewRequested(true);

    const cacheKey = documentCacheKey(projectId, selectedPath);
    const requestId = requestIdRef.current;
    const currentState = stateRef.current;

    if (
      !options?.bustCache
      && (currentState.pdfCacheState === "ready" || currentState.pdfCacheState === "pending")
    ) {
      setPdfPreviewLoading(currentState.pdfCacheState === "pending");
      setPdfPreviewError(null);
      return currentState;
    }

    setPdfPreviewLoading(true);
    setPdfPreviewError(null);
    return await resolveRemotePdfPreview({
      requestId,
      cacheKey,
      bustCache: options?.bustCache ?? false,
    });
  }, [projectId, resolveRemotePdfPreview, selectedPath]);

  const retryPdfPreview = useCallback(async () => {
    return await ensurePdfPreviewLoaded({ bustCache: true });
  }, [ensurePdfPreviewLoaded]);

  const refresh = useCallback(async (options?: RefreshOptions) => {
    if (!projectId || !selectedPath) {
      reset();
      return null;
    }
    const cacheKey = documentCacheKey(projectId, selectedPath);
    if (!options?.bustCache && options?.preferCache) {
      const cached = getCachedDocumentState(cacheKey);
      if (cached) {
        const sameActiveDocument = activeDocumentKeyRef.current === cacheKey;
        if (!sameActiveDocument) {
          requestIdRef.current += 1;
        }
        activeDocumentKeyRef.current = cacheKey;
        if (!isDocumentDataStateEqual(stateRef.current, cached)) {
          applyState(cached, {
            loading: false,
            loadError: null,
            pdfPreviewLoading: cached.pdfCacheState === "pending",
            pdfPreviewError: cached.pdfCacheState === "error" ? cached.pdfCacheError : null,
            paperPreviewLoading: false,
            paperPreviewError: null,
          });
        }
        return cached;
      }
    }
    return await loadDocument(options);
  }, [applyState, loadDocument, projectId, reset, selectedPath]);

  useEffect(() => {
    if (!projectId || !selectedPath) {
      reset();
      return;
    }
    void refresh({ preferCache: true });
  }, [projectId, refresh, reset, selectedPath]);

  useEffect(() => {
    if (
      !active
      || !projectId
      || !selectedPath
      || state.pdfCacheState !== "pending"
    ) {
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
    loading,
    loadError,
    pdfPreviewRequested,
    pdfPreviewLoading,
    pdfPreviewError,
    paperPreviewLoading,
    paperPreviewError,
    previewRevision,
    ensurePdfPreviewLoaded,
    retryPdfPreview,
    refresh,
    reset,
  };
}
