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
  "workspace.createSample": "Create research paper sample",
  "workspace.sampleHint": "Start offline with a structured manuscript.",
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

  it("offers both folder opening and an offline research sample", async () => {
    const onOpenFolder = vi.fn();
    const onCreateSample = vi.fn();
    await act(async () => {
      root.render(
        <NoProjectPanel
          busy={false}
          onOpenFolder={onOpenFolder}
          onCreateSample={onCreateSample}
          t={(key) => messages[String(key)] ?? String(key)}
        />,
      );
    });

    expect(container.querySelector("h2")?.textContent).toContain("manuscript folder");
    const buttons = Array.from(container.querySelectorAll<HTMLButtonElement>("button"));
    expect(buttons.map((button) => button.textContent)).toEqual([
      "Open project folder",
      "Create research paper sample",
    ]);

    await act(async () => buttons[0]?.click());
    await act(async () => buttons[1]?.click());
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
    expect(onCreateSample).toHaveBeenCalledTimes(1);
  });
});
