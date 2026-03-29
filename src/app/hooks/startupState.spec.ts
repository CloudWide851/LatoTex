import { describe, expect, it } from "vitest";

import {
  createAppStartupSteps,
  deriveComponentStartupState,
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

  it("keeps component state blocked until startup is ready", () => {
    expect(deriveComponentStartupState("booting")).toBe("startupBlocked");
    expect(deriveComponentStartupState("warming")).toBe("startupBlocked");
    expect(deriveComponentStartupState("actionRequired")).toBe("startupBlocked");
    expect(deriveComponentStartupState("failed")).toBe("error");
    expect(deriveComponentStartupState("ready")).toBe("ready");
  });
});
