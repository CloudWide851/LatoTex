// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LibraryPdfScrollViewerPage } from "./LibraryPdfScrollViewerPage";

vi.mock("react-pdf", () => ({
  Page: (props: { pageNumber: number }) => <div data-testid={`pdf-page-${props.pageNumber}`} />,
}));

vi.mock("./PdfAnnotationLayer", () => ({
  PdfAnnotationLayer: () => <div data-testid="annotation-layer" data-annotation-layer="true" />,
}));

describe("LibraryPdfScrollViewerPage", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("moves the lens only when the magnifier is already active", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onMoveLens = vi.fn();
    const pageRefs = { current: {} as Record<number, HTMLDivElement | null> };
    const scrollRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 420,
          bottom: 620,
          width: 420,
          height: 620,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
        scrollLeft: 0,
        scrollTop: 0,
      },
    };

    await act(async () => {
      root.render(
        <LibraryPdfScrollViewerPage
          page={1}
          frameWidth={400}
          annotationScale={0.5}
          lensEnabled
          lensActive
          readOnly
          mode="select"
          highlightColor="#fde047"
          highlightWidth={16}
          highlightOpacity={0.65}
          textColor="#111827"
          textBoxStylePreset="minimal"
          strokes={[]}
          textBoxes={[]}
          pageRefs={pageRefs}
          scrollRef={scrollRef as any}
          pendingLensPointRef={{ current: { visible: false, viewportX: 0, viewportY: 0, pageX: 0, pageY: 0, pageNumber: 1 } }}
          onMoveLens={onMoveLens}
          onHideLens={() => undefined}
          onLayoutChange={() => undefined}
          onRenderSuccess={() => undefined}
          onStrokesChange={() => undefined}
          onTextBoxesChange={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const pageNode = container.querySelector("[data-page='1']") as HTMLDivElement | null;
    expect(pageNode).not.toBeNull();
    pageNode!.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 580,
      width: 400,
      height: 580,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      pageNode?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, clientX: 150, clientY: 190 }));
    });
    expect(onMoveLens).toHaveBeenCalledTimes(1);
    expect(onMoveLens).toHaveBeenCalledWith(expect.objectContaining({
      visible: true,
      pageNumber: 1,
    }));

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("ignores annotation-layer hover targets while the magnifier is active", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onMoveLens = vi.fn();
    const pageRefs = { current: {} as Record<number, HTMLDivElement | null> };
    const scrollRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 420,
          bottom: 620,
          width: 420,
          height: 620,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
        scrollLeft: 0,
        scrollTop: 0,
      },
    };

    await act(async () => {
      root.render(
        <LibraryPdfScrollViewerPage
          page={1}
          frameWidth={400}
          annotationScale={0.5}
          lensEnabled
          lensActive
          readOnly={false}
          mode="select"
          highlightColor="#fde047"
          highlightWidth={16}
          highlightOpacity={0.65}
          textColor="#111827"
          textBoxStylePreset="minimal"
          strokes={[]}
          textBoxes={[]}
          pageRefs={pageRefs}
          scrollRef={scrollRef as any}
          pendingLensPointRef={{ current: { visible: false, viewportX: 0, viewportY: 0, pageX: 0, pageY: 0, pageNumber: 1 } }}
          onMoveLens={onMoveLens}
          onHideLens={() => undefined}
          onLayoutChange={() => undefined}
          onRenderSuccess={() => undefined}
          onStrokesChange={() => undefined}
          onTextBoxesChange={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const pageNode = container.querySelector("[data-page='1']") as HTMLDivElement | null;
    const annotationLayer = container.querySelector("[data-testid='annotation-layer']") as HTMLDivElement | null;
    expect(pageNode).not.toBeNull();
    expect(annotationLayer).not.toBeNull();
    pageNode!.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 400,
      bottom: 580,
      width: 400,
      height: 580,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      annotationLayer?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, clientX: 120, clientY: 160 }));
    });

    expect(onMoveLens).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("drops the old page-card shell so scrolling is owned by the viewer root instead of a nested page frame", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const pageRefs = { current: {} as Record<number, HTMLDivElement | null> };
    const scrollRef = {
      current: {
        getBoundingClientRect: () => ({
          left: 0,
          top: 0,
          right: 420,
          bottom: 620,
          width: 420,
          height: 620,
          x: 0,
          y: 0,
          toJSON: () => ({}),
        }),
        scrollTop: 0,
        scrollLeft: 0,
      },
    };

    await act(async () => {
      root.render(
        <LibraryPdfScrollViewerPage
          page={1}
          frameWidth={400}
          annotationScale={0.5}
          lensEnabled={false}
          lensActive={false}
          readOnly
          mode="select"
          highlightColor="#fde047"
          highlightWidth={16}
          highlightOpacity={0.65}
          textColor="#111827"
          textBoxStylePreset="minimal"
          strokes={[]}
          textBoxes={[]}
          pageRefs={pageRefs}
          scrollRef={scrollRef as any}
          pendingLensPointRef={{ current: { visible: false, viewportX: 0, viewportY: 0, pageX: 0, pageY: 0, pageNumber: 1 } }}
          onMoveLens={() => undefined}
          onHideLens={() => undefined}
          onLayoutChange={() => undefined}
          onRenderSuccess={() => undefined}
          onStrokesChange={() => undefined}
          onTextBoxesChange={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const pageNode = container.querySelector("[data-page='1']") as HTMLDivElement | null;
    expect(pageNode).not.toBeNull();
    expect(pageNode?.className).not.toContain("overflow-hidden");
    expect(pageNode?.className).not.toContain("shadow-sm");
    expect(pageNode?.className).not.toContain("border");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
