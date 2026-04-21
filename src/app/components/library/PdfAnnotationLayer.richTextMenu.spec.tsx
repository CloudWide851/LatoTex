// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PdfAnnotationLayer } from "./PdfAnnotationLayer";

function RichTextHarness(props: { mode: "select" | "textbox" }) {
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
      content: "Hello world",
      html: "<p>Hello world</p>",
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
      <pre data-testid="textbox-state">{JSON.stringify(textBoxes)}</pre>
    </div>
  );
}

describe("PdfAnnotationLayer rich text menu", () => {
  const originalRequestAnimationFrame = window.requestAnimationFrame;
  const originalCancelAnimationFrame = window.cancelAnimationFrame;
  const originalClientWidth = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientWidth");
  const originalClientHeight = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "clientHeight");

  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    window.requestAnimationFrame = ((callback: FrameRequestCallback) => {
      callback(0);
      return 1;
    }) as typeof window.requestAnimationFrame;
    window.cancelAnimationFrame = vi.fn();
    Object.defineProperty(HTMLElement.prototype, "clientWidth", { configurable: true, get: () => 360 });
    Object.defineProperty(HTMLElement.prototype, "clientHeight", { configurable: true, get: () => 480 });
  });

  afterEach(() => {
    window.requestAnimationFrame = originalRequestAnimationFrame;
    window.cancelAnimationFrame = originalCancelAnimationFrame;
    if (originalClientWidth) {
      Object.defineProperty(HTMLElement.prototype, "clientWidth", originalClientWidth);
    }
    if (originalClientHeight) {
      Object.defineProperty(HTMLElement.prototype, "clientHeight", originalClientHeight);
    }
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("applies whole-box menu style changes while the textbox is selected in select mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RichTextHarness mode="select" />);
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
      box?.dispatchEvent(new MouseEvent("click", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      await Promise.resolve();
    });

    const alignCenter = container.querySelector(
      "button[title='library.viewer.textbox.menu.alignCenter']",
    ) as HTMLButtonElement | null;
    expect(alignCenter).not.toBeNull();

    await act(async () => {
      alignCenter?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const state = JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");
    expect(state[0]?.style?.textAlign).toBe("center");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("persists inline rich-text formatting immediately while editing", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RichTextHarness mode="textbox" />);
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
      box?.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      await Promise.resolve();
    });

    const editor = container.querySelector("[data-editing-box='textbox-1']") as HTMLDivElement | null;
    expect(editor).not.toBeNull();

    const textNode = editor?.querySelector("p")?.firstChild as Text | null;
    expect(textNode).not.toBeNull();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const boldButton = container.querySelector(
      "button[title='library.viewer.textbox.menu.bold']",
    ) as HTMLButtonElement | null;
    expect(boldButton).not.toBeNull();

    await act(async () => {
      boldButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const state = JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");
    expect(state[0]?.html).toContain("font-weight: bold");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("applies whole-box formatting to the existing rich html when no selection is active", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RichTextHarness mode="textbox" />);
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
      box?.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      await Promise.resolve();
    });

    const editor = container.querySelector("[data-editing-box='textbox-1']") as HTMLDivElement | null;
    expect(editor).not.toBeNull();
    editor?.focus();
    const selection = window.getSelection();
    selection?.removeAllRanges();
    document.dispatchEvent(new Event("selectionchange"));

    const boldButton = container.querySelector(
      "button[title='library.viewer.textbox.menu.bold']",
    ) as HTMLButtonElement | null;
    expect(boldButton).not.toBeNull();

    await act(async () => {
      boldButton?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const state = JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");
    expect(state[0]?.style?.fontWeight).toBe("bold");
    expect(state[0]?.html).toContain("font-weight: bold");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps the editor alive and applies dropdown formatting to the selected text", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<RichTextHarness mode="textbox" />);
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
      box?.dispatchEvent(new MouseEvent("dblclick", {
        bubbles: true,
        button: 0,
        clientX: 160,
        clientY: 180,
      }));
      await Promise.resolve();
    });

    const editor = container.querySelector("[data-editing-box='textbox-1']") as HTMLDivElement | null;
    expect(editor).not.toBeNull();

    const textNode = editor?.querySelector("p")?.firstChild as Text | null;
    expect(textNode).not.toBeNull();
    const range = document.createRange();
    range.setStart(textNode!, 0);
    range.setEnd(textNode!, 5);
    const selection = window.getSelection();
    selection?.removeAllRanges();
    selection?.addRange(range);
    document.dispatchEvent(new Event("selectionchange"));

    const fontFamilyTrigger = Array.from(container.querySelectorAll("button")).find(
      (node) => node.getAttribute("role") === "combobox" && node.textContent?.includes("Segoe UI"),
    ) as HTMLButtonElement | undefined;
    expect(fontFamilyTrigger).toBeTruthy();

    await act(async () => {
      fontFamilyTrigger?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    const arialOption = Array.from(document.querySelectorAll("button")).find(
      (node) => node.textContent?.includes("Arial"),
    ) as HTMLButtonElement | undefined;
    expect(arialOption).toBeTruthy();

    await act(async () => {
      arialOption?.dispatchEvent(new MouseEvent("click", { bubbles: true, button: 0 }));
      await Promise.resolve();
    });

    expect(container.querySelector("[data-editing-box='textbox-1']")).not.toBeNull();
    const state = JSON.parse(container.querySelector("[data-testid='textbox-state']")?.textContent ?? "[]");
    expect(state[0]?.html).toContain("font-family: Arial");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
