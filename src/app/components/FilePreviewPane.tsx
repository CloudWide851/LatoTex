import { useMemo, useRef, useState } from "react";
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

export function FilePreviewPane(props: {
  mode: "pdf" | "markdown" | "empty";
  pdfUrl: string | null;
  markdownContent: string;
  title: string;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
}) {
  const { mode, pdfUrl, markdownContent, title, emptyText, pdfZoom, onPdfZoomChange } = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [lensActive, setLensActive] = useState(false);
  const [lensPoint, setLensPoint] = useState({ x: 0, y: 0 });
  const lensSize = 220;
  const lensScale = 1.85;
  const sanitizedMarkdown = useMemo(
    () => sanitizePreviewText(markdownContent ?? ""),
    [markdownContent],
  );

  if (mode === "pdf" && pdfUrl) {
    const zoomPercent = Math.round(pdfZoom * 100);
    const pdfSrc = `${pdfUrl}#view=FitH&zoom=${zoomPercent}`;
    return (
      <div
        ref={viewportRef}
        className={`relative h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${lensActive ? "cursor-zoom-out" : "cursor-zoom-in"}`}
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
          if (!lensActive) {
            return;
          }
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          setLensPoint({
            x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
            y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
          });
        }}
        onMouseLeave={() => setLensActive(false)}
        onClick={(event) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          setLensPoint({
            x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
            y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
          });
          setLensActive((prev) => !prev);
        }}
      >
        <iframe
          title={title}
          src={pdfSrc}
          className="h-full w-full rounded-lg border-0"
          style={{
            minHeight: "100%",
            pointerEvents: "none",
          }}
        />
        {lensActive && (
          <div
            className="pointer-events-none absolute z-20 overflow-hidden rounded-full border border-slate-200/80 bg-white/20 shadow-[0_18px_36px_rgba(15,23,42,0.28)] backdrop-blur-[1px] transition-[left,top] duration-75 ease-out"
            style={{
              width: `${lensSize}px`,
              height: `${lensSize}px`,
              left: `${Math.max(lensSize / 2, lensPoint.x) - lensSize / 2}px`,
              top: `${Math.max(lensSize / 2, lensPoint.y) - lensSize / 2}px`,
            }}
          >
            <iframe
              title={`${title}-lens`}
              src={pdfSrc}
              className="border-0"
              style={{
                width: `${viewportRef.current?.clientWidth ?? 0}px`,
                height: `${viewportRef.current?.clientHeight ?? 0}px`,
                pointerEvents: "none",
                transformOrigin: "top left",
                transform: `translate(${lensSize / 2 - lensScale * lensPoint.x}px, ${lensSize / 2 - lensScale * lensPoint.y}px) scale(${lensScale})`,
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
                a: ({ ...props }) => (
                  <a
                    {...props}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="text-primary-700 underline decoration-primary-400 underline-offset-2"
                  />
                ),
                code: ({ className, children, ...props }) => (
                  <code
                    {...props}
                    className={`rounded bg-slate-100 px-1 py-0.5 font-mono text-[12px] ${className ?? ""}`}
                  >
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
