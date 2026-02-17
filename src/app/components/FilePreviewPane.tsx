import { useMemo } from "react";

type MarkdownBlock =
  | { kind: "heading"; level: number; text: string }
  | { kind: "bullet"; text: string }
  | { kind: "paragraph"; text: string }
  | { kind: "divider" };

function parseMarkdownBlocks(input: string): MarkdownBlock[] {
  const lines = input.replace(/\r\n/g, "\n").split("\n");
  const blocks: MarkdownBlock[] = [];

  for (const line of lines) {
    const heading = line.match(/^(#{1,6})\s+(.+)$/);
    if (heading) {
      blocks.push({
        kind: "heading",
        level: heading[1].length,
        text: heading[2].trim(),
      });
      continue;
    }
    if (/^\s*[-*+]\s+/.test(line)) {
      blocks.push({
        kind: "bullet",
        text: line.replace(/^\s*[-*+]\s+/, "").trim(),
      });
      continue;
    }
    if (/^\s*---+\s*$/.test(line)) {
      blocks.push({ kind: "divider" });
      continue;
    }
    if (line.trim().length > 0) {
      blocks.push({ kind: "paragraph", text: line.trim() });
    }
  }

  return blocks;
}

export function FilePreviewPane(props: {
  mode: "pdf" | "markdown" | "empty";
  pdfUrl: string | null;
  markdownContent: string;
  title: string;
  emptyText: string;
  pdfZoom: number;
  onPdfZoomChange: (nextZoom: number) => void;
  onPdfClickZoomIn: () => void;
}) {
  const { mode, pdfUrl, markdownContent, title, emptyText, pdfZoom, onPdfZoomChange, onPdfClickZoomIn } = props;
  const markdownBlocks = useMemo(
    () => (mode === "markdown" ? parseMarkdownBlocks(markdownContent) : []),
    [markdownContent, mode],
  );
  if (mode === "pdf" && pdfUrl) {
    return (
      <div
        className="h-full overflow-auto rounded-lg border border-slate-200 bg-slate-50 cursor-zoom-in"
        onWheel={(event) => {
          if (!event.ctrlKey) {
            return;
          }
          event.preventDefault();
          const step = event.deltaY < 0 ? 0.1 : -0.1;
          const nextZoom = Math.max(0.5, Math.min(3, Number((pdfZoom + step).toFixed(2))));
          onPdfZoomChange(nextZoom);
        }}
        onClick={onPdfClickZoomIn}
      >
        <iframe
          title={title}
          src={pdfUrl}
          className="rounded-lg border-0"
          style={{
            width: "100%",
            height: "100%",
            minHeight: "100%",
            transform: `scale(${pdfZoom})`,
            transformOrigin: "top left",
            pointerEvents: "none",
          }}
        />
      </div>
    );
  }

  if (mode === "markdown") {
    return (
      <div className="h-full overflow-auto rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
        <div className="space-y-2">
          {markdownBlocks.length === 0 ? (
            <p className="text-xs text-slate-500">{emptyText}</p>
          ) : (
            markdownBlocks.map((block, index) => {
              if (block.kind === "divider") {
                return <hr key={`divider-${index}`} className="border-slate-300" />;
              }
              if (block.kind === "bullet") {
                return (
                  <p key={`bullet-${index}`} className="pl-3 text-sm leading-6 text-slate-700">
                    {"\u2022"} {block.text}
                  </p>
                );
              }
              if (block.kind === "heading") {
                const size =
                  block.level <= 1
                    ? "text-lg"
                    : block.level === 2
                      ? "text-base"
                      : "text-sm";
                return (
                  <h3 key={`heading-${index}`} className={`${size} font-semibold text-slate-800`}>
                    {block.text}
                  </h3>
                );
              }
              return (
                <p key={`paragraph-${index}`} className="text-sm leading-6 text-slate-700">
                  {block.text}
                </p>
              );
            })
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-slate-300 bg-slate-50 text-xs text-slate-500">
      {emptyText}
    </div>
  );
}
