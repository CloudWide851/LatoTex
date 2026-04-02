import type { CodeLanguageInfo } from "../../shared/utils/codeLanguage";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { Document, Page } from "react-pdf";
import { CodePreviewPane } from "./CodePreviewPane";
import { ensureReactPdfWorker } from "./pdf/reactPdfSetup";
import { useWorkspacePdfSource } from "./pdf/useWorkspacePdfSource";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

ensureReactPdfWorker();

function sanitizePreviewText(input: string): string {
  return input
    .replace(/\r\n/g, "\n")
    .split("\n")
    .filter((line) => line.trim() !== "\\ No newline at end of file")
    .join("\n");
}

function normalizeHtmlToMarkdown(input: string): string {
  return input
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<h1[^>]*>([\s\S]*?)<\/h1>/gi, "\n# $1\n")
    .replace(/<h2[^>]*>([\s\S]*?)<\/h2>/gi, "\n## $1\n")
    .replace(/<h3[^>]*>([\s\S]*?)<\/h3>/gi, "\n### $1\n")
    .replace(/<h4[^>]*>([\s\S]*?)<\/h4>/gi, "\n#### $1\n")
    .replace(/<h5[^>]*>([\s\S]*?)<\/h5>/gi, "\n##### $1\n")
    .replace(/<h6[^>]*>([\s\S]*?)<\/h6>/gi, "\n###### $1\n")
    .replace(/<li[^>]*>/gi, "\n- ")
    .replace(/<\/li>/gi, "")
    .replace(/<(strong|b)[^>]*>([\s\S]*?)<\/(strong|b)>/gi, "**$2**")
    .replace(/<(em|i)[^>]*>([\s\S]*?)<\/(em|i)>/gi, "*$2*")
    .replace(/<(code)[^>]*>([\s\S]*?)<\/code>/gi, "`$2`")
    .replace(/<(p|div|section|article|blockquote|ul|ol|table|thead|tbody|tr)[^>]*>/gi, "\n")
    .replace(/<\/(p|div|section|article|blockquote|ul|ol|table|thead|tbody|tr)>/gi, "\n")
    .replace(/<(th|td)[^>]*>/gi, " ")
    .replace(/<\/(th|td)>/gi, " ")
    .replace(/<[^>]+>/g, "");
}

