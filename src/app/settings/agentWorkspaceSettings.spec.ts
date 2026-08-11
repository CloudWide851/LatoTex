import { describe, expect, it } from "vitest";
import {
  DEFAULT_AGENT_WORKSPACE_PANEL_SIZES,
  mergeAgentWorkspaceVisibleLayout,
  normalizeAgentWorkspaceLayoutMap,
  normalizeAgentWorkspaceLayoutPrefs,
  normalizeAgentWorkspacePanelSizes,
} from "./agentWorkspaceSettings";

describe("agentWorkspaceSettings", () => {
  it("uses the conversation-first desktop defaults", () => {
    expect(normalizeAgentWorkspaceLayoutPrefs(undefined)).toEqual({
      tasksOpen: true,
      inspectorOpen: false,
      inspectorTab: "plan",
      panelSizes: DEFAULT_AGENT_WORKSPACE_PANEL_SIZES,
    });
  });

  it("normalizes invalid tabs and unsafe panel sizes", () => {
    const prefs = normalizeAgentWorkspaceLayoutPrefs({
      tasksOpen: false,
      inspectorOpen: true,
      inspectorTab: "unknown",
      panelSizes: [99, -10, 99],
    });
    expect(prefs.tasksOpen).toBe(false);
    expect(prefs.inspectorOpen).toBe(true);
    expect(prefs.inspectorTab).toBe("plan");
    expect(prefs.panelSizes.reduce((total, value) => total + value, 0)).toBe(100);
    expect(prefs.panelSizes[1]).toBeGreaterThanOrEqual(38);
  });

  it("preserves hidden panel sizes while resizing visible panels", () => {
    expect(mergeAgentWorkspaceVisibleLayout({
      tasksOpen: true,
      inspectorOpen: false,
      panelSizes: [18, 54, 28],
    }, [22, 78])).toEqual([22, 50, 28]);

    expect(mergeAgentWorkspaceVisibleLayout({
      tasksOpen: false,
      inspectorOpen: true,
      panelSizes: [18, 54, 28],
    }, [65, 35])).toEqual([18, 47, 35]);
  });

  it("drops blank project keys and normalizes every persisted entry", () => {
    expect(normalizeAgentWorkspaceLayoutMap({
      " project-1 ": { inspectorTab: "evidence", panelSizes: [20, 50, 30] },
      "": { tasksOpen: false },
    })).toEqual({
      "project-1": {
        tasksOpen: true,
        inspectorOpen: false,
        inspectorTab: "evidence",
        panelSizes: [20, 50, 30],
      },
    });
  });

  it("falls back when the panel tuple is incomplete", () => {
    expect(normalizeAgentWorkspacePanelSizes([20, 80])).toEqual(DEFAULT_AGENT_WORKSPACE_PANEL_SIZES);
  });
});
