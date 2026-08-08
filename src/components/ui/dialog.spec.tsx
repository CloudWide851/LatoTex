// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AppDialog, AppTextInputDialog } from "./dialog";

let mountedRoot: Root | null = null;

describe("AppDialog", () => {
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
    vi.restoreAllMocks();
  });

  it("exposes modal semantics and closes on Escape", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
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

  it("focuses the text field and submits a trimmed value", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    const onConfirm = vi.fn();

    await act(async () => {
      root.render(
        <AppTextInputDialog
          title="Rename topic"
          label="Topic name"
          initialValue="Old name"
          confirmLabel="Save"
          cancelLabel="Cancel"
          required
          onConfirm={onConfirm}
          onCancel={vi.fn()}
        />,
      );
    });

    const input = document.body.querySelector("input");
    expect(document.activeElement).toBe(input);
    await act(async () => {
      const valueSetter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
      valueSetter?.call(input, "  New topic  ");
      input?.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => {
      input?.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
      input?.closest("form")?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });

    expect(onConfirm).toHaveBeenCalledWith("New topic");
  });
});
