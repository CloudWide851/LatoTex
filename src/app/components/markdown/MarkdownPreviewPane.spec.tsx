// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MarkdownPreviewPane } from "./MarkdownPreviewPane";

const mocks = vi.hoisted(() => ({
  markdownRunCode: vi.fn(),
  markdownRunCodeCapabilities: vi.fn(),
}));

vi.mock("../../../shared/api/workspace", () => ({
  markdownRunCode: mocks.markdownRunCode,
  markdownRunCodeCapabilities: mocks.markdownRunCodeCapabilities,
}));

describe("MarkdownPreviewPane", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    mocks.markdownRunCode.mockReset();
    mocks.markdownRunCodeCapabilities.mockReset();
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("shows missing local toolchains before running native code blocks", async () => {
    mocks.markdownRunCodeCapabilities.mockResolvedValue([
      { language: "python", available: false, runner: null, message: "markdown.run.toolchain_missing" },
    ]);
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(
        <MarkdownPreviewPane
          activeProjectId="project-1"
          selectedPath="notes.md"
          markdown={"```python\nprint('hello')\n```"}
          emptyText="Empty"
          t={(key) => String(key)}
        />,
      );
      await Promise.resolve();
    });

    expect(container.textContent).toContain("preview.codeToolchainMissing");
    expect(container.querySelector("button")?.hasAttribute("disabled")).toBe(true);
    expect(mocks.markdownRunCode).not.toHaveBeenCalled();

    await act(async () => {
      root.unmount();
    });
  });
});
