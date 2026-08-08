import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import { applyResearchSettingsPatch } from "./researchSettingsPatch";

const settings = {
  activeProjectId: "project-1",
  modelProtocols: [],
  modelCatalog: [],
  agentBindings: [],
  uiPrefs: { theme: "system" },
} as AppSettings;

describe("research settings patch", () => {
  it("applies only bounded appearance and interaction preferences", () => {
    const next = applyResearchSettingsPatch(settings, {
      uiPrefs: { theme: "dark", motionLevel: "reduced", fontScale: 1.1 },
    });
    expect(next.uiPrefs?.theme).toBe("dark");
    expect(next.uiPrefs?.motionLevel).toBe("reduced");
    expect(next.uiPrefs?.fontScale).toBe(1.1);
  });

  it("rejects credentials, unknown roots, and out-of-range values", () => {
    expect(() => applyResearchSettingsPatch(settings, { apiKey: "forbidden" }))
      .toThrow("research.ui_command.settings_scope_invalid");
    expect(() => applyResearchSettingsPatch(settings, { uiPrefs: { channels: {} } }))
      .toThrow("research.ui_command.settings_key_unsupported");
    expect(() => applyResearchSettingsPatch(settings, { uiPrefs: { fontScale: 9 } }))
      .toThrow("research.ui_command.settings_value_invalid");
  });
});
