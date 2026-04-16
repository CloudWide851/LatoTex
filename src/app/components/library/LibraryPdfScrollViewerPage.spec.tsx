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

  it("toggles the lens on double-click but ignores drag-style motion so reading interactions are not hijacked", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToggleLens = vi.fn();
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
          lensEnabled
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
          onToggleLens={onToggleLens}
          onMoveLens={() => undefined}
          onHideLens={() => undefined}
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
      pageNode?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 120, clientY: 160 }));
      pageNode?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, clientX: 150, clientY: 190 }));
      pageNode?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 150, clientY: 190 }));
    });
    expect(onToggleLens).not.toHaveBeenCalled();

    await act(async () => {
      pageNode?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 120, clientY: 160 }));
      pageNode?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 120, clientY: 160 }));
    });
    expect(onToggleLens).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("does not toggle the lens when the double-click comes from the annotation layer", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToggleLens = vi.fn();
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
          lensEnabled
          lensActive={false}
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
          onToggleLens={onToggleLens}
          onMoveLens={() => undefined}
          onHideLens={() => undefined}
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
      annotationLayer?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 120, clientY: 160 }));
      annotationLayer?.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, clientX: 120, clientY: 160 }));
    });

    expect(onToggleLens).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("forwards mouse-wheel scrolling to the shared pdf viewport", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onToggleLens = vi.fn();
    let scrollTop = 0;
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
        get scrollTop() {
          return scrollTop;
        },
        set scrollTop(value: number) {
          scrollTop = value;
        },
        scrollLeft: 0,
      },
    };

    await act(async () => {
      root.render(
        <LibraryPdfScrollViewerPage
          page={1}
          frameWidth={400}
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
          onToggleLens={onToggleLens}
          onMoveLens={() => undefined}
          onHideLens={() => undefined}
          onRenderSuccess={() => undefined}
          onStrokesChange={() => undefined}
          onTextBoxesChange={() => undefined}
          t={(key) => String(key)}
        />,
      );
    });

    const pageNode = container.querySelector("[data-page='1']") as HTMLDivElement | null;
    expect(pageNode).not.toBeNull();

    await act(async () => {
      pageNode?.dispatchEvent(new WheelEvent("wheel", { bubbles: true, deltaY: 180 }));
    });

    expect(scrollTop).toBe(180);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