function sanitizeSvgForPreview(input: string): string {
  return input
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/\son[a-z]+\s*=\s*(['"]).*?\1/gi, "")
    .replace(/\son[a-z]+\s*=\s*[^\s>]+/gi, "")
    .replace(/javascript:/gi, "");
}

function buildSvgPreviewDocument(svgContent: string): string {
  const safe = sanitizeSvgForPreview(svgContent);
  return [
    "<!doctype html>",
    "<html><head><meta charset=\"utf-8\" />",
    "<meta name=\"viewport\" content=\"width=device-width,initial-scale=1\" />",
    "<style>html,body{margin:0;padding:0;width:100%;height:100%;background:#f8fafc;}body{display:flex;align-items:center;justify-content:center;overflow:auto;}svg{max-width:100%;height:auto;}</style>",
    "</head><body>",
    safe,
    "</body></html>",
  ].join("");
}

type LensPendingPoint = {
  visible: boolean;
  viewportX: number;
  viewportY: number;
  pageX: number;
  pageY: number;
  pageNumber: number;
};

const LENS_SCALE = 1.6;
const LENS_SIZE = 220;
const PDF_VIRTUAL_PADDING_PAGES = 2;

export function FilePreviewPane(props: {
  mode: "pdf" | "image" | "markdown" | "svg" | "code" | "empty";
  pdfUrl: string | null;
  imageUrl: string | null;
  markdownContent: string;
  svgContent: string;
  codeContent: string;
  selectedPath: string | null;
  codeLanguage?: CodeLanguageInfo;
  codeLanguageTag?: string;
  title: string;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
  pdfFallbackProjectId?: string | null;
  pdfFallbackRelativePath?: string | null;
  focusRequest?: { page: number; token: number } | null;
}) {
  const {
    mode,
    pdfUrl,
    imageUrl,
    markdownContent,
    svgContent,
    codeContent,
    selectedPath,
    codeLanguage,
    codeLanguageTag,
    title,
    emptyText,
    pdfZoom,
    onPdfZoomChange,
    pdfFallbackProjectId,
    pdfFallbackRelativePath,
    focusRequest,
  } = props;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lensViewportRef = useRef<HTMLDivElement | null>(null);
  const lensContentRef = useRef<HTMLDivElement | null>(null);
  const lensRafRef = useRef<number | null>(null);
  const scrollRafRef = useRef<number | null>(null);
  const pendingLensPointRef = useRef<LensPendingPoint>({
    visible: false,
    viewportX: 0,
    viewportY: 0,
    pageX: 0,
    pageY: 0,
    pageNumber: 1,
  });
  const lensVisibleRef = useRef(false);
  const lensPageRef = useRef(1);

  const [lensActive, setLensActive] = useState(false);
  const [lensVisible, setLensVisible] = useState(false);
  const [lensPage, setLensPage] = useState(1);
  const [viewportWidth, setViewportWidth] = useState(900);
  const [pageCount, setPageCount] = useState(1);
  const [visiblePage, setVisiblePage] = useState(1);
  const [pdfLoadFailed, setPdfLoadFailed] = useState(false);

  const { effectivePdfUrl, tryFallbackToBlob } = useWorkspacePdfSource({
    pdfUrl,
    fallbackProjectId: pdfFallbackProjectId,
    fallbackRelativePath: pdfFallbackRelativePath,
  });

  useEffect(() => {
    if (mode !== "pdf" || !effectivePdfUrl) {
      return;
    }
    setPdfLoadFailed(false);
  }, [effectivePdfUrl, mode]);

  useEffect(() => {
    return () => {
      if (lensRafRef.current !== null) {
        window.cancelAnimationFrame(lensRafRef.current);
        lensRafRef.current = null;
      }
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!viewportRef.current) {
      return;
    }
    const root = viewportRef.current;
    const update = () => setViewportWidth(root.clientWidth || 900);
    update();
    if (typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(update);
    observer.observe(root);
    return () => observer.disconnect();
  }, [effectivePdfUrl, mode]);

  const basePageWidth = useMemo(
    () => Math.max(320, Math.floor(Math.max(340, viewportWidth) - 24)),
    [viewportWidth],
  );
  const pageWidth = useMemo(
    () => Math.max(240, Math.floor(basePageWidth * pdfZoom)),
    [basePageWidth, pdfZoom],
  );
  const estimatedPageHeight = useMemo(() => Math.max(340, Math.floor(pageWidth * 1.42) + 16), [pageWidth]);

  const applyLensPoint = useCallback(() => {
    const lensViewport = lensViewportRef.current;
    const lensContent = lensContentRef.current;
    const pending = pendingLensPointRef.current;
    if (!lensViewport || !lensContent) {
      return;
    }

    if (pending.visible) {
      const left = pending.viewportX - LENS_SIZE / 2;
      const top = pending.viewportY - LENS_SIZE / 2;
      lensViewport.style.transform = `translate3d(${left}px, ${top}px, 0)`;
      const tx = LENS_SIZE / 2 - pending.pageX * LENS_SCALE;
      const ty = LENS_SIZE / 2 - pending.pageY * LENS_SCALE;
      lensContent.style.transform = `translate3d(${tx}px, ${ty}px, 0)`;
    } else {
      lensViewport.style.transform = "translate3d(-9999px, -9999px, 0)";
    }

    if (pending.pageNumber !== lensPageRef.current) {
      lensPageRef.current = pending.pageNumber;
      setLensPage(pending.pageNumber);
    }
    if (pending.visible !== lensVisibleRef.current) {
      lensVisibleRef.current = pending.visible;
      setLensVisible(pending.visible);
    }
  }, []);

  const queueLensPoint = useCallback(
    (next: LensPendingPoint) => {
      pendingLensPointRef.current = next;
      if (lensRafRef.current !== null) {
        return;
      }
      lensRafRef.current = window.requestAnimationFrame(() => {
        lensRafRef.current = null;
        applyLensPoint();
      });
    },
    [applyLensPoint],
  );

  useEffect(() => {
    if (lensActive) {
      return;
    }
    queueLensPoint({
      ...pendingLensPointRef.current,
      visible: false,
    });
  }, [lensActive, queueLensPoint]);

  const sanitizedMarkdown = useMemo(
    () => normalizeHtmlToMarkdown(sanitizePreviewText(markdownContent ?? "")),
    [markdownContent],
  );
  const sanitizedSvg = useMemo(() => sanitizeSvgForPreview(svgContent ?? ""), [svgContent]);
  const svgDoc = useMemo(() => buildSvgPreviewDocument(sanitizedSvg), [sanitizedSvg]);

  const handlePdfLoadError = useCallback(async () => {
    const recovered = await tryFallbackToBlob();
    if (recovered) {
      setPdfLoadFailed(false);
      return;
    }
    setPdfLoadFailed(true);
    setPageCount(1);
  }, [tryFallbackToBlob]);

  useEffect(() => {
    if (mode !== "pdf" || !effectivePdfUrl) {
      return;
    }
    const viewport = viewportRef.current;
    if (!viewport) {
      return;
    }
    const updateVisiblePage = () => {
      const next = Math.max(
        1,
        Math.min(pageCount, Math.floor(viewport.scrollTop / Math.max(1, estimatedPageHeight)) + 1),
      );
      setVisiblePage((prev) => (prev === next ? prev : next));
    };
    updateVisiblePage();
    const onScroll = () => {
      if (scrollRafRef.current !== null) {
        return;
      }
      scrollRafRef.current = window.requestAnimationFrame(() => {
        scrollRafRef.current = null;
        updateVisiblePage();
      });
    };
    viewport.addEventListener("scroll", onScroll, { passive: true });
    return () => {
      viewport.removeEventListener("scroll", onScroll);
      if (scrollRafRef.current !== null) {
        window.cancelAnimationFrame(scrollRafRef.current);
        scrollRafRef.current = null;
      }
    };
  }, [effectivePdfUrl, estimatedPageHeight, mode, pageCount]);

  useEffect(() => {
    if (mode !== "pdf" || !effectivePdfUrl || !focusRequest || !viewportRef.current) {
      return;
    }
    const page = Math.max(1, Math.min(pageCount, Math.floor(focusRequest.page || 1)));
    const viewport = viewportRef.current;
    const top = Math.max(0, (page - 1) * Math.max(1, estimatedPageHeight) - 8);
    viewport.scrollTo({
      top,
      behavior: "smooth",
    });
    setVisiblePage(page);
  }, [effectivePdfUrl, estimatedPageHeight, focusRequest, mode, pageCount]);

  if (mode === "pdf" && effectivePdfUrl) {
    const pages = Array.from({ length: Math.max(1, pageCount) }, (_, index) => index + 1);
    const virtualStart = Math.max(1, visiblePage - PDF_VIRTUAL_PADDING_PAGES);
    const virtualEnd = Math.min(pageCount, visiblePage + PDF_VIRTUAL_PADDING_PAGES);
    const lensPageWidth = Math.max(280, Math.floor(pageWidth * LENS_SCALE));

    return (
      <div
        ref={viewportRef}
        className={`relative h-full overflow-auto rounded-lg border border-slate-200 bg-slate-50 ${
          lensActive ? "cursor-zoom-out" : "cursor-zoom-in"
        }`}
        onWheel={(event) => {
          if (!event.ctrlKey) {
            return;
          }
          event.preventDefault();
          const step = event.deltaY < 0 ? 0.1 : -0.1;
          const nextZoom = Math.max(0.5, Math.min(3, Number((pdfZoom + step).toFixed(2))));
          onPdfZoomChange(nextZoom);
        }}
      >
        {pdfLoadFailed ? (
          <div className="flex h-full items-center justify-center px-3 text-xs text-slate-500">
            {emptyText}
          </div>
        ) : (
          <Document
            key={effectivePdfUrl}
            file={effectivePdfUrl}
            loading={
              <div className="py-6 text-center text-xs text-slate-500">{emptyText}</div>
            }
            onLoadSuccess={({ numPages }) => {
              const nextCount = Math.max(1, numPages || 1);
              setPdfLoadFailed(false);
              setPageCount(nextCount);
              setVisiblePage((prev) => Math.max(1, Math.min(nextCount, prev)));
              if (lensPageRef.current > nextCount) {
                lensPageRef.current = 1;
                setLensPage(1);
              }
            }}
            onLoadError={() => {
              void handlePdfLoadError();
            }}
            className="space-y-3 p-3"
          >
            {pages.map((pageNumber) => (
              <div
                key={pageNumber}
                className="relative mx-auto overflow-hidden rounded border border-slate-200 bg-white shadow-sm"
                style={{ width: `${pageWidth}px` }}
              >
                {pageNumber >= virtualStart && pageNumber <= virtualEnd ? (
                  <>
                    <Page
                      pageNumber={pageNumber}
                      width={pageWidth}
                      renderTextLayer={false}
                      renderAnnotationLayer={false}
                      loading={null}
                    />
                    <div
                      className="absolute inset-0 z-10"
                      onClick={(event) => {
                        const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const viewportRect = viewportRef.current?.getBoundingClientRect();
                        if (!viewportRect) {
                          return;
                        }
                        const pageX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
                        const pageY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
                        const viewportX = event.clientX - viewportRect.left + (viewportRef.current?.scrollLeft || 0);
                        const viewportY = event.clientY - viewportRect.top + (viewportRef.current?.scrollTop || 0);
                        setLensActive((previous) => !previous);
                        queueLensPoint({
                          visible: !lensActive,
                          pageNumber,
                          pageX,
                          pageY,
                          viewportX,
                          viewportY,
                        });
                      }}
                      onMouseMove={(event) => {
                        if (!lensActive) {
                          return;
                        }
                        const rect = (event.currentTarget as HTMLDivElement).getBoundingClientRect();
                        const viewportRect = viewportRef.current?.getBoundingClientRect();
                        if (!viewportRect) {
                          return;
                        }
                        const pageX = Math.max(0, Math.min(rect.width, event.clientX - rect.left));
                        const pageY = Math.max(0, Math.min(rect.height, event.clientY - rect.top));
                        const viewportX = event.clientX - viewportRect.left + (viewportRef.current?.scrollLeft || 0);
                        const viewportY = event.clientY - viewportRect.top + (viewportRef.current?.scrollTop || 0);
                        queueLensPoint({
                          visible: true,
                          pageNumber,
                          pageX,
                          pageY,
                          viewportX,
                          viewportY,
                        });
                      }}
                      onMouseLeave={() => {
                        queueLensPoint({
                          ...pendingLensPointRef.current,
                          visible: false,
                        });
                      }}
                    />
                  </>
                ) : (
                  <div style={{ height: `${estimatedPageHeight}px` }} />
                )}
              </div>
            ))}
          </Document>
        )}

        {lensActive && (
          <div
            ref={lensViewportRef}
            className={`pointer-events-none absolute z-20 overflow-hidden rounded-full border border-slate-200/80 bg-white/20 shadow-[0_18px_36px_rgba(15,23,42,0.28)] backdrop-blur-[1px] transition-opacity duration-75 ${
              lensVisible ? "opacity-100" : "opacity-0"
            }`}
            style={{
              width: `${LENS_SIZE}px`,
              height: `${LENS_SIZE}px`,
              left: "0px",
              top: "0px",
              transform: "translate3d(-9999px, -9999px, 0)",
              willChange: "transform",
            }}
          >
            <div
              ref={lensContentRef}
              className="absolute left-0 top-0"
              style={{
                width: `${lensPageWidth}px`,
                willChange: "transform",
                transform: "translate3d(0, 0, 0)",
              }}
            >
              <Document key={`lens-${effectivePdfUrl}`} file={effectivePdfUrl} loading={null} error={null}>
                <Page
                  pageNumber={Math.max(1, Math.min(pageCount, lensPage))}
                  width={lensPageWidth}
                  renderTextLayer={false}
                  renderAnnotationLayer={false}
                  loading={null}
                />
              </Document>
            </div>
            <span
              className="absolute left-1/2 top-0 h-full w-px -translate-x-1/2 bg-slate-300/70"
              aria-hidden
            />
            <span
              className="absolute left-0 top-1/2 h-px w-full -translate-y-1/2 bg-slate-300/70"
              aria-hidden
            />
          </div>
        )}
      </div>
    );
  }

  if (mode === "image") {
    return imageUrl ? (
      <div className="flex h-full items-center justify-center overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-2">
        <img
          src={imageUrl}
          alt={title}
          className="max-h-full max-w-full rounded border border-slate-200 bg-white shadow-sm"
        />
      </div>
    ) : (
      <div className="flex h-full items-center justify-center rounded-lg border border-slate-200 bg-slate-50 px-3 text-xs text-slate-500">
        {emptyText}
      </div>
    );
  }

  if (mode === "markdown") {
    return (
      <div className="h-full overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        {sanitizedMarkdown.trim().length === 0 ? (
          <p className="text-xs text-slate-500">{emptyText}</p>
        ) : (
          <article className="markdown-preview space-y-3 text-sm leading-6 text-slate-700">
            <ReactMarkdown
              remarkPlugins={[remarkGfm, remarkMath]}
              rehypePlugins={[rehypeKatex, rehypeHighlight]}
              components={{
                a: ({ ...anchorProps }) => (
                  <a
                    {...anchorProps}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary-700 underline decoration-primary-400 underline-offset-2"
                  />
                ),
                code: ({ inline, className, children, ...codeProps }: any) =>
                  inline ? (
                    <code
                      {...codeProps}
                      className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] ${className ?? ""}`}
                    >
                      {children}
                    </code>
                  ) : (
                    <code {...codeProps} className={`font-mono text-[12px] ${className ?? ""}`}>
                      {children}
                    </code>
                  ),
              }}
            >
              {sanitizedMarkdown}
            </ReactMarkdown>
          </article>
        )}
      </div>
    );
  }

  if (mode === "code") {
    return (
      <CodePreviewPane
        filePath={selectedPath}
        codeContent={codeContent}
        emptyText={emptyText}
        language={codeLanguage}
        languageTag={codeLanguageTag}
      />
    );
  }

  if (mode === "svg") {
    return sanitizedSvg.trim().length === 0 ? (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
        {emptyText}
      </div>
    ) : (
      <div className="h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50">
        <iframe
          title={title}
          sandbox="allow-same-origin"
          srcDoc={svgDoc}
          className="h-full w-full border-0"
        />
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
      {emptyText}
    </div>
  );
}

