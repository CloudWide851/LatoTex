// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialog } from "./dialog";

describe("AppDialog", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("exposes modal semantics and closes on Escape", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onClose = vi.fn();

    await act(async () => {
      root.render(
        <AppDialog onClose={onClose} ariaLabel="Example dialog">
          <button type="button">Action</button>
        </AppDialog>,
      );
    });

    const dialog = document.body.querySelector("[role='dialog']");
    expect(dialog?.getAttribute("aria-label")).toBe("Example dialog");

    const action = document.body.querySelector("button");
    action?.focus();
    await act(async () => {
      action?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    expect(onClose).toHaveBeenCalledTimes(1);

    await act(async () => {
      root.unmount();
    });
  });
});
