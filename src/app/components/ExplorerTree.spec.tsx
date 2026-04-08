// @vitest-environment jsdom

import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ExplorerTree } from "./ExplorerTree";
import type { ResourceNode } from "../../shared/types/app";

const TREE: ResourceNode[] = [
  { name: "a.tex", relativePath: "a.tex", kind: "file", children: [] },
  { name: "b.tex", relativePath: "b.tex", kind: "file", children: [] },
  { name: "c.tex", relativePath: "c.tex", kind: "file", children: [] },
];

describe("ExplorerTree", () => {
  beforeEach(() => {
    (
      globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("supports ctrl and shift file multi-selection without turning directories into active files", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    const onSelect = vi.fn();

    await act(async () => {
      root.render(
        <ExplorerTree
          tree={TREE}
          selectedPath={null}
          onSelect={onSelect}
          t={(key) => String(key)}
        />,
      );
    });

    const rows = Array.from(container.querySelectorAll("[data-explorer-node='true']"));
    const [first, second, third] = rows;

    await act(async () => {
      first?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    expect(first?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      second?.dispatchEvent(new MouseEvent("click", { bubbles: true, ctrlKey: true }));
    });
    expect(first?.getAttribute("aria-selected")).toBe("true");
    expect(second?.getAttribute("aria-selected")).toBe("true");

    await act(async () => {
      third?.dispatchEvent(new MouseEvent("click", { bubbles: true, shiftKey: true }));
    });
    expect(first?.getAttribute("aria-selected")).toBe("false");
    expect(second?.getAttribute("aria-selected")).toBe("true");
    expect(third?.getAttribute("aria-selected")).toBe("true");
    expect(onSelect).toHaveBeenLastCalledWith("c.tex");
  });
});
