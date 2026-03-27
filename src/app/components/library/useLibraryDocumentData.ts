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

export function useLibraryDocumentData(params: {
  projectId: string | null;
  selectedPath: string | null;
}) {
  const { projectId, selectedPath } = params;
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [state, setState] = useState<DocumentDataState>(EMPTY_STATE);
  const requestIdRef = useRef(0);

  const reset = useCallback(() => {
    requestIdRef.current += 1;
    setLoading(false);
    setLoadError(null);
    setState(EMPTY_STATE);
  }, []);

  const applyState = useCallback((next: DocumentDataState) => {
    startTransition(() => {
      setState(next);
      setLoadError(null);
      setLoading(false);
    });
  }, []);

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
          applyState(cached);
          return cached;
        }
      }

      const requestId = requestIdRef.current + 1;
      requestIdRef.current = requestId;
      setLoading(true);
      setLoadError(null);

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

        const [bibPreview, paperContext] = await Promise.all([
          bibRelative
            ? readFile(projectId, toLibraryWorkspacePath(bibRelative))
                .then((result) => result.content ?? "")
                .catch(() => "")
            : Promise.resolve(""),
          preview.relativePath
            ? libraryExtractPaperContext(projectId, preview.relativePath).catch(() => null)
            : Promise.resolve(null),
        ]);
        if (requestIdRef.current !== requestId) {
          return null;
        }

        const nextState: DocumentDataState = {
          citation: normalizedSummary,
          bibPreview,
          resolvedLink: preview.sourceUrl ?? normalizedSummary.urls?.[0] ?? null,
          pdfUrl: preview.previewUrl ?? null,
          translatedPdfUrl: preview.translatedPreviewUrl ?? null,
          sourcePdfRelativePath: preview.relativePath ?? null,
          translatedPdfRelativePath: preview.translatedRelativePath ?? null,
          paperPreview: paperContext
            ? {
                title: paperContext.title,
                detectedLanguage: paperContext.detectedLanguage,
                extractionEngine: paperContext.extractionEngine,
                pageCount: Number(paperContext.pageCount ?? 0),
                excerpt: String(paperContext.chunks?.[0]?.text ?? "").slice(0, 520),
                sourcePath: preview.relativePath ?? paperContext.pdfRelativePath ?? null,
              }
            : null,
        };

        documentCache.set(cacheKey, nextState);
        applyState(nextState);
        return nextState;
      } catch (error) {
        if (requestIdRef.current === requestId) {
          setLoading(false);
          setLoadError(String(error));
        }
        return null;
      }
    },
    [applyState, projectId, reset, selectedPath],
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
    refresh,
    reset,
  };
}
