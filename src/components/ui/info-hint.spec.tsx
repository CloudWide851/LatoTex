// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { InfoHint, resolveInfoHintPosition } from "./info-hint";

let mountedRoot: Root | null = null;

describe("InfoHint", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(async () => {
    if (mountedRoot) {
      await act(async () => mountedRoot?.unmount());
      mountedRoot = null;
    }
    document.body.innerHTML = "";
  });

  it("keeps a long hint inside a narrow viewport", () => {
    const position = resolveInfoHintPosition({
      trigger: { left: 150, right: 174, top: 120, bottom: 144, width: 24 },
      popupHeight: 180,
      viewportWidth: 180,
      viewportHeight: 240,
    });

    expect(position.width).toBe(156);
    expect(position.left).toBe(12);
    expect(position.left + position.width).toBeLessThanOrEqual(168);
    expect(position.top).toBe(12);
    expect(position.maxHeight).toBe(216);

    const tiny = resolveInfoHintPosition({
      trigger: { left: 40, right: 64, top: 30, bottom: 54, width: 24 },
      popupHeight: 120,
      viewportWidth: 100,
      viewportHeight: 90,
    });
    expect(tiny.width).toBe(76);
    expect(tiny.left + tiny.width).toBeLessThanOrEqual(88);
    expect(tiny.maxHeight).toBe(66);
  });

  it("portals the hint and supports hover, pinning, Escape, outside click, and blur", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;

    await act(async () => {
      root.render(<InfoHint label="About evidence" content="A long translated explanation" />);
    });

    const trigger = container.querySelector("button");
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");
    expect(trigger?.getAttribute("aria-describedby")).toBeTruthy();

    await act(async () => {
      trigger?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe(
      "A long translated explanation",
    );
    expect(container.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => trigger?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true })));
    trigger?.blur();
    expect(document.body.querySelector("[role='tooltip']")?.getAttribute("data-pinned")).toBe("true");

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
    expect(trigger?.getAttribute("aria-expanded")).toBe("false");

    await act(async () => trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => document.body.dispatchEvent(new Event("pointerdown", { bubbles: true })));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();

    await act(async () => trigger?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    await act(async () => window.dispatchEvent(new Event("blur")));
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
  });

  it("marks motion as reducible", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    await act(async () => {
      root.render(<InfoHint content="Motion-safe hint" />);
    });
    const trigger = container.querySelector("button");
    await act(async () => trigger?.focus());
    expect(document.body.querySelector("[role='tooltip']")?.className).toContain(
      "motion-reduce:transition-none",
    );
  });
});
