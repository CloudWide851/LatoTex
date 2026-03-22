import { describe, expect, it } from "vitest";
import {
  resolveWindowCloseRequestPlan,
  resolveWindowControlPlan,
} from "./windowCloseFlow";

describe("windowCloseFlow", () => {
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
});
