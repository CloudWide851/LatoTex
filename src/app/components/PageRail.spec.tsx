// @vitest-environment jsdom

import { FileText } from "lucide-react";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PageRail } from "./PageRail";

describe("PageRail material states", () => {
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

  it("uses semantic material classes for active and idle destinations", async () => {
    await act(async () => {
      root.render(
        <PageRail
          items={[
            { id: "latex", label: "Editor", icon: FileText },
            { id: "settings", label: "Settings", icon: FileText },
          ]}
          activePage="latex"
          onChange={vi.fn()}
        />,
      );
    });

    expect(container.querySelector('button[aria-label="Editor"]')?.className).toContain("app-page-rail-item--active");
    expect(container.querySelector('button[aria-label="Editor"]')?.getAttribute("aria-current")).toBe("page");
    expect(container.querySelector('button[aria-label="Settings"]')?.className).toContain("app-page-rail-item--idle");
  });
});
