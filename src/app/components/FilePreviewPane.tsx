import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

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

export function FilePreviewPane(props: {
  mode: "pdf" | "markdown" | "empty";
  pdfUrl: string | null;
  markdownContent: string;
  title: string;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
}) {
  const {
    mode,
    pdfUrl,
    markdownContent,
    title,
    emptyText,
    pdfZoom,
    onPdfZoomChange,
  } = props;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const lensViewportRef = useRef<HTMLDivElement | null>(null);
  const lensFrameRef = useRef<HTMLIFrameElement | null>(null);
  const lensRafRef = useRef<number | null>(null);
  const pendingLensPointRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const [lensActive, setLensActive] = useState(false);
  const lensSize = 220;
  const lensScale = 1.55;
  const renderQualityScale = 1.2;

  useEffect(() => {
    return () => {
      if (lensRafRef.current !== null) {
        window.cancelAnimationFrame(lensRafRef.current);
        lensRafRef.current = null;
      }
    };
  }, []);

  const applyLensPoint = useCallback((x: number, y: number) => {
    const viewport = viewportRef.current;
    const lensViewport = lensViewportRef.current;
    const lensFrame = lensFrameRef.current;
    if (!viewport || !lensViewport || !lensFrame) {
      return;
    }
    const width = viewport.clientWidth;
    const height = viewport.clientHeight;
    const clampedX = Math.max(0, Math.min(width, x));
    const clampedY = Math.max(0, Math.min(height, y));
    const left = Math.max(lensSize / 2, clampedX) - lensSize / 2;
    const top = Math.max(lensSize / 2, clampedY) - lensSize / 2;

    lensViewport.style.transform = `translate3d(${left}px, ${top}px, 0)`;
    lensFrame.style.width = `${width * lensScale * renderQualityScale}px`;
    lensFrame.style.height = `${height * lensScale * renderQualityScale}px`;
    lensFrame.style.transform = `translate3d(${lensSize / 2 - lensScale * renderQualityScale * clampedX}px, ${lensSize / 2 - lensScale * renderQualityScale * clampedY}px, 0)`;
  }, [lensScale, lensSize, renderQualityScale]);

  const updateLensPoint = useCallback((x: number, y: number) => {
    pendingLensPointRef.current = { x, y };
    if (lensRafRef.current !== null) {
      return;
    }
    lensRafRef.current = window.requestAnimationFrame(() => {
      lensRafRef.current = null;
      applyLensPoint(pendingLensPointRef.current.x, pendingLensPointRef.current.y);
    });
  }, [applyLensPoint]);

  useEffect(() => {
    if (!lensActive) {
      return;
    }
    applyLensPoint(pendingLensPointRef.current.x, pendingLensPointRef.current.y);
    if (!viewportRef.current || typeof ResizeObserver === "undefined") {
      return;
    }
    const observer = new ResizeObserver(() => {
      applyLensPoint(pendingLensPointRef.current.x, pendingLensPointRef.current.y);
    });
    observer.observe(viewportRef.current);
    return () => observer.disconnect();
  }, [applyLensPoint, lensActive]);

  const sanitizedMarkdown = useMemo(
    () => normalizeHtmlToMarkdown(sanitizePreviewText(markdownContent ?? "")),
    [markdownContent],
  );

  if (mode === "pdf" && pdfUrl) {
    const zoomPercent = Math.round(pdfZoom * renderQualityScale * 100);
    const pdfSrc = `${pdfUrl}#view=FitH&zoom=${zoomPercent}`;
    return (
      <div
        ref={viewportRef}
        className={`relative h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${
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
        onMouseMove={(event) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect || !lensActive) {
            return;
          }
          updateLensPoint(
            Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
            Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
          );
        }}
        onMouseLeave={() => {
          setLensActive(false);
        }}
        onClick={(event) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          updateLensPoint(
            Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
            Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
          );
          setLensActive((previous) => !previous);
        }}
      >
        <iframe
          title={title}
          src={pdfSrc}
          className="h-full w-full rounded-lg border-0"
          style={{
            minHeight: "100%",
            pointerEvents: "none",
            width: `${renderQualityScale * 100}%`,
            height: `${renderQualityScale * 100}%`,
            transformOrigin: "top left",
            transform: `scale(${1 / renderQualityScale})`,
            willChange: "transform",
          }}
        />
        {lensActive && (
          <div
            ref={lensViewportRef}
            className="pointer-events-none absolute z-20 overflow-hidden rounded-full border border-slate-200/80 bg-white/20 shadow-[0_18px_36px_rgba(15,23,42,0.28)] backdrop-blur-[1px] transition-transform duration-75 ease-out"
            style={{
              width: `${lensSize}px`,
              height: `${lensSize}px`,
              left: "0px",
              top: "0px",
              transform: "translate3d(-9999px, -9999px, 0)",
              willChange: "transform",
            }}
          >
            <iframe
              ref={lensFrameRef}
              title={`${title}-lens`}
              src={`${pdfUrl}#view=FitH&zoom=${Math.round(pdfZoom * renderQualityScale * lensScale * 100)}`}
              className="border-0"
              style={{
                width: "0px",
                height: "0px",
                pointerEvents: "none",
                transform: "translate3d(0, 0, 0)",
                willChange: "transform",
              }}
            />
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

  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
      {emptyText}
    </div>
  );
}
