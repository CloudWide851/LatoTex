import { describe, expect, it } from "vitest";
import {
  createInitialDoctorChecks,
  formatDoctorMessage,
  repairTargetsForRepairId,
  SAFE_REPAIR_IDS,
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

  it("keeps risky repairs out of the one-click safe repair set", () => {
    expect(SAFE_REPAIR_IDS.has("projectIntegrity")).toBe(true);
    expect(SAFE_REPAIR_IDS.has("searchIndex")).toBe(true);
    expect(SAFE_REPAIR_IDS.has("releaseMemory")).toBe(true);
    expect(SAFE_REPAIR_IDS.has("pythonEnv")).toBe(false);
  });

  it("maps repairs to targeted Doctor re-checks", () => {
    expect(repairTargetsForRepairId("projectIntegrity")).toEqual(["projectIntegrity"]);
    expect(repairTargetsForRepairId("searchIndex")).toEqual(["searchIndex"]);
    expect(repairTargetsForRepairId("releaseMemory")).toEqual(["memory"]);
  });
});
