import { useMemo } from "react";
import { MarkdownPreviewPane } from "./markdown/MarkdownPreviewPane";
import { WorkspacePdfViewport } from "./pdf/WorkspacePdfViewport";
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

export function FilePreviewPane(props: {
  mode: "pdf" | "image" | "markdown" | "svg" | "empty";
  pdfUrl: string | null;
  imageUrl: string | null;
  activeProjectId?: string | null;
  markdownContent: string;
  svgContent: string;
  selectedPath: string | null;
  title: string;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
  pdfFallbackProjectId?: string | null;
  pdfFallbackRelativePath?: string | null;
  focusRequest?: { page: number; token: number } | null;
  t: (key: any) => string;
}) {
  const {
    mode,
    pdfUrl,
    imageUrl,
    activeProjectId,
    markdownContent,
    svgContent,
    selectedPath,
    title,
    emptyText,
    pdfZoom,
    onPdfZoomChange,
    pdfFallbackProjectId,
    pdfFallbackRelativePath,
    focusRequest,
    t,
  } = props;

  const sanitizedMarkdown = useMemo(
    () => normalizeHtmlToMarkdown(sanitizePreviewText(markdownContent ?? "")),
    [markdownContent],
  );
  const sanitizedSvg = useMemo(() => sanitizeSvgForPreview(svgContent ?? ""), [svgContent]);
  const svgDoc = useMemo(() => buildSvgPreviewDocument(sanitizedSvg), [sanitizedSvg]);

  if (mode === "pdf") {
    return (
      <WorkspacePdfViewport
        pdfUrl={pdfUrl}
        emptyText={emptyText}
        pdfZoom={pdfZoom}
        onPdfZoomChange={onPdfZoomChange}
        pdfFallbackProjectId={pdfFallbackProjectId}
        pdfFallbackRelativePath={pdfFallbackRelativePath}
        focusRequest={focusRequest}
        t={t}
      />
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
        <MarkdownPreviewPane
          activeProjectId={activeProjectId ?? null}
          selectedPath={selectedPath}
          markdown={sanitizedMarkdown}
          emptyText={emptyText}
          t={t}
        />
      </div>
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

