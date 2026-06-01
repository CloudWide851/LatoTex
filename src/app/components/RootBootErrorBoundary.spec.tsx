// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RootBootErrorBoundary } from "./RootBootErrorBoundary";

vi.mock("../../shared/api/runtime", () => ({
  runtimeClearVolatileCacheAndRestart: vi.fn(() => Promise.resolve({ ok: true, message: "ok" })),
  runtimeLogWrite: vi.fn(() => Promise.resolve({ ok: true, message: "ok" })),
}));

vi.mock("../smoke/tauriSmokeProgress", () => ({
  writeTauriSmokeProgress: vi.fn(),
}));

function CrashingChild() {
  throw new Error("boot crashed");
  return null;
}

describe("RootBootErrorBoundary", () => {
  let root: Root | null = null;
  const preventExpectedError = (event: ErrorEvent) => {
    if (event.message.includes("boot crashed")) {
      event.preventDefault();
    }
  };

  beforeEach(() => {
    (globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    vi.spyOn(console, "error").mockImplementation(() => undefined);
    window.addEventListener("error", preventExpectedError);
  });

  afterEach(() => {
    window.removeEventListener("error", preventExpectedError);
    root?.unmount();
    root = null;
    document.body.innerHTML = "";
    vi.restoreAllMocks();
  });

  it("renders a visible startup fallback for boundary-level boot crashes", async () => {
    const container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await act(async () => {
      root?.render(
        <RootBootErrorBoundary>
          <CrashingChild />
        </RootBootErrorBoundary>,
      );
    });

    expect(container.textContent).toContain("LatoTex failed to start");
    expect(container.textContent).toContain("boot crashed");
    expect(container.querySelector("button")).not.toBeNull();
  });
});
