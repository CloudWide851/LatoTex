// @vitest-environment jsdom

import { act, useState, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPdfScrollViewer } from "./LibraryPdfScrollViewer";
import type { WorkspacePreviewBinarySource } from "../../../shared/utils/workspacePreviewBlob";

const pdfMocks = vi.hoisted(() => ({
  documentFiles: [] as unknown[],
  throwOnDocument: false,
}));

vi.mock("../pdf/reactPdfSetup", () => ({
  ensureReactPdfWorker: () => undefined,
}));

vi.mock("react-pdf", () => ({
  Document: (props: { file?: unknown; children: ReactNode }) => {
    pdfMocks.documentFiles.push(props.file);
    if (pdfMocks.throwOnDocument) {
      throw new Error("Cannot read properties of null (reading 'sendWithPromise')");
    }
    return <div data-testid="pdf-document">{props.children}</div>;
  },
}));

vi.mock("./LibraryPdfLensOverlay", () => ({
  LibraryPdfLensOverlay: () => null,
}));

vi.mock("./LibraryPdfScrollViewerPage", () => ({
  LibraryPdfScrollViewerPage: () => <div data-testid="pdf-page" />,
}));

const stablePdfSourceBytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]);

function buildViewerProps() {
  return {
    pageCount: 1,
    zoom: 1,
    mode: "select" as const,
    highlightColor: "#fde047",
    highlightWidth: 16,
    highlightOpacity: 0.65,
    textColor: "#111827",
    textBoxStylePreset: "minimal" as const,
    strokes: [],
    textBoxes: [],
    onStrokesChange: () => undefined,
    onTextBoxesChange: () => undefined,
    onVisiblePageChange: () => undefined,
    onPageCountChange: () => undefined,
    t: (key: any) => String(key),
  };
}

function UnstablePdfSourceViewer() {
  const [renderTick, setRenderTick] = useState(0);
  const pdfSource: WorkspacePreviewBinarySource = {
    relativePath: ".latotex/papers/source.pdf",
    objectUrl: "blob:paper",
    bytes: stablePdfSourceBytes,
  };

  return (
    <div
      data-testid="pdf-source-rerender-host"
      data-render-tick={renderTick}
      onClick={() => setRenderTick((current) => current + 1)}
    >
      <LibraryPdfScrollViewer
        {...buildViewerProps()}
        pdfUrl="blob:paper"
        pdfSource={pdfSource}
      />
    </div>
  );
}

describe("LibraryPdfDocumentSurface", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const preventExpectedWindowError = (event: ErrorEvent) => {
    if (String(event.message).includes("sendWithPromise")) {
      event.preventDefault();
    }
  };

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
    window.addEventListener("error", preventExpectedWindowError);
    pdfMocks.documentFiles.length = 0;
    pdfMocks.throwOnDocument = false;
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    window.removeEventListener("error", preventExpectedWindowError);
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("keeps the cloned PDF document payload stable across parent rerenders", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<UnstablePdfSourceViewer />);
    });

    const firstFile = pdfMocks.documentFiles[0];
    expect(firstFile).toMatchObject({ data: expect.any(Uint8Array) });

    await act(async () => {
      container.querySelector("[data-testid='pdf-source-rerender-host']")
        ?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(pdfMocks.documentFiles[pdfMocks.documentFiles.length - 1]).toBe(firstFile);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("contains react-pdf render crashes inside the PDF viewer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onDocumentLoadError = vi.fn();
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    pdfMocks.throwOnDocument = true;

    await act(async () => {
      root.render(
        <LibraryPdfScrollViewer
          {...buildViewerProps()}
          pdfUrl="blob:broken-render"
          onDocumentLoadError={onDocumentLoadError}
        />,
      );
    });

    expect(onDocumentLoadError).toHaveBeenCalledWith(
      "Error: Cannot read properties of null (reading 'sendWithPromise')",
    );
    expect(container.textContent).toContain("library.viewer.error");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
