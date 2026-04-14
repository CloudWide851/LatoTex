// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";

vi.mock("./PdfTextBoxContextMenu", () => ({
  PdfTextBoxContextMenu: () => null,
}));

function Harness() {
  const [strokes, setStrokes] = useState<any[]>([]);
  const [textBoxes, setTextBoxes] = useState<any[]>([]);
  return (
    <div className="relative h-[480px] w-[360px]">
      <PdfAnnotationLayer
        page={1}
        mode="textbox"
        highlightColor="#fde047"
        highlightWidth={16}
        highlightOpacity={0.65}
        textColor="#111827"
        textBoxStylePreset="minimal"
        strokes={strokes}
        textBoxes={textBoxes}
        onStrokesChange={setStrokes}
        onTextBoxesChange={setTextBoxes}
        t={(key) => String(key)}
      />
    </div>
  );
}

describe("PdfAnnotationLayer", () => {
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

  it("keeps a newly created transparent textbox alive through the first empty blur so editing can continue", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<Harness />);
    });

    const layer = container.querySelector(".absolute.inset-0.z-20") as HTMLDivElement | null;
    expect(layer).not.toBeNull();
    layer!.getBoundingClientRect = () => ({
      left: 0,
      top: 0,
      right: 360,
      bottom: 480,
      width: 360,
      height: 480,
      x: 0,
      y: 0,
      toJSON: () => ({}),
    });

    await act(async () => {
      layer?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 120,
        clientY: 160,
      }));
    });

    const editor = () => container.querySelector("[contenteditable='true']") as HTMLDivElement | null;
    expect(editor()).not.toBeNull();

    await act(async () => {
      editor()?.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      await Promise.resolve();
    });

    expect(editor()).not.toBeNull();

    await act(async () => {
      if (editor()) {
        editor()!.innerHTML = "<p>Transparent note</p>";
        editor()!.dispatchEvent(new FocusEvent("blur", { bubbles: true }));
      }
      await Promise.resolve();
    });

    expect(container.querySelector("[contenteditable='true']")).not.toBeNull();
    expect(container.textContent).toContain("Transparent note");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
