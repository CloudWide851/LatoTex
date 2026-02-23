import { forwardRef, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import rehypeKatex from "rehype-katex";
import remarkGfm from "remark-gfm";
import remarkMath from "remark-math";
import { readFile, writeFile } from "../../shared/api/desktop";
import "katex/dist/katex.min.css";
import "highlight.js/styles/github.css";

type AnnotationPoint = {
  x: number;
  y: number;
};

type AnnotationStroke = {
  id: string;
  points: AnnotationPoint[];
};

type AnnotationPayload = {
  version: 1;
  strokes: AnnotationStroke[];
};

export type FilePreviewPaneHandle = {
  undoAnnotation: () => void;
  clearAnnotations: () => void;
};

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

function toAnnotationRelativePath(key: string): string {
  const normalized = key.trim().toLowerCase();
  const safe = normalized
    .replace(/[^a-z0-9._-]+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 96) || "preview";
  let hash = 2166136261;
  for (let index = 0; index < normalized.length; index += 1) {
    hash ^= normalized.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  const digest = (hash >>> 0).toString(16).padStart(8, "0");
  return `.latotex/annotations/${safe}-${digest}.json`;
}

function clampPointToView(x: number, y: number, width: number, height: number): AnnotationPoint {
  if (width <= 0 || height <= 0) {
    return { x: 0, y: 0 };
  }
  return {
    x: Math.max(0, Math.min(1000, Number(((x / width) * 1000).toFixed(2)))),
    y: Math.max(0, Math.min(1000, Number(((y / height) * 1000).toFixed(2)))),
  };
}

function parseAnnotationPayload(content: string): AnnotationStroke[] {
  try {
    const parsed = JSON.parse(content) as Partial<AnnotationPayload>;
    if (!Array.isArray(parsed?.strokes)) {
      return [];
    }
    return parsed.strokes
      .filter((item) => Array.isArray(item?.points) && item.points.length > 1)
      .map((item, index) => ({
        id: typeof item.id === "string" && item.id.length > 0 ? item.id : `stroke-${index}`,
        points: item.points
          .map((point) => ({
            x: Number(point?.x ?? 0),
            y: Number(point?.y ?? 0),
          }))
          .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
      }))
      .filter((item) => item.points.length > 1);
  } catch {
    return [];
  }
}

export const FilePreviewPane = forwardRef<FilePreviewPaneHandle, {
  mode: "pdf" | "markdown" | "empty";
  pdfUrl: string | null;
  markdownContent: string;
  title: string;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
  projectId: string | null;
  annotationStorageKey: string | null;
  annotationEnabled: boolean;
  onAnnotationCountChange: (count: number) => void;
}>((props, ref) => {
  const {
    mode,
    pdfUrl,
    markdownContent,
    title,
    emptyText,
    pdfZoom,
    onPdfZoomChange,
    projectId,
    annotationStorageKey,
    annotationEnabled,
    onAnnotationCountChange,
  } = props;

  const viewportRef = useRef<HTMLDivElement | null>(null);
  const drawingRef = useRef(false);
  const [lensActive, setLensActive] = useState(false);
  const [lensPoint, setLensPoint] = useState({ x: 0, y: 0 });
  const [annotationStrokes, setAnnotationStrokes] = useState<AnnotationStroke[]>([]);
  const [draftStroke, setDraftStroke] = useState<AnnotationPoint[] | null>(null);
  const [annotationLoaded, setAnnotationLoaded] = useState(false);
  const lensSize = 220;
  const lensScale = 1.85;

  const annotationRelativePath = useMemo(
    () => (annotationStorageKey ? toAnnotationRelativePath(annotationStorageKey) : null),
    [annotationStorageKey],
  );
  const sanitizedMarkdown = useMemo(
    () => normalizeHtmlToMarkdown(sanitizePreviewText(markdownContent ?? "")),
    [markdownContent],
  );

  useImperativeHandle(ref, () => ({
    undoAnnotation() {
      setAnnotationStrokes((previous) => previous.slice(0, -1));
    },
    clearAnnotations() {
      setAnnotationStrokes([]);
      setDraftStroke(null);
    },
  }), []);

  useEffect(() => {
    onAnnotationCountChange(annotationStrokes.length);
  }, [annotationStrokes.length, onAnnotationCountChange]);

  useEffect(() => {
    if (annotationEnabled) {
      setLensActive(false);
    }
  }, [annotationEnabled]);

  useEffect(() => {
    let disposed = false;
    if (mode !== "pdf" || !pdfUrl || !projectId || !annotationRelativePath) {
      setAnnotationLoaded(false);
      setAnnotationStrokes([]);
      setDraftStroke(null);
      return;
    }
    setAnnotationLoaded(false);
    setDraftStroke(null);
    void readFile(projectId, annotationRelativePath)
      .then((result) => {
        if (disposed) {
          return;
        }
        setAnnotationStrokes(parseAnnotationPayload(result.content));
      })
      .catch(() => {
        if (!disposed) {
          setAnnotationStrokes([]);
        }
      })
      .finally(() => {
        if (!disposed) {
          setAnnotationLoaded(true);
        }
      });

    return () => {
      disposed = true;
    };
  }, [annotationRelativePath, mode, pdfUrl, projectId]);

  useEffect(() => {
    if (!annotationLoaded || !projectId || !annotationRelativePath) {
      return;
    }
    const timer = window.setTimeout(() => {
      const payload: AnnotationPayload = {
        version: 1,
        strokes: annotationStrokes,
      };
      void writeFile(projectId, annotationRelativePath, JSON.stringify(payload, null, 2));
    }, 180);
    return () => {
      window.clearTimeout(timer);
    };
  }, [annotationLoaded, annotationRelativePath, annotationStrokes, projectId]);

  if (mode === "pdf" && pdfUrl) {
    const zoomPercent = Math.round(pdfZoom * 100);
    const pdfSrc = `${pdfUrl}#view=FitH&zoom=${zoomPercent}`;
    return (
      <div
        ref={viewportRef}
        className={`relative h-full overflow-hidden rounded-lg border border-slate-200 bg-slate-50 ${
          annotationEnabled ? "cursor-crosshair" : lensActive ? "cursor-zoom-out" : "cursor-zoom-in"
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
        onMouseDown={(event) => {
          if (!annotationEnabled) {
            return;
          }
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          drawingRef.current = true;
          const first = clampPointToView(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
          setDraftStroke([first]);
        }}
        onMouseMove={(event) => {
          const rect = viewportRef.current?.getBoundingClientRect();
          if (!rect) {
            return;
          }
          if (annotationEnabled && drawingRef.current) {
            const point = clampPointToView(event.clientX - rect.left, event.clientY - rect.top, rect.width, rect.height);
            setDraftStroke((previous) => (previous ? [...previous, point] : [point]));
            return;
          }
          if (!annotationEnabled && lensActive) {
            setLensPoint({
              x: Math.max(0, Math.min(rect.width, event.clientX - rect.left)),
              y: Math.max(0, Math.min(rect.height, event.clientY - rect.top)),
            });
          }
        }}
        onMouseUp={() => {
          if (!annotationEnabled || !drawingRef.current) {
            return;
          }
          drawingRef.current = false;
          setDraftStroke((previous) => {
            if (!previous || previous.length < 2) {
              return null;
            }
            const stroke: AnnotationStroke = {
              id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              points: previous,
            };
            setAnnotationStrokes((items) => [...items, stroke]);
            return null;
          });
        }}
        onMouseLeave={() => {
          drawingRef.current = false;
          if (!annotationEnabled) {
            setLensActive(false);
            return;
          }
          setDraftStroke((previous) => {
            if (!previous || previous.length < 2) {
              return null;
            }
            const stroke: AnnotationStroke = {
              id: `stroke-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
              points: previous,
            };
            setAnnotationStrokes((items) => [...items, stroke]);
            return null;
          });
        }}
        onClick={(event) => {
          if (annotationEnabled) {
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
          }}
        />
        <svg className="pointer-events-none absolute inset-0 z-10 h-full w-full" viewBox="0 0 1000 1000" preserveAspectRatio="none">
          {annotationStrokes.map((stroke) => (
            <polyline
              key={stroke.id}
              points={stroke.points.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="rgba(250, 204, 21, 0.58)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
          {draftStroke && draftStroke.length > 1 ? (
            <polyline
              points={draftStroke.map((point) => `${point.x},${point.y}`).join(" ")}
              fill="none"
              stroke="rgba(250, 204, 21, 0.62)"
              strokeWidth="16"
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ) : null}
        </svg>
        {!annotationEnabled && lensActive && (
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
});

FilePreviewPane.displayName = "FilePreviewPane";
