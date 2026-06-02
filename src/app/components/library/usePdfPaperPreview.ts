import { useEffect, useState } from "react";
import { pdfjs } from "react-pdf";
import { ensureReactPdfWorker } from "../pdf/reactPdfSetup";
import {
  createWorkspacePreviewDocumentData,
  type WorkspacePreviewBinarySource,
} from "../../../shared/utils/workspacePreviewBlob";
import { extractExcerpt, normalizeText, type PaperPreview } from "./pdfPaperPreviewText";

const PDF_PREVIEW_TIMEOUT_MS = 8_000;
const PDF_PREVIEW_MAX_PAGES = 4;
const PDF_PREVIEW_TARGET_CHARS = 2_400;

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const timer = window.setTimeout(() => {
      reject(new Error("library.viewer.paperBriefTimeout"));
    }, timeoutMs);
    promise.then(
      (value) => {
        window.clearTimeout(timer);
        resolve(value);
      },
      (error) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function buildPdfJsPaperPreview(
  pdfInput: string | WorkspacePreviewBinarySource,
  fallbackTitle?: string | null,
): Promise<PaperPreview> {
  ensureReactPdfWorker();
  const loadingTask = pdfjs.getDocument(
    typeof pdfInput === "string" ? pdfInput : createWorkspacePreviewDocumentData(pdfInput),
  );
  const document = await withTimeout(loadingTask.promise, PDF_PREVIEW_TIMEOUT_MS);
  let combinedText = "";
  try {
    for (let pageNumber = 1; pageNumber <= Math.min(document.numPages, PDF_PREVIEW_MAX_PAGES); pageNumber += 1) {
      const page = await withTimeout(document.getPage(pageNumber), PDF_PREVIEW_TIMEOUT_MS);
      const content = await withTimeout(page.getTextContent(), PDF_PREVIEW_TIMEOUT_MS);
      const pageText = normalizeText(
        content.items
          .map((item) => ("str" in item ? String(item.str ?? "") : ""))
          .join(" "),
      );
      if (!pageText) {
        continue;
      }
      combinedText = combinedText ? `${combinedText}\n${pageText}` : pageText;
      if (combinedText.length >= PDF_PREVIEW_TARGET_CHARS) {
        break;
      }
    }
  } finally {
    await loadingTask.destroy().catch(() => undefined);
  }

  return {
    title: fallbackTitle ?? null,
    extractionEngine: "pdfjs",
    pageCount: document.numPages,
    excerpt: extractExcerpt(combinedText, fallbackTitle),
  };
}

export function usePdfPaperPreview(params: {
  pdfUrl: string | null;
  pdfSource?: WorkspacePreviewBinarySource | null;
  fallbackTitle?: string | null;
}) {
  const { pdfUrl, pdfSource = null, fallbackTitle } = params;
  const [paperPreview, setPaperPreview] = useState<PaperPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    if (!pdfUrl && !pdfSource) {
      setPaperPreview(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    setPaperPreview(null);
    void buildPdfJsPaperPreview(pdfSource ?? (pdfUrl as string), fallbackTitle)
      .then((nextPreview) => {
        if (!cancelled) {
          setPaperPreview(nextPreview);
          setLoading(false);
        }
      })
      .catch((nextError) => {
        if (!cancelled) {
          setPaperPreview(null);
          setLoading(false);
          setError(String(nextError));
        }
      });
    return () => {
      cancelled = true;
    };
  }, [fallbackTitle, pdfSource, pdfUrl]);

  return {
    paperPreview,
    loading,
    error,
  };
}
