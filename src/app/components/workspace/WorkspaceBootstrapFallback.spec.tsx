// @vitest-environment jsdom

import fs from "node:fs";
import path from "node:path";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { WorkspaceBootstrapFallback } from "./WorkspaceBootstrapFallback";

describe("WorkspaceBootstrapFallback", () => {
  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  });

  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("keeps startup progress inside the workspace instead of covering the application", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<WorkspaceBootstrapFallback t={(key) => String(key)} />);
    });

    expect(container.querySelector("main")?.getAttribute("aria-busy")).toBe("true");
    expect(container.querySelector(".fixed, .inset-0")).toBeNull();
    expect(container.textContent).toContain("app.startup.lightHint");

    await act(async () => {
      root.unmount();
    });
  });

  it("keeps the topbar outside the startup gate and the typed view below its split threshold", () => {
    const source = fs.readFileSync(
      path.resolve(process.cwd(), "src/app/components/AppContainerView.tsx"),
      "utf8",
    );
    const topbarIndex = source.indexOf("<AppTopbar");
    const startupGateIndex = source.indexOf("{!startupReady ?");

    expect(topbarIndex).toBeGreaterThan(-1);
    expect(startupGateIndex).toBeGreaterThan(topbarIndex);
    expect(source).toContain("<WorkspaceBootstrapFallback t={t} />");
    expect(source).not.toContain("StartupLoadingScreen");
    expect(source.split(/\r?\n/).length).toBeLessThanOrEqual(541);
  });
});
