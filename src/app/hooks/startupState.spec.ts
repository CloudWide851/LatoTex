import { describe, expect, it } from "vitest";

import {
  createAppStartupSteps,
  deriveComponentStartupState,
  deriveStartupOverlaySteps,
  deriveStartupProgress,
  updateAppStartupSteps,
} from "./startupState";

describe("startupState helpers", () => {
  it("derives progress from step statuses", () => {
    const steps = createAppStartupSteps();
    const running = updateAppStartupSteps(steps, "health", { status: "ready" });
    const mixed = updateAppStartupSteps(running, "settings", { status: "running" });

    expect(deriveStartupProgress(steps)).toBe(0);
    expect(deriveStartupProgress(running)).toBeGreaterThan(0);
    expect(deriveStartupProgress(mixed)).toBeGreaterThan(deriveStartupProgress(running));
  });

  it("focuses the overlay on the active step while startup is running", () => {
    const steps = updateAppStartupSteps(createAppStartupSteps(), "tectonic", {
      status: "running",
      detail: "extracting_search",
    });

    expect(deriveStartupOverlaySteps("warming", steps, "tectonic")).toEqual([
      expect.objectContaining({ key: "tectonic", status: "running" }),
    ]);
  });

  it("shows only blocking steps once startup needs attention", () => {
    let steps = updateAppStartupSteps(createAppStartupSteps(), "drawio", { status: "ready" });
    steps = updateAppStartupSteps(steps, "tectonic", {
      status: "failed",
      detail: "resource_warmup.timeout",
    });
    steps = updateAppStartupSteps(steps, "analysisEnv", {
      status: "actionRequired",
      detail: "repair required",
    });

    expect(deriveStartupOverlaySteps("failed", steps, "tectonic")).toEqual([
      expect.objectContaining({ key: "tectonic", status: "failed" }),
      expect.objectContaining({ key: "analysisEnv", status: "actionRequired" }),
    ]);
  });

  it("keeps component state blocked until startup is ready", () => {
    expect(deriveComponentStartupState("booting")).toBe("startupBlocked");
    expect(deriveComponentStartupState("warming")).toBe("startupBlocked");
    expect(deriveComponentStartupState("actionRequired")).toBe("startupBlocked");
    expect(deriveComponentStartupState("failed")).toBe("error");
    expect(deriveComponentStartupState("ready")).toBe("ready");
  });
});
