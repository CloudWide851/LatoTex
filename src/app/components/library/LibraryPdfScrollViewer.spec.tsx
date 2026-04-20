// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPdfScrollViewer } from "./LibraryPdfScrollViewer";

vi.mock("../pdf/reactPdfSetup", () => ({
  ensureReactPdfWorker: () => undefined,
}));

vi.mock("react-pdf", () => ({
  Document: (props: { children: ReactNode; onLoadSuccess?: (payload: { numPages: number }) => void }) => (
    <div data-testid="pdf-document">
      <button
        type="button"
        data-testid="document-load-success"
        onClick={() => props.onLoadSuccess?.({ numPages: 3 })}
      >
        load-document
      </button>
      {props.children}
    </div>
  ),
}));

vi.mock("./LibraryPdfLensOverlay", () => ({
  LibraryPdfLensOverlay: () => null,
}));

vi.mock("./LibraryPdfScrollViewerPage", () => ({
  LibraryPdfScrollViewerPage: (props: {
    page: number;
    onRenderSuccess: () => void;
    onLayoutChange: () => void;
  }) => (
    <div>
      <button
        type="button"
        data-testid={`page-${props.page}`}
        onClick={props.onRenderSuccess}
      >
        page-{props.page}
      </button>
      <button
        type="button"
        data-testid={`page-layout-${props.page}`}
        onClick={props.onLayoutChange}
      >
        layout-{props.page}
      </button>
    </div>
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

  function ControlledViewer(props: {
    pageCount?: number;
    onPageCountChange?: (count: number) => void;
    onVisiblePageChange?: (page: number) => void;
  }) {
    const [scrollAnchor, setScrollAnchor] = useState<{ page: number; pageFocusRatio: number; absoluteRatio: number } | null>(null);
    const [scrollRatio, setScrollRatio] = useState(0);

    return (
      <LibraryPdfScrollViewer
        pdfUrl="blob:paper"
        pageCount={props.pageCount ?? 1}
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
        onVisiblePageChange={props.onVisiblePageChange ?? (() => undefined)}
        onPageCountChange={props.onPageCountChange ?? (() => undefined)}
        initialScrollAnchor={scrollAnchor}
        onScrollAnchorChange={setScrollAnchor}
        initialScrollRatio={scrollRatio}
        onScrollRatioChange={setScrollRatio}
        t={(key) => String(key)}
      />
    );
  }

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

    const annotationSurface = document.createElement("div");
    annotationSurface.setAttribute("data-annotation-layer", "true");
    scrollNode?.appendChild(annotationSurface);

    await act(async () => {
      annotationSurface.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 80 }));
    });

    expect(scrollTopValue).toBe(200);

    const editingSurface = document.createElement("div");
    editingSurface.setAttribute("data-textbox-editing", "true");
    editingSurface.contentEditable = "true";
    scrollNode?.appendChild(editingSurface);

    await act(async () => {
      editingSurface.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 60 }));
    });

    expect(scrollTopValue).toBe(200);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("recomputes the saved anchor when a rendered page changes size", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

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
            initialScrollAnchor={{ page: 2, pageFocusRatio: 0.5, absoluteRatio: 0.75 }}
            t={(key) => String(key)}
          />
        </div>,
      );
    });

    const scrollNode = container.querySelector(".library-scrollbar") as HTMLDivElement | null;
    expect(scrollNode).not.toBeNull();

    let scrollTopValue = 0;
    let scrollTopWrites = 0;
    Object.defineProperty(scrollNode!, "clientHeight", { configurable: true, value: 400 });
    Object.defineProperty(scrollNode!, "scrollHeight", { configurable: true, value: 1600 });
    Object.defineProperty(scrollNode!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
        scrollTopWrites += 1;
      },
    });

    const page2 = container.querySelector("[data-testid='page-2']");
    await act(async () => {
      page2?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    scrollTopWrites = 0;

    const page2Layout = container.querySelector("[data-testid='page-layout-2']");
    await act(async () => {
      page2Layout?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(scrollTopWrites).toBe(1);
    expect(scrollTopValue).toBeGreaterThanOrEqual(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not treat prop-echoed scroll state as a document reset", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onPageCountChange = vi.fn();
    const onVisiblePageChange = vi.fn();

    await act(async () => {
      root.render(
        <div className="h-[600px]">
          <ControlledViewer
            pageCount={1}
            onPageCountChange={onPageCountChange}
            onVisiblePageChange={onVisiblePageChange}
          />
        </div>,
      );
    });

    const scrollNode = container.querySelector(".library-scrollbar") as HTMLDivElement | null;
    const loadButton = container.querySelector("[data-testid='document-load-success']");
    expect(scrollNode).not.toBeNull();
    expect(loadButton).not.toBeNull();

    let scrollTopValue = 0;
    Object.defineProperty(scrollNode!, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollNode!, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(scrollNode!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });

    await act(async () => {
      loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    onPageCountChange.mockClear();
    onVisiblePageChange.mockClear();

    await act(async () => {
      scrollNode!.scrollTop = 400;
      scrollNode?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(onPageCountChange).not.toHaveBeenCalled();
    expect(onVisiblePageChange).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps continuously rendered pages after scroll state is echoed back from the parent", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <div className="h-[600px]">
          <ControlledViewer pageCount={1} />
        </div>,
      );
    });

    const scrollNode = container.querySelector(".library-scrollbar") as HTMLDivElement | null;
    const loadButton = container.querySelector("[data-testid='document-load-success']");
    expect(scrollNode).not.toBeNull();
    expect(loadButton).not.toBeNull();

    let scrollTopValue = 0;
    Object.defineProperty(scrollNode!, "clientHeight", { configurable: true, value: 200 });
    Object.defineProperty(scrollNode!, "scrollHeight", { configurable: true, value: 1200 });
    Object.defineProperty(scrollNode!, "scrollTop", {
      configurable: true,
      get: () => scrollTopValue,
      set: (value: number) => {
        scrollTopValue = value;
      },
    });

    await act(async () => {
      loadButton?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='page-2']")).not.toBeNull();
    expect(container.querySelector("[data-testid='page-3']")).not.toBeNull();

    await act(async () => {
      scrollNode!.scrollTop = 500;
      scrollNode?.dispatchEvent(new Event("scroll", { bubbles: true }));
    });

    expect(container.querySelector("[data-testid='page-1']")).not.toBeNull();
    expect(container.querySelector("[data-testid='page-2']")).not.toBeNull();
    expect(container.querySelector("[data-testid='page-3']")).not.toBeNull();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
