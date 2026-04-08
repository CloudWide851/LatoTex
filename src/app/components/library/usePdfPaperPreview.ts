import { useEffect, useState } from "react";
import { pdfjs } from "react-pdf";
import { ensureReactPdfWorker } from "../pdf/reactPdfSetup";

type PaperPreview = {
  title?: string | null;
  detectedLanguage?: string | null;
  extractionEngine?: string | null;
  pageCount?: number | null;
  excerpt?: string | null;
};

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

function normalizeText(value: string): string {
  return value
    .replace(/\s+/g, " ")
    .replace(/\s+([,.;:!?])/g, "$1")
    .trim();
}

function extractExcerpt(text: string, fallbackTitle?: string | null): string {
  const normalized = normalizeText(text);
  if (!normalized) {
    return "";
  }
  const withoutTitle = fallbackTitle
    ? normalized.replace(new RegExp(`^${fallbackTitle.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*`, "i"), "")
    : normalized;
  const abstractMatch = withoutTitle.match(/(?:^|\b)(abstract|摘要)\s*[:.\-]?\s*([\s\S]{80,800})/i);
  if (abstractMatch?.[2]) {
    return normalizeText(
      abstractMatch[2].split(/\b(?:keywords?|index terms|introduction|1\s+[A-Z])/i, 1)[0] ?? "",
    ).slice(0, 520);
  }
  return withoutTitle.slice(0, 520);
}

async function buildPaperPreview(pdfUrl: string, fallbackTitle?: string | null): Promise<PaperPreview> {
  ensureReactPdfWorker();
  const loadingTask = pdfjs.getDocument(pdfUrl);
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
  fallbackTitle?: string | null;
}) {
  const { pdfUrl, fallbackTitle } = params;
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
    setLoading(true);
    setError(null);
    setPaperPreview(null);
    void buildPaperPreview(pdfUrl, fallbackTitle)
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
  }, [fallbackTitle, pdfUrl]);

  return {
    paperPreview,
    loading,
    error,
  };
}
