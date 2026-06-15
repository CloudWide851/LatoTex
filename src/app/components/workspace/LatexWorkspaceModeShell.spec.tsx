// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LatexWorkspaceModeShell } from "./LatexWorkspaceModeShell";

describe("LatexWorkspaceModeShell", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("places Submission CI after DOCX as a separate mode", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LatexWorkspaceModeShell
          mode="submission"
          onModeChange={() => undefined}
          texWorkspace={<div>tex surface</div>}
          docxWorkspace={<div>docx surface</div>}
          submissionWorkspace={<div>submission surface</div>}
          t={(key) => String(key)}
        />,
      );
    });

    const labels = Array.from(container.querySelectorAll("button")).map((button) => button.getAttribute("aria-label"));
    expect(labels).toEqual(["workspace.mode.tex", "workspace.mode.docx", "workspace.mode.submission"]);
    expect(container.textContent).toContain("submission surface");
    expect(container.textContent).not.toContain("tex surface");
    expect(container.textContent).not.toContain("docx surface");

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });

  it("keeps TeX mode free of a separate mode-switcher row", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <LatexWorkspaceModeShell
          mode="tex"
          onModeChange={() => undefined}
          texWorkspace={<div data-testid="tex-surface">tex surface</div>}
          docxWorkspace={<div>docx surface</div>}
          submissionWorkspace={<div>submission surface</div>}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelector("[data-testid='tex-surface']")).not.toBeNull();
    expect(container.querySelector(".editor-toolbar-shell")).toBeNull();
    expect(container.querySelectorAll("button")).toHaveLength(0);

    await act(async () => {
      root.unmount();
    });
    container.remove();
  });
});
