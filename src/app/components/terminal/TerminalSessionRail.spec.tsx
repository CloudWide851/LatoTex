// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { TerminalSessionRail } from "./TerminalSessionRail";
import type { TerminalTab } from "./terminalTypes";

function tab(id: string, title: string): TerminalTab {
  return {
    id,
    title,
    sequence: id === "one" ? 1 : 2,
    relativePath: null,
    sessionId: null,
    startRequestId: null,
    autoStart: false,
    cwd: "",
    venvPath: null,
    envSource: null,
    status: "running",
    cursor: 0,
    buffer: "",
    failure: null,
  };
}

function pointerEvent(type: string, init: MouseEventInit & { pointerId: number }) {
  const event = new MouseEvent(type, init);
  Object.defineProperty(event, "pointerId", { value: init.pointerId });
  return event;
}

describe("TerminalSessionRail", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    Reflect.deleteProperty(document, "elementFromPoint");
    vi.restoreAllMocks();
  });

  it("uses full-width hidden-scroll tabs and supports drag reorder", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onReorder = vi.fn();
    const onWidthChange = vi.fn();

    await act(async () => {
      root.render(
        <TerminalSessionRail
          tabs={[tab("one", "main.tex"), tab("two", "analysis")]}
          activeTabId="one"
          onSelect={() => undefined}
          onClose={() => undefined}
          onNew={() => undefined}
          onReorder={onReorder}
          width={144}
          onWidthChange={onWidthChange}
          t={(key) => String(key)}
        />,
      );
    });

    const scroll = container.querySelector(".hide-scrollbar");
    const first = container.querySelector("[data-terminal-tab-id='one']") as HTMLElement;
    const second = container.querySelector("[data-terminal-tab-id='two']") as HTMLElement;
    Object.defineProperty(document, "elementFromPoint", {
      configurable: true,
      value: vi.fn(() => second),
    });

    expect(scroll?.className).toContain("overflow-y-auto");
    expect(first.className).toContain("w-full");

    await act(async () => {
      first.dispatchEvent(pointerEvent("pointerdown", { bubbles: true, button: 0, pointerId: 1, clientX: 0, clientY: 0 }));
      window.dispatchEvent(pointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 0, clientY: 12 }));
      window.dispatchEvent(pointerEvent("pointerup", { bubbles: true, pointerId: 1, clientX: 0, clientY: 12 }));
    });

    expect(onReorder).toHaveBeenCalledWith("one", "two");

    const resizeHandle = container.querySelector(
      "[aria-label='terminal.resizeSessions']",
    ) as HTMLElement;
    await act(async () => {
      resizeHandle.dispatchEvent(pointerEvent("pointerdown", {
        bubbles: true,
        button: 0,
        pointerId: 2,
        clientX: 144,
        clientY: 0,
      }));
      window.dispatchEvent(pointerEvent("pointermove", {
        bubbles: true,
        pointerId: 2,
        clientX: 184,
        clientY: 0,
      }));
      window.dispatchEvent(pointerEvent("pointerup", {
        bubbles: true,
        pointerId: 2,
        clientX: 184,
        clientY: 0,
      }));
    });
    expect(onWidthChange).toHaveBeenCalledWith(184);

    await act(async () => {
      resizeHandle.dispatchEvent(new KeyboardEvent("keydown", {
        bubbles: true,
        key: "ArrowRight",
      }));
    });
    expect(onWidthChange).toHaveBeenCalledWith(152);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
