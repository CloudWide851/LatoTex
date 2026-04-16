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
      <pre data-testid="textbox-state">{JSON.stringify(textBoxes)}</pre>
    </div>
  );
}

function ResizeHarness() {
  const [strokes, setStrokes] = useState<any[]>([]);
  const [textBoxes, setTextBoxes] = useState<any[]>([
    {
      id: "textbox-1",
      page: 1,
      x: 180,
      y: 220,
      w: 220,
      h: 112,
      z: 1,
      content: "Resize me",
      html: "<p>Resize me</p>",
      style: {
        fontSize: 14,
        fontFamily: "Segoe UI",
        textColor: "#111827",
        textAlign: "left",
        fontWeight: "normal",
        fontStyle: "normal",
        textDecoration: "none",
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderWidth: 0,
      },
    },
  ]);
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
      <pre data-testid="textbox-state">{JSON.stringify(textBoxes)}</pre>
    </div>
  );
}

function MoveHarness() {
  const [strokes, setStrokes] = useState<any[]>([]);
  const [textBoxes, setTextBoxes] = useState<any[]>([
    {
      id: "textbox-1",
      page: 1,
      x: 180,
      y: 220,
      w: 220,
      h: 112,
      z: 1,
      content: "Move me",
      html: "<p>Move me</p>",
      style: {
        fontSize: 14,
        fontFamily: "Segoe UI",
        textColor: "#111827",
        textAlign: "left",
        fontWeight: "normal",
        fontStyle: "normal",
        textDecoration: "none",
        backgroundColor: "transparent",
        borderColor: "transparent",
        borderWidth: 0,
      },
    },
  ]);
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
      <pre data-testid="textbox-state">{JSON.stringify(textBoxes)}</pre>
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

  it("shows an explicit resize handle and resizes the selected textbox in textbox mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<ResizeHarness />);
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

    const box = container.querySelector("[data-annotation-box='true']") as HTMLDivElement | null;
    expect(box).not.toBeNull();

    await act(async () => {
      box?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      await Promise.resolve();
    });

    await act(async () => {
      box?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
    });

    const resizeHandle = container.querySelector("[data-textbox-resize-handle='true']") as HTMLButtonElement | null;
    expect(resizeHandle).not.toBeNull();

    const readState = () => JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");
    const before = readState()[0];
    expect(before?.w).toBe(220);
    expect(before?.h).toBe(112);

    await act(async () => {
      resizeHandle?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 200,
        clientY: 220,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        button: 0,
        clientX: 248,
        clientY: 280,
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: 248,
        clientY: 280,
      }));
      await Promise.resolve();
    });

    const after = readState()[0];
    expect(after?.w).toBeGreaterThan(before.w);
    expect(after?.h).toBeGreaterThan(before.h);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps single-click selection static and only moves a textbox from the dedicated move handle", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<MoveHarness />);
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

    const box = container.querySelector("[data-annotation-box='true']") as HTMLDivElement | null;
    expect(box).not.toBeNull();

    const readState = () => JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");

    await act(async () => {
      box?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        button: 0,
        clientX: 240,
        clientY: 260,
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: 240,
        clientY: 260,
      }));
      await Promise.resolve();
    });

    const afterSelection = readState()[0];
    expect(afterSelection?.x).toBe(180);
    expect(afterSelection?.y).toBe(220);

    const moveHandle = container.querySelector("[data-textbox-move-handle='true']") as HTMLButtonElement | null;
    expect(moveHandle).not.toBeNull();

    await act(async () => {
      moveHandle?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        button: 0,
        clientX: 164,
        clientY: 184,
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: 164,
        clientY: 184,
      }));
      await Promise.resolve();
    });

    const afterThresholdMiss = readState()[0];
    expect(afterThresholdMiss?.x).toBe(afterSelection.x);
    expect(afterThresholdMiss?.y).toBe(afterSelection.y);

    await act(async () => {
      moveHandle?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      window.dispatchEvent(new MouseEvent("mousemove", {
        bubbles: true,
        button: 0,
        clientX: 220,
        clientY: 240,
      }));
      window.dispatchEvent(new MouseEvent("mouseup", {
        bubbles: true,
        button: 0,
        clientX: 220,
        clientY: 240,
      }));
      await Promise.resolve();
    });

    const afterMove = readState()[0];
    expect(afterMove?.x).toBeGreaterThan(afterThresholdMiss.x);
    expect(afterMove?.y).toBeGreaterThan(afterThresholdMiss.y);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
