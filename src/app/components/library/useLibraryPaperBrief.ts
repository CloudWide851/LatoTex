import { useEffect, useState } from "react";
import { libraryExtractPaperContext } from "../../../shared/api/library";
import {
  buildPdfJsPaperPreview,
  extractExcerpt,
  normalizeText,
  type PaperPreview,
} from "./usePdfPaperPreview";

function hasUsableExcerpt(preview: PaperPreview | null): boolean {
  return Boolean(preview?.excerpt && preview.excerpt.trim().length > 0);
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

export function useLibraryPaperBrief(params: {
  projectId: string | null;
  selectedPath: string | null;
  pdfUrl: string | null;
  fallbackTitle?: string | null;
  engine: "auto" | "pdfjs" | "python";
}) {
  const {
    projectId,
    selectedPath,
    pdfUrl,
    fallbackTitle,
    engine,
  } = params;
  const [paperPreview, setPaperPreview] = useState<PaperPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!pdfUrl) {
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
        if (engine === "pdfjs") {
          const preview = await buildPdfJsPaperPreview(pdfUrl, fallbackTitle);
          if (!cancelled) {
            setPaperPreview(preview);
          }
          return;
        }

        if (engine === "python") {
          if (!projectId || !selectedPath) {
            throw new Error("library.viewer.paperBriefError");
          }
          const preview = await buildBackendPaperPreview({ projectId, selectedPath, fallbackTitle });
          if (!cancelled) {
            setPaperPreview(preview);
          }
          return;
        }

        const pdfjsPreview = await buildPdfJsPaperPreview(pdfUrl, fallbackTitle);
        if (!cancelled && hasUsableExcerpt(pdfjsPreview)) {
          setPaperPreview(pdfjsPreview);
          return;
        }

        if (!projectId || !selectedPath) {
          if (!cancelled) {
            setPaperPreview(pdfjsPreview);
          }
          return;
        }

        const backendPreview = await buildBackendPaperPreview({ projectId, selectedPath, fallbackTitle });
        if (!cancelled) {
          setPaperPreview(hasUsableExcerpt(backendPreview) ? backendPreview : pdfjsPreview);
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
  }, [engine, fallbackTitle, pdfUrl, projectId, selectedPath]);

  return {
    paperPreview,
    loading,
    error,
  };
}
