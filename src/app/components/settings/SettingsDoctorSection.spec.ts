import { describe, expect, it } from "vitest";
import {
  createInitialDoctorChecks,
  formatDoctorMessage,
} from "./SettingsDoctorSection";

describe("SettingsDoctorSection helpers", () => {
  it("stores translatable messages as keys and params", () => {
    const t = (key: string) => ({
      "settings.doctor.lastRun": "Last run: {time}",
    })[key] ?? key;

    expect(formatDoctorMessage(t, "settings.doctor.lastRun", { time: "10:30" }))
      .toBe("Last run: 10:30");
  });

  it("shows project checks only when a project is active", () => {
    expect(createInitialDoctorChecks(null).map((check) => check.id)).toEqual([
      "runtimeLog",
      "memory",
      "latexLayout",
      "mcpConfig",
      "skillsConfig",
      "runtimeAssets",
    ]);
    expect(createInitialDoctorChecks("project-1").map((check) => check.id)).toContain("pythonEnv");
    expect(createInitialDoctorChecks("project-1").map((check) => check.id)).toContain("libraryCitationIndex");
    expect(createInitialDoctorChecks("project-1").map((check) => check.id)).toContain("shareCollab");
  });
});
