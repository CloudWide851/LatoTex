import { useMemo, useRef, useState } from "react";

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
}) {
  const { mode, pdfUrl, markdownContent, title, emptyText, pdfZoom, onPdfZoomChange } = props;
  const viewportRef = useRef<HTMLDivElement | null>(null);
  const [lensActive, setLensActive] = useState(false);
  const [lensPoint, setLensPoint] = useState({ x: 0, y: 0 });
  const lensSize = 220;
  const lensScale = 1.85;
  const markdownBlocks = useMemo(
    () => (mode === "markdown" ? parseMarkdownBlocks(markdownContent) : []),
    [markdownContent, mode],
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
            className="pointer-events-none absolute z-20 overflow-hidden rounded-full border-2 border-slate-200 shadow-[0_8px_24px_rgba(15,23,42,0.22)]"
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
          </div>
        )}
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
