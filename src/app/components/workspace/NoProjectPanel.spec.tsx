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
    const openButton = container.querySelector<HTMLButtonElement>(
      'button[title="Open project folder"]',
    );
    const sampleButton = container.querySelector<HTMLButtonElement>(
      'button[title="Create research paper sample"]',
    );
    expect(openButton?.textContent).toBe("Open project folder");
    expect(sampleButton?.textContent).toBe("Create research paper sample");
    expect(document.body.querySelector("[role='tooltip']")).toBeNull();
    expect(container.querySelector("p")).toBeNull();

    await act(async () => openButton?.click());
    await act(async () => sampleButton?.click());
    expect(onOpenFolder).toHaveBeenCalledTimes(1);
    expect(onCreateSample).toHaveBeenCalledTimes(1);
  });
});
