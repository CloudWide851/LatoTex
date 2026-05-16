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

function StrokeHarness(props: { mode: "highlight" | "eraser" }) {
  const [strokes, setStrokes] = useState<any[]>(props.mode === "eraser"
    ? [{
      id: "stroke-1",
      page: 1,
      color: "#fde047",
      width: 16,
      opacity: 0.65,
      points: [{ x: 330, y: 330 }, { x: 360, y: 360 }],
    }]
    : []);
  const [textBoxes, setTextBoxes] = useState<any[]>([]);
  return (
    <div className="relative h-[480px] w-[360px]">
      <PdfAnnotationLayer
        page={1}
        mode={props.mode}
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
      <pre data-testid="stroke-state">{JSON.stringify(strokes)}</pre>
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

  it("commits a non-empty textbox before creating another one in textbox mode", async () => {
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

    const firstEditor = () => container.querySelector("[contenteditable='true']") as HTMLDivElement | null;
    expect(firstEditor()).not.toBeNull();

    await act(async () => {
      if (firstEditor()) {
        firstEditor()!.innerHTML = "<p>First textbox</p>";
      }
      layer?.dispatchEvent(new MouseEvent("mousedown", {
        bubbles: true,
        button: 0,
        clientX: 220,
        clientY: 260,
      }));
      await Promise.resolve();
    });

    const state = JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");
    expect(state).toHaveLength(2);
    expect(state[0]?.content).toContain("First textbox");

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
      resizeHandle?.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: 200,
        clientY: 220,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        pointerId: 1,
        clientX: 248,
        clientY: 280,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 1,
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

  it("moves a textbox by dragging the textbox body while preserving click threshold", async () => {
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
      box?.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 2,
        clientX: 160,
        clientY: 180,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        pointerId: 2,
        clientX: 164,
        clientY: 184,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 2,
        clientX: 164,
        clientY: 184,
      }));
      await Promise.resolve();
    });

    const afterThresholdMiss = readState()[0];
    expect(afterThresholdMiss?.x).toBe(180);
    expect(afterThresholdMiss?.y).toBe(220);

    await act(async () => {
      box?.dispatchEvent(new PointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 3,
        clientX: 160,
        clientY: 180,
      }));
      window.dispatchEvent(new PointerEvent("pointermove", {
        bubbles: true,
        button: 0,
        pointerId: 3,
        clientX: 220,
        clientY: 240,
      }));
      window.dispatchEvent(new PointerEvent("pointerup", {
        bubbles: true,
        button: 0,
        pointerId: 3,
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

  it("creates highlight strokes and removes nearby strokes with the eraser", async () => {
    const highlightContainer = document.createElement("div");
    document.body.appendChild(highlightContainer);
    const highlightRoot = createRoot(highlightContainer);

    await act(async () => {
      highlightRoot.render(<StrokeHarness mode="highlight" />);
    });
    const highlightLayer = highlightContainer.querySelector(".absolute.inset-0.z-20") as HTMLDivElement | null;
    expect(highlightLayer).not.toBeNull();
    highlightLayer!.getBoundingClientRect = () => ({
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
      highlightLayer?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 120, clientY: 160 }));
      highlightLayer?.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, button: 0, clientX: 180, clientY: 220 }));
      highlightLayer?.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0, clientX: 180, clientY: 220 }));
      await Promise.resolve();
    });

    const highlightState = JSON.parse(highlightContainer.querySelector("[data-testid='stroke-state']")?.textContent ?? "[]");
    expect(highlightState).toHaveLength(1);
    expect(highlightState[0]?.points).toHaveLength(2);

    await act(async () => {
      highlightRoot.unmount();
    });
    highlightContainer.remove();

    const eraserContainer = document.createElement("div");
    document.body.appendChild(eraserContainer);
    const eraserRoot = createRoot(eraserContainer);

    await act(async () => {
      eraserRoot.render(<StrokeHarness mode="eraser" />);
    });
    const eraserLayer = eraserContainer.querySelector(".absolute.inset-0.z-20") as HTMLDivElement | null;
    expect(eraserLayer).not.toBeNull();
    eraserLayer!.getBoundingClientRect = highlightLayer!.getBoundingClientRect;

    await act(async () => {
      eraserLayer?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0, clientX: 120, clientY: 160 }));
      await Promise.resolve();
    });

    const eraserState = JSON.parse(eraserContainer.querySelector("[data-testid='stroke-state']")?.textContent ?? "[]");
    expect(eraserState).toHaveLength(0);

    await act(async () => {
      eraserRoot.unmount();
    });
    eraserContainer.remove();
  });
});
