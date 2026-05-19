import { useEffect, useState } from "react";
import { libraryExtractPaperContext } from "../../../shared/api/library";
import {
  buildWorkspacePreviewBinarySource,
  revokeObjectUrl,
  type WorkspacePreviewBinarySource,
} from "../../../shared/utils/workspacePreviewBlob";
import {
  buildPdfJsPaperPreview,
  extractExcerpt,
  normalizeText,
  type PaperPreview,
} from "./usePdfPaperPreview";

const PAPER_BRIEF_CACHE_MAX = 48;
const paperBriefCache = new Map<string, PaperPreview>();

export function clearLibraryPaperBriefCache() {
  paperBriefCache.clear();
}

function hasUsableExcerpt(preview: PaperPreview | null): boolean {
  return Boolean(preview?.excerpt && preview.excerpt.trim().length > 0);
}

function readCachedPaperPreview(cacheKey: string | null): PaperPreview | null {
  if (!cacheKey) {
    return null;
  }
  const cached = paperBriefCache.get(cacheKey);
  if (!cached) {
    return null;
  }
  paperBriefCache.delete(cacheKey);
  paperBriefCache.set(cacheKey, cached);
  return cached;
}

function writeCachedPaperPreview(cacheKey: string | null, preview: PaperPreview): PaperPreview {
  if (!cacheKey) {
    return preview;
  }
  paperBriefCache.set(cacheKey, preview);
  while (paperBriefCache.size > PAPER_BRIEF_CACHE_MAX) {
    const oldestKey = paperBriefCache.keys().next().value;
    if (!oldestKey) {
      break;
    }
    paperBriefCache.delete(oldestKey);
  }
  return preview;
}

function toBackendPaperPreview(
  result: Awaited<ReturnType<typeof libraryExtractPaperContext>>,
  fallbackTitle?: string | null,
): PaperPreview {
  const chunkText = result.chunks
    .map((chunk) => chunk.text)
    .filter((text) => text.trim().length > 0)
    .join("\n\n");
  const excerpt = extractExcerpt(normalizeText(chunkText), fallbackTitle ?? result.title);
  return {
    title: result.title || fallbackTitle || null,
    detectedLanguage: result.detectedLanguage ?? null,
    extractionEngine: result.extractionEngine ?? "python",
    pageCount: result.pageCount ?? null,
    excerpt,
  };
}

async function buildBackendPaperPreview(input: {
  projectId: string;
  selectedPath: string;
  fallbackTitle?: string | null;
}): Promise<PaperPreview> {
  const result = await libraryExtractPaperContext(input.projectId, input.selectedPath);
  return toBackendPaperPreview(result, input.fallbackTitle);
}

async function buildPdfJsPaperPreviewFromSource(input: {
  projectId: string;
  sourcePdfRelativePath: string;
  fallbackTitle?: string | null;
}): Promise<PaperPreview> {
  const source = await buildWorkspacePreviewBinarySource(input.projectId, input.sourcePdfRelativePath);
  if (!source) {
    throw new Error("library.viewer.pdfBlobUnavailable");
  }
  try {
    return await buildPdfJsPaperPreview(source, input.fallbackTitle);
  } finally {
    revokeObjectUrl(source.objectUrl);
  }
}

function buildCacheKey(input: {
  engine: "auto" | "pdfjs" | "python";
  projectId: string | null;
  selectedPath: string | null;
  sourcePdfRelativePath?: string | null;
  previewKey?: string | null;
  pdfUrl: string | null;
  pdfSource?: WorkspacePreviewBinarySource | null;
}): string | null {
  const baseKey = input.sourcePdfRelativePath
    ?? input.previewKey
    ?? input.selectedPath
    ?? input.pdfSource?.relativePath
    ?? input.pdfUrl;
  if (!baseKey) {
    return null;
  }
  return [
    input.engine,
    input.projectId ?? "",
    input.selectedPath ?? "",
    baseKey,
  ].join("::");
}

