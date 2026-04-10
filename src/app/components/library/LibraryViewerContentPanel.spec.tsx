// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryViewerContentPanel } from "./LibraryViewerContentPanel";

vi.mock("./LibraryPdfScrollViewer", () => ({
  LibraryPdfScrollViewer: (props: {
    zoom: number;
    syncId?: string;
    pdfUrl: string;
  }) => (
    <div
      data-testid={`viewer-${props.syncId ?? "viewer"}`}
      data-zoom={String(props.zoom)}
      data-pdf-url={props.pdfUrl}
    />
  ),
}));

vi.mock("./LibraryCitationMetaPanel", () => ({
  LibraryCitationMetaPanel: () => null,
}));

describe("LibraryViewerContentPanel", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps compare pane zoom controls independent for source and translated pdfs", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LibraryViewerContentPanel
          viewMode="compare"
          loading={false}
          loadError={null}
          pdfPreviewLoading={false}
          pdfObjectUrlLoading={false}
          pdfPreviewError={null}
          pdfDownloadedBytes={null}
          pdfTotalBytes={null}
          hasPdf
          pdfUrl="blob:source-pdf"
          annotationMode="select"
          setAnnotationMode={() => undefined}
          highlightColor="#fde047"
          setHighlightColor={() => undefined}
          highlightWidth={16}
          setHighlightWidth={() => undefined}
          highlightOpacity={0.65}
          setHighlightOpacity={() => undefined}
          textColor="#111827"
          setTextColor={() => undefined}
          textBoxStylePreset="minimal"
          setTextBoxStylePreset={() => undefined}
          pageStrokeCount={0}
          pageTextBoxCount={0}
          handleUndoCurrentPage={() => undefined}
          handleClearCurrentPage={() => undefined}
          pageInput="1"
          setPageInput={() => undefined}
          currentPage={1}
          jumpToPage={() => undefined}
          pdfZoom={1}
          setPdfZoom={() => undefined}
          toolConfigSignal={0}
          setToolConfigSignal={() => undefined}
          viewerRef={{ current: null }}
          pageCount={4}
          setPageCount={() => undefined}
          annotationStrokes={[]}
          annotationTextBoxes={[]}
          setAnnotationStrokes={() => undefined}
          setAnnotationTextBoxes={() => undefined}
          setCurrentPage={() => undefined}
          translationDetail={null}
          translationBusy={false}
          translationNotice={{ type: "info", message: "ready" }}
          selectedPath="library/demo.bib"
          runTranslation={() => undefined}
          hasComparePair
          translatedPdfUrl="blob:translated-pdf"
          bibPreview=""
          citation={null}
          paperPreview={null}
          paperPreviewLoading={false}
          paperPreviewError={null}
          onAnalyzePaper={null}
          linkError={null}
          t={(key) => String(key)}
        />,
      );
    });

    const sourceViewer = () => container.querySelector("[data-testid='viewer-source']");
    const translatedViewer = () => container.querySelector("[data-testid='viewer-translated']");
    const sourceZoomIn = container.querySelector(
      "button[aria-label='library.viewer.compareOriginal · preview.zoomIn']",
    );
    const translatedZoomOut = container.querySelector(
      "button[aria-label='library.viewer.compareTranslated · preview.zoomOut']",
    );

    expect(sourceViewer()?.getAttribute("data-zoom")).toBe("1");
    expect(translatedViewer()?.getAttribute("data-zoom")).toBe("1");

    await act(async () => {
      sourceZoomIn?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sourceViewer()?.getAttribute("data-zoom")).toBe("1.1");
    expect(translatedViewer()?.getAttribute("data-zoom")).toBe("1");

    await act(async () => {
      translatedZoomOut?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(sourceViewer()?.getAttribute("data-zoom")).toBe("1.1");
    expect(translatedViewer()?.getAttribute("data-zoom")).toBe("0.9");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
