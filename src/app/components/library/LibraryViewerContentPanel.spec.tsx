// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryViewerContentPanel } from "./LibraryViewerContentPanel";

vi.mock("./LibraryPdfScrollViewer", () => ({
  LibraryPdfScrollViewer: (props: {
    zoom: number;
    syncId?: string;
    pdfUrl: string;
    strokes?: Array<unknown>;
    textBoxes?: Array<unknown>;
  }) => (
    <div
      data-testid={`viewer-${props.syncId ?? "viewer"}`}
      data-zoom={String(props.zoom)}
      data-pdf-url={props.pdfUrl}
      data-strokes={String(props.strokes?.length ?? 0)}
      data-text-boxes={String(props.textBoxes?.length ?? 0)}
    />
  ),
}));

vi.mock("./LibraryCitationMetaPanel", () => ({
  LibraryCitationMetaPanel: () => null,
}));

function CompareHarness() {
  const [sourceZoom, setSourceZoom] = useState(1);
  const [translatedZoom, setTranslatedZoom] = useState(1);

  return (
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
      compareSourceZoom={sourceZoom}
      setCompareSourceZoom={setSourceZoom}
      compareTranslatedZoom={translatedZoom}
      setCompareTranslatedZoom={setTranslatedZoom}
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
      pdfScrollRatio={0}
      setPdfScrollRatio={() => undefined}
      compareSourceScrollRatio={0}
      setCompareSourceScrollRatio={() => undefined}
      compareTranslatedScrollRatio={0}
      setCompareTranslatedScrollRatio={() => undefined}
      bibScrollRatio={0}
      setBibScrollRatio={() => undefined}
      metaScrollRatio={0}
      setMetaScrollRatio={() => undefined}
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
    />
  );
}

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
      root.render(<CompareHarness />);
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

  it("shows source annotations in compare mode without copying them to the translated pane", async () => {
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
          pageStrokeCount={1}
          pageTextBoxCount={1}
          handleUndoCurrentPage={() => undefined}
          handleClearCurrentPage={() => undefined}
          pageInput="1"
          setPageInput={() => undefined}
          currentPage={1}
          jumpToPage={() => undefined}
          pdfZoom={1}
          setPdfZoom={() => undefined}
          compareSourceZoom={1}
          setCompareSourceZoom={() => undefined}
          compareTranslatedZoom={1}
          setCompareTranslatedZoom={() => undefined}
          toolConfigSignal={0}
          setToolConfigSignal={() => undefined}
          viewerRef={{ current: null }}
          pageCount={4}
          setPageCount={() => undefined}
          annotationStrokes={[{ id: "stroke-1", page: 1, points: [], style: null } as any]}
          annotationTextBoxes={[{ id: "textbox-1", page: 1, z: 1, x: 0, y: 0, w: 120, h: 60, content: "note", html: "<p>note</p>", style: {} } as any]}
          setAnnotationStrokes={() => undefined}
          setAnnotationTextBoxes={() => undefined}
          setCurrentPage={() => undefined}
          pdfScrollRatio={0}
          setPdfScrollRatio={() => undefined}
          compareSourceScrollRatio={0}
          setCompareSourceScrollRatio={() => undefined}
          compareTranslatedScrollRatio={0}
          setCompareTranslatedScrollRatio={() => undefined}
          bibScrollRatio={0}
          setBibScrollRatio={() => undefined}
          metaScrollRatio={0}
          setMetaScrollRatio={() => undefined}
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

    expect(container.querySelector("[data-testid='viewer-source']")?.getAttribute("data-strokes")).toBe("1");
    expect(container.querySelector("[data-testid='viewer-source']")?.getAttribute("data-text-boxes")).toBe("1");
    expect(container.querySelector("[data-testid='viewer-translated']")?.getAttribute("data-strokes")).toBe("0");
    expect(container.querySelector("[data-testid='viewer-translated']")?.getAttribute("data-text-boxes")).toBe("0");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
