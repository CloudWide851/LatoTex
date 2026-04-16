// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPdfScrollViewer } from "./LibraryPdfScrollViewer";

vi.mock("../pdf/reactPdfSetup", () => ({
  ensureReactPdfWorker: () => undefined,
}));

vi.mock("react-pdf", () => ({
  Document: (props: { children: ReactNode }) => <div data-testid="pdf-document">{props.children}</div>,
}));

vi.mock("./LibraryPdfLensOverlay", () => ({
  LibraryPdfLensOverlay: () => null,
}));

vi.mock("./LibraryPdfScrollViewerPage", () => ({
  LibraryPdfScrollViewerPage: (props: { page: number; onRenderSuccess: () => void }) => (
    <button
      type="button"
      data-testid={`page-${props.page}`}
      onClick={props.onRenderSuccess}
    >
      page-{props.page}
    </button>
  ),
}));

describe("LibraryPdfScrollViewer", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("restores the saved scroll position only after the current document render completes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <div className="h-[600px]">
          <LibraryPdfScrollViewer
            pdfUrl="blob:paper"
            pageCount={3}
            zoom={1}
            mode="select"
            highlightColor="#fde047"
            highlightWidth={16}
            highlightOpacity={0.65}
            textColor="#111827"
            textBoxStylePreset="minimal"
            strokes={[]}
            textBoxes={[]}
            onStrokesChange={() => undefined}
            onTextBoxesChange={() => undefined}
            onVisiblePageChange={() => undefined}
            onPageCountChange={() => undefined}
            initialScrollRatio={0.5}
            t={(key) => String(key)}
          />
        </div>,
      );
    });

    const scrollNode = container.querySelector(".library-scrollbar") as HTMLDivElement | null;
    expect(scrollNode).not.toBeNull();

    let scrollTopValue = 0;
    let scrollTopWrites = 0;
    Object.defineProperty(scrollNode!, "clientHeight", { configurable: true, value: 1000 });
    Object.defineProperty(scrollNode!, "scrollHeight", { configurable: true, value: 3000 });
    Object.defineProperty(scrollNode!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollTopWrites += 1;
      },
    });

    const page1 = container.querySelector("[data-testid='page-1']");
    const page2 = container.querySelector("[data-testid='page-2']");
    const page3 = container.querySelector("[data-testid='page-3']");

    await act(async () => {
      page1?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      page2?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollTopWrites).toBe(0);

    await act(async () => {
      page3?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollTopWrites).toBe(1);
    expect(scrollTopValue).toBe(1000);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("routes plain wheel scrolling through the viewer root while reserving ctrl+wheel for zoom", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onZoomChange = vi.fn();

    await act(async () => {
      root.render(
        <div className="h-[600px]">
          <LibraryPdfScrollViewer
            pdfUrl="blob:paper"
            pageCount={2}
            zoom={1}
            mode="select"
            highlightColor="#fde047"
            highlightWidth={16}
            highlightOpacity={0.65}
            textColor="#111827"
            textBoxStylePreset="minimal"
            strokes={[]}
            textBoxes={[]}
            onStrokesChange={() => undefined}
            onTextBoxesChange={() => undefined}
            onVisiblePageChange={() => undefined}
            onPageCountChange={() => undefined}
            onZoomChange={onZoomChange}
            t={(key) => String(key)}
          />
        </div>,
      );
    });

    const scrollNode = container.querySelector(".library-scrollbar") as HTMLDivElement | null;
    expect(scrollNode).not.toBeNull();

    let scrollTopValue = 0;
    Object.defineProperty(scrollNode!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });

    await act(async () => {
      scrollNode?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 120 }));
    });

    expect(scrollTopValue).toBe(120);
    expect(onZoomChange).not.toHaveBeenCalled();

    await act(async () => {
      scrollNode?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, ctrlKey: true, deltaY: -120 }));
    });

    expect(onZoomChange).toHaveBeenCalledWith(1.1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
