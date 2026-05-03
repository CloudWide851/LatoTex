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
    relativePath: null,
    sessionId: null,
    cwd: "",
    venvPath: null,
    envSource: null,
    status: "running",
    cursor: 0,
    buffer: "",
    error: null,
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

    await act(async () => {
      root.render(
        <TerminalSessionRail
          tabs={[tab("one", "main.tex"), tab("two", "analysis")]}
          activeTabId="one"
          onSelect={() => undefined}
          onClose={() => undefined}
          onNew={() => undefined}
          onReorder={onReorder}
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

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
