import { describe, expect, it } from "vitest";
import type { AppSettings } from "../../shared/types/app";
import {
  buildRememberedCloseBehaviorSettings,
  resolveWindowCloseRequestPlan,
  resolveWindowControlPlan,
} from "./windowCloseFlow";

describe("windowCloseFlow", () => {
  it("routes minimize actions without busy tracking", () => {
    expect(resolveWindowControlPlan("minimize", "ask")).toEqual({
      type: "minimize",
      trackBusy: false,
    });
  });

  it("routes toggle actions with busy tracking", () => {
    expect(resolveWindowControlPlan("toggle", "ask")).toEqual({
      type: "toggle",
      trackBusy: true,
    });
  });

  it("routes ask-close to the in-app decision dialog", () => {
    expect(resolveWindowControlPlan("close", "ask")).toEqual({
      type: "request-close-decision",
      trackBusy: false,
    });
  });

  it("routes tray-close directly to the tray behavior", () => {
    expect(resolveWindowControlPlan("close", "tray")).toEqual({
      type: "run-close-behavior",
      trackBusy: true,
      behavior: "tray",
    });
  });

  it("routes exit-close directly to the exit behavior", () => {
    expect(resolveWindowControlPlan("close", "exit")).toEqual({
      type: "run-close-behavior",
      trackBusy: true,
      behavior: "exit",
    });
  });

  it("requires unsaved guard before close behavior resolution", () => {
    expect(
      resolveWindowCloseRequestPlan(["main.tex", "notes.tex"], ["notes.tex"]),
    ).toEqual({
      type: "request-unsaved-guard",
      candidatePaths: ["main.tex", "notes.tex"],
      dirtyPaths: ["notes.tex"],
    });
  });

  it("continues close flow immediately when nothing is dirty", () => {
    expect(resolveWindowCloseRequestPlan(["main.tex"], [])).toEqual({
      type: "continue-close",
      candidatePaths: ["main.tex"],
    });
  });

  it("builds remembered close settings without dropping panel layout", () => {
    const settings: AppSettings = {
      activeProjectId: "project-1",
      modelProtocols: [],
      modelCatalog: [],
      agentBindings: [],
      uiPrefs: {
        language: "zh-CN",
        closeBehavior: "ask",
        closeBehaviorRemember: false,
        panelLayout: { latex: [20, 50, 30] },
      },
    };

    expect(buildRememberedCloseBehaviorSettings(settings, "en-US", "exit")).toEqual({
      ...settings,
      uiPrefs: {
        ...settings.uiPrefs,
        language: "zh-CN",
        closeBehavior: "exit",
        closeBehaviorRemember: true,
        panelLayout: { latex: [20, 50, 30] },
      },
    });
  });
});
