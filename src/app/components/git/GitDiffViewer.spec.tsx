// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { GitDiffViewer } from "./GitDiffViewer";
import type { GitDiffResponse } from "../../../shared/types/app";

describe("GitDiffViewer", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("renders a bounded virtual window for large diffs", async () => {
    const diff: GitDiffResponse = {
      path: "main.tex",
      staged: false,
      addedLines: 240,
      removedLines: 0,
      hunks: [{
        header: "@@ -1,1 +1,240 @@",
        lines: Array.from({ length: 240 }, (_, index) => ({
          kind: "added",
          oldLine: undefined,
          newLine: index + 1,
          text: `+line ${index + 1}`,
        })),
      }],
    };
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <GitDiffViewer
          active
          loading={false}
          error=""
          diff={diff}
          t={(key) => String(key)}
        />,
      );
    });

    expect(container.querySelectorAll("[data-virtual-index]").length).toBeLessThan(120);
    expect(container.textContent).toContain("+line 1");
    expect(container.textContent).not.toContain("+line 240");

    await act(async () => {
      root.unmount();
    });
  });
});
