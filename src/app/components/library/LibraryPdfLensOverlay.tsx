import type { MutableRefObject } from "react";
import { Document, Page } from "react-pdf";
import type { WorkspacePreviewBinarySource } from "../../../shared/utils/workspacePreviewBlob";

type LibraryPdfLensOverlayProps = {
  active: boolean;
  visible: boolean;
  pdfUrl: string;
  pdfSource?: WorkspacePreviewBinarySource | null;
  lensPage: number;
  lensPageWidth: number;
  documentPages: number;
  lensSize: number;
  lensViewportRef: MutableRefObject<HTMLDivElement | null>;
  lensContentRef: MutableRefObject<HTMLDivElement | null>;
};

export function LibraryPdfLensOverlay(props: LibraryPdfLensOverlayProps) {
  const {
    active,
    visible,
    pdfUrl,
    pdfSource,
    lensPage,
    lensPageWidth,
    documentPages,
    lensSize,
    lensViewportRef,
    lensContentRef,
  } = props;

  if (!active) {
    return null;
  }

  return (
    <div
      ref={(node) => {
        lensViewportRef.current = node;
      }}
      className={`pointer-events-none absolute z-30 overflow-hidden rounded-full border border-slate-200/80 bg-white/20 shadow-[0_18px_36px_rgba(15,23,42,0.28)] backdrop-blur-[1px] transition-opacity duration-75 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
      style={{
        width: `${lensSize}px`,
        height: `${lensSize}px`,
        left: "0px",
        top: "0px",
        transform: "translate3d(-9999px, -9999px, 0)",
        willChange: "transform",
      }}
    >
      <div
        ref={(node) => {
          lensContentRef.current = node;
        }}
        className="absolute left-0 top-0"
        style={{
          width: `${lensPageWidth}px`,
          willChange: "transform",
          transform: "translate3d(0, 0, 0)",
        }}
      >
        <Document key={`lens-${pdfUrl}`} file={pdfSource?.documentData ?? pdfUrl} loading={null} error={null}>
          <Page
            pageNumber={Math.max(1, Math.min(documentPages, lensPage))}
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
  );
}
