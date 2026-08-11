// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  AppChoiceDialog,
  AppDialog,
  AppDialogFrame,
  AppTextInputDialog,
} from "./dialog";

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

  it("moves the visible description into an accessible info hint", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;

    await act(async () => {
      root.render(
        <AppDialogFrame
          title="Risky change"
          description="This action changes project settings."
          tone="permission"
          onClose={() => undefined}
        />,
      );
    });

    const dialog = document.body.querySelector("[role='dialog']");
    const descriptionId = dialog?.getAttribute("aria-describedby") ?? "";
    const description = document.getElementById(descriptionId);
    expect(description?.className).toContain("sr-only");
    expect(description?.textContent).toBe("This action changes project settings.");

    const hint = document.body.querySelector<HTMLButtonElement>("button[aria-expanded]");
    expect(hint?.getAttribute("aria-label")).toBe("Risky change");
    await act(async () => hint?.focus());
    expect(document.body.querySelector("[role='tooltip']")?.textContent).toBe(
      "This action changes project settings.",
    );
  });

  it("keeps choice explanations out of the permanent row without nesting buttons", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mountedRoot = root;
    const onChoose = vi.fn();

    await act(async () => {
      root.render(
        <AppChoiceDialog
          title="Resolve conflict"
          choices={[{
            id: "local",
            label: "Local version",
            description: "Keep the working copy on this computer.",
          }]}
          onChoose={onChoose}
          onCancel={() => undefined}
        />,
      );
    });

    const choice = Array.from(document.body.querySelectorAll("button"))
      .find((button) => button.textContent === "Local version");
    expect(choice?.querySelector("button")).toBeNull();
    expect(choice?.getAttribute("aria-describedby")).toBeTruthy();
    await act(async () => choice?.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onChoose).toHaveBeenCalledWith("local");
  });
});
