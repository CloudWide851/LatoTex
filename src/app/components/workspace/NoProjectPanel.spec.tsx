// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NoProjectPanel } from "./NoProjectPanel";

const messages: Record<string, string> = {
  "workspace.welcomeTitle": "Turn a manuscript folder into a focused workspace",
  "workspace.welcomeDescription": "Edit and compile in one place.",
  "workspace.openProjectFolder": "Open project folder",
  "workspace.folderHint": "Choose an existing or empty folder.",
};

describe("NoProjectPanel", () => {
  let container: HTMLDivElement;
  let root: ReturnType<typeof createRoot>;

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);
  });

  afterEach(async () => {
    await act(async () => root.unmount());
    container.remove();
  });

  it("explains the workflow and exposes one labeled primary action", async () => {
    const onOpenFolder = vi.fn();
    await act(async () => {
      root.render(<NoProjectPanel busy={false} onOpenFolder={onOpenFolder} t={(key) => messages[String(key)] ?? String(key)} />);
    });

    expect(container.querySelector("h2")?.textContent).toContain("manuscript folder");
    const button = container.querySelector<HTMLButtonElement>("button");
    expect(button?.textContent).toBe("Open project folder");
    expect(container.querySelectorAll("button")).toHaveLength(1);

    await act(async () => button?.click());
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
  });
});