export function useLibraryPaperBrief(params: {
  projectId: string | null;
  selectedPath: string | null;
  pdfUrl: string | null;
  pdfSource?: WorkspacePreviewBinarySource | null;
  sourcePdfRelativePath?: string | null;
  fallbackTitle?: string | null;
  engine: "auto" | "pdfjs" | "python";
  previewKey?: string | null;
}) {
  const {
    projectId,
    selectedPath,
    pdfUrl,
    pdfSource = null,
    sourcePdfRelativePath,
    fallbackTitle,
    engine,
    previewKey,
  } = params;
  const [paperPreview, setPaperPreview] = useState<PaperPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const cacheKey = buildCacheKey({
      engine,
      projectId,
      selectedPath,
      sourcePdfRelativePath,
      previewKey,
      pdfUrl,
      pdfSource,
    });
    const cached = readCachedPaperPreview(cacheKey);
    if (cached) {
      setPaperPreview(cached);
      setLoading(false);
      setError(null);
      return;
    }

    const canBuildPdfJsPreview = Boolean(pdfSource || pdfUrl || (projectId && sourcePdfRelativePath));
    const canBuildBackendPreview = Boolean(projectId && selectedPath);

    if (
      (engine === "pdfjs" && !canBuildPdfJsPreview)
      || (engine === "python" && !canBuildBackendPreview)
      || (engine === "auto" && !canBuildPdfJsPreview)
    ) {
      setPaperPreview(null);
      setLoading(false);
      setError(null);
      return;
    }

    const run = async () => {
      setLoading(true);
      setError(null);
      setPaperPreview(null);
      try {
        const buildPdfPreview = async (): Promise<PaperPreview> => {
          if (pdfSource) {
            return await buildPdfJsPaperPreview(pdfSource, fallbackTitle);
          }
          if (pdfUrl) {
            return await buildPdfJsPaperPreview(pdfUrl, fallbackTitle);
          }
          if (projectId && sourcePdfRelativePath) {
            return await buildPdfJsPaperPreviewFromSource({
              projectId,
              sourcePdfRelativePath,
              fallbackTitle,
            });
          }
          throw new Error("library.viewer.pdfBlobUnavailable");
        };

        if (engine === "pdfjs") {
          const preview = await buildPdfPreview();
          if (!cancelled) {
            setPaperPreview(writeCachedPaperPreview(cacheKey, preview));
          }
          return;
        }

        if (engine === "python") {
          const preview = await buildBackendPaperPreview({
            projectId: projectId as string,
            selectedPath: selectedPath as string,
            fallbackTitle,
          });
          if (!cancelled) {
            setPaperPreview(writeCachedPaperPreview(cacheKey, preview));
          }
          return;
        }

        const pdfjsPreview = await buildPdfPreview();
        if (!cancelled && hasUsableExcerpt(pdfjsPreview)) {
          setPaperPreview(writeCachedPaperPreview(cacheKey, pdfjsPreview));
          return;
        }

        const backendPreview = canBuildBackendPreview
          ? await buildBackendPaperPreview({
              projectId: projectId as string,
              selectedPath: selectedPath as string,
              fallbackTitle,
            })
          : null;
        const nextPreview = backendPreview && hasUsableExcerpt(backendPreview)
          ? backendPreview
          : pdfjsPreview;
        if (!cancelled) {
          setPaperPreview(writeCachedPaperPreview(cacheKey, nextPreview));
        }
      } catch (nextError) {
        if (!cancelled) {
          setPaperPreview(null);
          setError(String(nextError));
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    };

    void run();
    return () => {
      cancelled = true;
    };
  }, [engine, fallbackTitle, pdfSource, pdfUrl, previewKey, projectId, selectedPath, sourcePdfRelativePath]);

  return {
    paperPreview,
    loading,
    error,
  };
}
