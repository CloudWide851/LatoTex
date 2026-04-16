// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { forwardRef, useImperativeHandle } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { WorkspacePdfViewport } from "./WorkspacePdfViewport";

const mocks = vi.hoisted(() => ({
  tryFallbackToBlob: vi.fn(),
  scrollToPage: vi.fn(),
}));

vi.mock("./useWorkspacePdfSource", () => ({
  useWorkspacePdfSource: vi.fn(() => ({
    effectivePdfUrl: "blob:workspace-preview-pdf",
    tryFallbackToBlob: mocks.tryFallbackToBlob,
    usingBlobFallback: false,
  })),
}));

vi.mock("../library/LibraryPdfScrollViewer", () => ({
  LibraryPdfScrollViewer: forwardRef(function MockLibraryPdfScrollViewer(props: any, ref) {
    useImperativeHandle(ref, () => ({
      scrollToPage: mocks.scrollToPage,
    }), []);
    return (
      <button
        type="button"
        data-testid="workspace-pdf-scroll-viewer"
        data-pdf-url={props.pdfUrl}
        data-read-only={String(Boolean(props.readOnly))}
        onClick={() => props.onDocumentLoadError?.("pdf_load_failed")}
      >
        viewer
      </button>
    );
  }),
}));

describe("WorkspacePdfViewport", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.tryFallbackToBlob.mockReset();
    mocks.tryFallbackToBlob.mockResolvedValue(true);
    mocks.scrollToPage.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("reuses the library continuous pdf viewer and falls back to blob loading on document errors", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <WorkspacePdfViewport
          pdfUrl="http://latotex-resource.localhost/workspace-file/demo.pdf"
          emptyText="empty"
          pdfZoom={1}
          onPdfZoomChange={() => undefined}
          pdfFallbackProjectId="project-1"
          pdfFallbackRelativePath="papers/demo.pdf"
          focusRequest={null}
          t={(key) => String(key)}
        />,
      );
    });

    const viewer = container.querySelector("[data-testid='workspace-pdf-scroll-viewer']");
    expect(viewer?.getAttribute("data-pdf-url")).toBe("blob:workspace-preview-pdf");
    expect(viewer?.getAttribute("data-read-only")).toBe("true");

    await act(async () => {
      viewer?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await Promise.resolve();
    });

    expect(mocks.tryFallbackToBlob).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.render(
        <WorkspacePdfViewport
          pdfUrl="http://latotex-resource.localhost/workspace-file/demo.pdf"
          emptyText="empty"
          pdfZoom={1}
          onPdfZoomChange={() => undefined}
          pdfFallbackProjectId="project-1"
          pdfFallbackRelativePath="papers/demo.pdf"
          focusRequest={{ page: 4, token: 1 }}
          t={(key) => String(key)}
        />,
      );
    });

    expect(mocks.scrollToPage).toHaveBeenCalledWith(4);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
